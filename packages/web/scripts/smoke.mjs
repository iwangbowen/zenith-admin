#!/usr/bin/env node
/**
 * 构建产物启动冒烟：用系统 Chrome 打开 `vite preview` 托管的产物，逐个入口 / 关键页面渲染，
 * 任何控制台错误、未捕获异常或页面级错误边界即失败。堵住「构建 exit 0、页面白屏」这一类
 * 分包 / 模块求值顺序问题（跨 chunk 环 TDZ、CJS 全局顺序等构建期无法发现的故障）。
 *
 *   npm run build:demo -w @zenith/web && npm run smoke -w @zenith/web           # Demo 模式（MSW，无需后端）
 *   npm run smoke -w @zenith/web -- --url http://localhost:4173 --no-serve      # 已有 preview 服务
 *
 * 默认自行拉起 `vite preview`（端口 4180），检查后关闭。Demo 模式下 MSW 在首个请求前需要注册 Service
 * Worker，页面就绪判定以登录表单 / 侧栏 / 仪表盘等业务节点出现为准。
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const noServe = args.includes('--no-serve');
const port = Number(readArg('--port') ?? 4180);
const baseUrl = (readArg('--url') ?? `http://localhost:${port}`).replace(/\/$/, '');
const demoUser = readArg('--user') ?? 'admin';
const demoPassword = readArg('--password') ?? '123456';

// 与 Demo 无关、允许出现的噪音（埋点 / 第三方资源拒连等不是启动故障）
const IGNORED = [/ERR_CONNECTION_REFUSED/, /favicon/, /\[analytics\]/, /mockServiceWorker/, /net::ERR_/, /Failed to load resource/];

let preview = null;
if (!noServe) {
  // 直接执行 vite 的 bin 脚本：不经 shell，跨平台且无参数转义问题
  const viteBin = resolve(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin/vite.js');
  preview = spawn(process.execPath, [viteBin, 'preview', '--port', String(port), '--strictPort'], { cwd: webRoot, stdio: 'ignore' });
  await waitForServer(baseUrl, 30_000);
}

const browser = await chromium.launch({ channel: readArg('--channel') ?? 'chrome', headless: true });
const failures = [];

async function check(label, url, ready, prepare) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  if (prepare) await prepare(page);
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
    await ready(page);
    // 让懒加载 chunk（图标表、通知弹层等）落地后再判定
    await sleep(1500);
    const boundary = await page.locator('text=页面加载出错').count();
    if (boundary > 0) errors.push('页面级错误边界已渲染（页面加载出错）');
  } catch (err) {
    errors.push(`就绪超时或导航失败：${String(err).split('\n')[0]}`);
  }
  await context.close();
  const real = errors.filter((e) => !IGNORED.some((re) => re.test(e)));
  if (real.length) failures.push({ label, errors: real });
  console.log(`${real.length ? '✖' : '✔'} ${label}${real.length ? `\n    ${real.join('\n    ')}` : ''}`);
}

await check('后台入口 /login', `${baseUrl}/login`, (page) => page.waitForSelector('input[placeholder="请输入密码"]', { timeout: 60_000 }));
await check('会员端入口 /member.html', `${baseUrl}/member.html`, (page) => page.waitForSelector('#member-root > *', { timeout: 60_000 }));
await check('审批端入口 /approval.html', `${baseUrl}/approval.html`, (page) => page.waitForSelector('#approval-root > *', { timeout: 60_000 }));

// 已登录链路：Demo 模式经 MSW 登录；真实后端同样适用（MSW 与服务端契约同形）
await check('后台登录 → 仪表盘 → 用户管理', `${baseUrl}/login`, async (page) => {
  await page.waitForSelector('input[placeholder="请输入用户名/手机号"]', { timeout: 60_000 });
  await page.fill('input[placeholder="请输入用户名/手机号"]', demoUser);
  await page.fill('input[placeholder="请输入密码"]', demoPassword);
  await page.click('button[type="submit"]');
  await page.waitForSelector('.admin-sidebar__nav', { timeout: 60_000 });
  await page.waitForSelector('.dashboard-page', { timeout: 60_000 });
  await page.goto(`${baseUrl}/system/users`, { waitUntil: 'load' });
  await page.waitForSelector('.semi-table, .page-container', { timeout: 60_000 });
});

await browser.close();
preview?.kill();

if (failures.length) {
  console.error(`\n✖ 冒烟失败：${failures.length} 个场景`);
  process.exit(1);
}
console.log('\n✔ 全部入口启动正常');

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.status < 500) return;
    } catch { /* 未就绪 */ }
    await sleep(300);
  }
  throw new Error(`preview 服务 ${url} 在 ${timeoutMs}ms 内未就绪`);
}

function readArg(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
