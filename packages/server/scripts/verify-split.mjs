// 本地验证 api / worker 角色拆分（替代 CI 中的基础设施集成测试；需要 .env 指向可用的 PostgreSQL 与 Redis，
// 例如 `docker compose -f docker-compose.dev.yml up -d`）。
//
//   npm run verify:split -w @zenith/server
//
// 步骤：迁移 → 起 api（ZENITH_ROLES=api, 业务端口）与 worker（ZENITH_ROLES=worker, 健康端口）两个进程 →
// 断言：api 健康信息 roles=['api'] 且 workers=ok（看见 worker 心跳）、fan-out 已订阅；worker /ready 200、
// /metrics 带 process_role="worker"；管理员登录后提交演示任务 → 必须由 worker 执行到终态（api 不执行）。
// 任一断言失败以非零码退出。可用 VERIFY_ADMIN_USER / VERIFY_ADMIN_PASSWORD 覆盖登录账号（默认种子 admin / 123456）。
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

// 不经 shell 直接起 node + tsx CLI：shell:true 时 child.kill 在 Windows 只终止 cmd.exe，
// tsx 与其下的 node src/index.ts 会成为孤儿继续占端口 / 持有 DB 连接，下一次运行就绑定失败
const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve('tsx/cli');

const API_PORT = Number(process.env.VERIFY_API_PORT ?? 3390);
const WORKER_PORT = Number(process.env.VERIFY_WORKER_PORT ?? 3391);
const ADMIN_USER = process.env.VERIFY_ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.VERIFY_ADMIN_PASSWORD ?? '123456';
const API = `http://127.0.0.1:${API_PORT}`;
const WORKER = `http://127.0.0.1:${WORKER_PORT}`;

const baseEnv = { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development', LOG_CONSOLE_PRETTY: 'false' };
delete baseEnv.NODE_OPTIONS;
delete baseEnv.VSCODE_INSPECTOR_OPTIONS;

const children = [];
function start(label, env) {
  const child = spawn(process.execPath, [TSX_CLI, 'src/index.ts'], { env: { ...baseEnv, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = (chunk) => chunk.toString().trimEnd().split('\n').map((line) => `[${label}] ${line}`).join('\n');
  child.stdout.on('data', (c) => process.stdout.write(`${tag(c)}\n`));
  child.stderr.on('data', (c) => process.stderr.write(`${tag(c)}\n`));
  children.push(child);
  return child;
}

/** 终止全部子进程并等待退出（tsx 会把信号转给它拉起的 node；worker 的优雅停机含 offWork / 删节点队列 / boss.stop，给足预算后再强杀） */
async function stopAll() {
  const alive = children.filter((child) => child.exitCode === null && child.signalCode === null);
  for (const child of alive) child.kill('SIGTERM');
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline && alive.some((child) => child.exitCode === null && child.signalCode === null)) {
    await sleep(200);
  }
  for (const child of alive) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}

async function waitFor(url, predicate, timeoutMs = 60_000, headers = undefined) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, headers ? { headers } : undefined);
      const body = await res.json().catch(() => null);
      if (predicate(res, body)) return body;
      last = `${res.status} ${JSON.stringify(body)?.slice(0, 200)}`;
    } catch (err) {
      last = err.message;
    }
    await sleep(1000);
  }
  throw new Error(`等待 ${url} 超时：${last}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(`断言失败：${message}`);
  console.log(`  ✔ ${message}`);
}

async function main() {
  console.log('▶ 1/4 数据库迁移');
  const migrate = spawnSync('tsx src/db/migrate.ts', { stdio: 'inherit', env: baseEnv, shell: true });
  if (migrate.status !== 0) throw new Error('迁移失败');

  console.log('▶ 2/4 启动 api 与 worker 两个进程');
  start('api', { ZENITH_ROLES: 'api', PORT: String(API_PORT) });
  start('worker', { ZENITH_ROLES: 'worker', WORKER_HEALTH_PORT: String(WORKER_PORT), STORAGE_SHARED: 'true' });

  const health = await waitFor(`${API}/api/health`, (res, body) => res.status === 200 && body?.data?.checks?.workers === 'ok', 90_000);
  assert(JSON.stringify(health.data.roles) === '["api"]', 'api 进程只声明 api 角色');
  assert(health.data.checks.workers === 'ok', 'api 看见活跃的 worker 心跳');
  assert(health.data.checks.wsFanout === 'ok', 'api 已订阅跨进程 WS fan-out');

  const ready = await waitFor(`${WORKER}/ready`, (res) => res.status === 200);
  assert(ready.data.roles.includes('worker') && !ready.data.roles.includes('api'), 'worker 进程只声明 worker 角色');
  const metrics = await (await fetch(`${WORKER}/metrics`)).text();
  assert(metrics.includes('process_role="worker"'), 'worker /metrics 带 process_role 标签');
  const notFound = await fetch(`${WORKER}/api/auth/me`);
  assert(notFound.status === 404, 'worker 进程不暴露业务路由');

  console.log('▶ 3/4 管理员登录并提交演示任务');
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
  });
  const loginBody = await login.json();
  if (login.status !== 200 || loginBody.code !== 0) {
    throw new Error(`登录失败（${login.status}）：${loginBody.message ?? ''}。可用 VERIFY_ADMIN_USER / VERIFY_ADMIN_PASSWORD 指定账号`);
  }
  const accessToken = loginBody.data?.token?.accessToken;
  if (!accessToken) throw new Error('登录响应缺少 accessToken（账号可能启用了 MFA，请换一个未启用 MFA 的管理员）');
  const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
  const submit = await fetch(`${API}/api/task-demo/submit`, {
    method: 'POST', headers,
    body: JSON.stringify({ taskType: 'demo-batch', totalItems: 5, itemDelayMs: 50 }),
  });
  const submitted = await submit.json();
  if (submit.status !== 200 || submitted.code !== 0) throw new Error(`提交演示任务失败：${submitted.message ?? submit.status}`);
  const taskId = submitted.data.id;
  console.log(`  已提交任务 #${taskId}`);

  console.log('▶ 4/4 等待任务由 worker 执行到终态');
  const done = await waitFor(`${API}/api/async-tasks/${taskId}`, (res, body) => res.status === 200 && ['success', 'failed', 'cancelled'].includes(body?.data?.status), 60_000, headers);
  assert(done.data.status === 'success', `任务 #${taskId} 执行成功（status=${done.data.status}）`);

  console.log('\n✅ 拆分模式验证通过');
}

main()
  .then(async () => { await stopAll(); process.exit(0); })
  .catch(async (err) => {
    console.error(`\n❌ ${err.message}`);
    await stopAll();
    process.exit(1);
  });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { void stopAll().then(() => process.exit(130)); });
}
