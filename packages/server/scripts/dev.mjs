// 开发启动脚本：剥离 VS Code Auto Attach 注入的调试器(inspector)环境变量后再启动。
//
// 原因：Windows 下 node-pty（Web 终端 /api/ws/terminal）在 Node Inspector 附加时，
// pty.spawn() 会同步死锁、冻结整个后端事件循环（见 microsoft/node-pty#640）。
// VS Code Auto Attach（smart 模式）会给 `npm run dev` 启动的项目脚本注入 inspector，
// 从而触发该死锁，并导致启动期每个 tsx 进程退出都有数秒 "Waiting for the debugger
// to disconnect" 延迟。
//
// `npm run dev` 是运行模式，本不应被调试器附加；需要调试后端时请使用 VS Code 的
// "Debug: Server" 启动配置（此时 Web 终端会被 ws-terminal.ts 的兜底检测自动禁用并提示）。
import { spawn, spawnSync } from 'node:child_process';

const env = { ...process.env };
// `npm run dev` 是唯一的开发运行入口：未显式设置时标记为 development，
// 使 config 在缺省 JWT_SECRET / FIELD_ENCRYPTION_KEY 时回落内置开发密钥（lib/secrets.ts）。
// 生产启动路径（npm start / node dist/index.js / tsx src/index.ts / PM2）不经此脚本，仍为严格校验。
env.NODE_ENV ??= 'development';
// node-pty 与 Node Inspector 的死锁是 Windows ConPTY 特有问题（microsoft/node-pty#640）；
// 仅在 Windows 剥离 auto-attach 注入的调试器变量（NODE_OPTIONS 含 --require .../bootloader.js）。
// Linux/macOS 使用 forkpty，不受该死锁影响，保留 `npm run dev` 的可调试性。
if (process.platform === 'win32') {
  delete env.NODE_OPTIONS;
  delete env.VSCODE_INSPECTOR_OPTIONS;
}

/** 顺序执行（相当于原来的 `&&` 链中的一步），失败则退出。 */
function runSync(command) {
  const result = spawnSync(command, { stdio: 'inherit', env, shell: true });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 1) 数据库迁移  2) 种子数据
runSync('tsx src/db/migrate.ts');
runSync('tsx src/db/seed.ts');

// 3) 启动并监听文件变化（长驻进程）
// --exclude：CMS 静态化产物（storage/）与日志（logs/）属于运行时输出，
// 写入时不应触发 tsx watch 重启，否则每次静态化都会导致后端重启、API 间歇 502。
//
// 默认单进程承担全部角色（ZENITH_ROLES 缺省 = all）。`--split` 时按生产拓扑起两个进程：
// api（业务端口）与 worker（仅健康端口），角色以代码注入环境变量——根脚本里 `env X=1 cmd` 的写法
// 在 cmd.exe 下不可用，这里对所有平台一致。两个进程各自 tsx watch，热重启开销翻倍，只在验证角色行为时使用。
const WATCH = 'tsx watch --exclude "storage/**" --exclude "logs/**" src/index.ts';
const split = process.argv.includes('--split');

const children = [];
let exiting = false;

/** 任一子进程退出 → 先终止其余子进程，再以同码退出；否则 split 模式下另一个 tsx watch 会成为孤儿继续占端口 */
function exitAll(code) {
  if (exiting) return;
  exiting = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
  process.exit(code);
}

function spawnServer(label, roles) {
  const child = spawn(WATCH, { stdio: 'inherit', env: { ...env, ZENITH_ROLES: roles }, shell: true });
  child.on('exit', (code) => {
    if (split) console.log(`[dev] ${label} 进程退出（code=${code ?? 0}）`);
    exitAll(code ?? 0);
  });
  children.push(child);
  return child;
}

if (split) {
  spawnServer('api', 'api');
  spawnServer('worker', 'worker');
} else {
  spawnServer('all', env.ZENITH_ROLES ?? 'all');
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { for (const child of children) child.kill(signal); });
}
