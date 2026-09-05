#!/usr/bin/env node
/**
 * 运行时首屏基准：用系统 Chrome（Playwright channel=chrome，无需下载浏览器）访问已构建并由
 * `vite preview` 托管的站点，记录两条冷缓存链路的请求数 / 传输字节 / 时序，取多次中位数。
 *
 *   npm run preview -w @zenith/web            # 另一终端：托管 dist（/api 代理到 3300）
 *   node scripts/bench-runtime.mjs --url http://localhost:4173 --api http://localhost:3300 \
 *        --user admin --password 123456 --runs 3 --latency 50 --json out.json
 *
 * 链路 A：匿名冷启动 `/login`，等到登录表单可交互
 * 链路 B：已登录冷启动 `/`（token 预置进 localStorage），等到侧栏与仪表盘内容出现
 * `--latency N`（ms）/ `--download Mbps` 通过 CDP 注入网络条件，用来暴露请求数对耗时的影响；默认不限速。
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const args = parseArgs(process.argv.slice(2));
const baseUrl = (args.url ?? 'http://localhost:4173').replace(/\/$/, '');
const apiUrl = (args.api ?? 'http://localhost:3300').replace(/\/$/, '');
const runs = Number(args.runs ?? 3);
const latencyMs = Number(args.latency ?? 0);
const downloadMbps = Number(args.download ?? 0);
const TOKEN_KEY = 'zenith_token';
const REFRESH_TOKEN_KEY = 'zenith_refresh_token';

const loginRes = await fetch(`${apiUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ username: args.user ?? 'admin', password: args.password ?? '123456' }),
});
const loginJson = await loginRes.json();
const token = loginJson?.data?.token;
if (!token?.accessToken) {
  console.error('登录失败，无法执行已登录链路：', JSON.stringify(loginJson).slice(0, 200));
  process.exit(2);
}

const browser = await chromium.launch({ channel: args.channel ?? 'chrome', headless: true });

async function runScenario(name, prepare, waitFor) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (latencyMs || downloadMbps) {
      await cdp.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: latencyMs,
        downloadThroughput: downloadMbps ? (downloadMbps * 1024 * 1024) / 8 : -1,
        uploadThroughput: downloadMbps ? (downloadMbps * 1024 * 1024) / 8 : -1,
      });
    }
    const stats = { requests: 0, js: 0, css: 0, api: 0, other: 0, encodedBytes: 0, jsEncodedBytes: 0 };
    const requestTypes = new Map();
    cdp.on('Network.requestWillBeSent', (e) => {
      if (!e.request.url.startsWith(baseUrl)) return;
      requestTypes.set(e.requestId, e.request.url);
    });
    cdp.on('Network.loadingFinished', (e) => {
      const url = requestTypes.get(e.requestId);
      if (!url) return;
      stats.requests++;
      stats.encodedBytes += e.encodedDataLength;
      if (/\.js(\?|$)/.test(url)) { stats.js++; stats.jsEncodedBytes += e.encodedDataLength; } else if (/\.css(\?|$)/.test(url)) stats.css++; else if (url.includes('/api/')) stats.api++; else stats.other++;
    });
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
    page.on('pageerror', (err) => errors.push(`pageerror: ${String(err).slice(0, 200)}`));
    await prepare(page, context);
    await page.addInitScript(() => {
      window.__lcp = 0;
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__lcp = Math.max(window.__lcp, e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true });
    });
    const t0 = Date.now();
    await page.goto(`${baseUrl}${name === 'login' ? '/login' : '/'}`, { waitUntil: 'commit' });
    await waitFor(page);
    const interactiveMs = Date.now() - t0;
    // 让尾部请求（埋点、图标表）落地后再取统计
    await page.waitForTimeout(1500);
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      return { domContentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), lcp: Math.round(window.__lcp) };
    });
    samples.push({ interactiveMs, ...nav, ...stats, encodedKB: Math.round(stats.encodedBytes / 1024), jsEncodedKB: Math.round(stats.jsEncodedBytes / 1024), errors });
    await context.close();
  }
  return { median: median(samples), samples };
}

function median(samples) {
  const out = {};
  for (const key of Object.keys(samples[0])) {
    if (key === 'errors') { out.errors = [...new Set(samples.flatMap((s) => s.errors))]; continue; }
    const vals = samples.map((s) => s[key]).sort((a, b) => a - b);
    out[key] = vals[Math.floor(vals.length / 2)];
  }
  return out;
}

const login = await runScenario('login', async () => {}, async (page) => {
  await page.waitForSelector('input[placeholder="请输入密码"]', { timeout: 60_000 });
});

const dashboard = await runScenario('dashboard', async (page) => {
  await page.addInitScript(([k1, v1, k2, v2]) => {
    localStorage.setItem(k1, v1);
    localStorage.setItem(k2, v2);
  }, [TOKEN_KEY, token.accessToken, REFRESH_TOKEN_KEY, token.refreshToken]);
}, async (page) => {
  await page.waitForSelector('.admin-sidebar__nav', { timeout: 60_000 });
  await page.waitForSelector('.dashboard-page', { timeout: 60_000 });
});

await browser.close();

const result = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  network: latencyMs || downloadMbps ? { latencyMs, downloadMbps } : 'unthrottled',
  runs,
  login: login.median,
  dashboard: dashboard.median,
  samples: { login: login.samples, dashboard: dashboard.samples },
};

console.log(`\n网络：${typeof result.network === 'string' ? result.network : `RTT ${latencyMs} ms / ${downloadMbps || '∞'} Mbps`}，${runs} 次取中位数`);
console.log('| 链路 | 请求数 | JS 请求 | CSS | API | 传输 KB | JS 传输 KB | 可交互 ms | LCP ms | load ms | 控制台错误 |');
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const [label, m] of [['匿名 /login', login.median], ['已登录 /（仪表盘）', dashboard.median]]) {
  console.log(`| ${label} | ${m.requests} | ${m.js} | ${m.css} | ${m.api} | ${m.encodedKB} | ${m.jsEncodedKB} | ${m.interactiveMs} | ${m.lcp} | ${m.load} | ${m.errors.length} |`);
}
if (login.median.errors.length || dashboard.median.errors.length) {
  console.log('\n控制台错误：');
  for (const e of [...login.median.errors, ...dashboard.median.errors]) console.log(`  - ${e}`);
}
if (args.json) {
  const p = resolve(args.json);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(result, null, 2));
  console.log(`\n已写入 ${p}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[a.slice(2)] = next; i++; } else out[a.slice(2)] = true;
  }
  return out;
}
