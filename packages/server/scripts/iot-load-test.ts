/**
 * IoT 遥测接入压测：批量创建虚拟设备 → 并发上报遥测 → 统计吞吐与延迟。
 *
 * 用法（需服务已启动，管理员账号可用）：
 *   npx tsx scripts/iot-load-test.ts                                  # 100 台 × 每台 1 帧/s × 30s，HTTP 接入
 *   npx tsx scripts/iot-load-test.ts --devices 500 --rate 2 --duration 60
 *   npx tsx scripts/iot-load-test.ts --transport ws                   # WS 帧上报（无逐帧回执，以服务端今日上报量差值核对）
 *   npx tsx scripts/iot-load-test.ts --batch 5                        # 每帧携带 5 个点
 *   npx tsx scripts/iot-load-test.ts --cleanup                        # 删除压测设备与产品
 *
 * 其他选项：--server http://localhost:3300  --username admin  --password 123456  --product "IoT 压测产品"
 *
 * 输出：发送帧数 / 成功 / 失败、实际吞吐（帧/s、点/s）、HTTP 延迟 p50/p95/p99/max，
 * 以及服务端「今日上报量」差值（核对落库是否完整）。压测设备复用 SN 前缀 SN-LOAD-，重复运行不重复建档。
 */
import { createHmac } from 'node:crypto';
import { arg, flag } from './lib/cli-args';

const SERVER = arg('server', 'http://localhost:3300');
const USERNAME = arg('username', 'admin');
const PASSWORD = arg('password', '123456');
const PRODUCT_NAME = arg('product', 'IoT 压测产品');
const DEVICES = Number(arg('devices', '100'));
const RATE = Number(arg('rate', '1'));
const DURATION = Number(arg('duration', '30'));
const BATCH = Number(arg('batch', '1'));
const TRANSPORT = arg('transport', 'http') as 'http' | 'ws';
const CLEANUP = flag('cleanup');
const SN_PREFIX = 'SN-LOAD-';

interface ApiEnvelope<T> { code: number; message: string; data: T }
interface Device { id: number; sn: string; secret: string; name: string }

let token = '';

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${SERVER}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || json.code !== 0) throw new Error(`${method} ${path} → ${res.status} ${json.message}`);
  return json.data;
}

async function login(): Promise<void> {
  const data = await api<{ token: { accessToken: string } }>('POST', '/api/auth/login', { username: USERNAME, password: PASSWORD });
  token = data.token.accessToken;
}

async function ensureProduct(): Promise<number> {
  const page = await api<{ list: Array<{ id: number; name: string }> }>('GET', `/api/iot/products?keyword=${encodeURIComponent(PRODUCT_NAME)}&pageSize=50`);
  const hit = page.list.find((p) => p.name === PRODUCT_NAME);
  if (hit) return hit.id;
  const created = await api<{ id: number }>('POST', '/api/iot/products', {
    name: PRODUCT_NAME, description: '压测脚本自动创建（可删除）', validationMode: 'loose', status: 'enabled',
  });
  return created.id;
}

async function listProductDevices(productId: number): Promise<Device[]> {
  const out: Device[] = [];
  for (let page = 1; ; page++) {
    const res = await api<{ list: Device[]; total: number }>('GET', `/api/iot/devices?productId=${productId}&page=${page}&pageSize=200`);
    out.push(...res.list);
    if (out.length >= res.total || res.list.length === 0) break;
  }
  return out;
}

async function ensureDevices(productId: number, count: number): Promise<Device[]> {
  const existing = await listProductDevices(productId);
  const bySn = new Map(existing.map((d) => [d.sn, d]));
  const wanted = Array.from({ length: count }, (_, i) => `${SN_PREFIX}${String(i + 1).padStart(6, '0')}`);
  const missing = wanted.filter((sn) => !bySn.has(sn));
  if (missing.length > 0) {
    console.log(`[load] 创建 ${missing.length} 台压测设备...`);
    const concurrency = 10;
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < missing.length) {
        const sn = missing[cursor++];
        const created = await api<Device>('POST', '/api/iot/devices', { productId, name: `压测设备 ${sn.slice(SN_PREFIX.length)}`, sn, nodeType: 'direct' });
        bySn.set(sn, created);
      }
    }));
  }
  return wanted.map((sn) => bySn.get(sn)!);
}

async function cleanup(): Promise<void> {
  const page = await api<{ list: Array<{ id: number; name: string }> }>('GET', `/api/iot/products?keyword=${encodeURIComponent(PRODUCT_NAME)}&pageSize=50`);
  const product = page.list.find((p) => p.name === PRODUCT_NAME);
  if (!product) { console.log('[load] 未找到压测产品，无需清理'); return; }
  const devices = await listProductDevices(product.id);
  for (let i = 0; i < devices.length; i += 100) {
    await api('DELETE', '/api/iot/devices/batch', { ids: devices.slice(i, i + 100).map((d) => d.id) });
  }
  await api('DELETE', `/api/iot/products/${product.id}`);
  console.log(`[load] 已删除 ${devices.length} 台设备与压测产品`);
}

async function telemetryToday(): Promise<number> {
  const dash = await api<{ stats: { telemetryToday: number } }>('GET', '/api/iot/dashboard');
  return dash.stats.telemetryToday;
}

function sign(secret: string, sn: string, ts: string, body: string): string {
  return createHmac('sha256', secret).update(`${sn}\n${ts}\n${body}`).digest('hex');
}

function buildFrame(seq: number) {
  const items = Array.from({ length: BATCH }, (_, i) => ({
    metrics: {
      temperature: Math.round((20 + Math.sin((seq + i) / 10) * 5 + Math.random()) * 10) / 10,
      humidity: Math.round(50 + Math.cos((seq + i) / 10) * 10 + Math.random()),
      voltage: Math.round((3.3 + Math.random() * 0.2) * 100) / 100,
      seq: seq * BATCH + i,
    },
  }));
  return { items };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Stats { sent: number; ok: number; failed: number; latencies: number[]; errors: Map<string, number>; timeline: Map<number, number[]> }

function record(stats: Stats, startedAt: number, latency: number): void {
  stats.latencies.push(latency);
  const bucket = Math.floor((Date.now() - startedAt) / 5000);
  const arr = stats.timeline.get(bucket) ?? [];
  arr.push(latency);
  stats.timeline.set(bucket, arr);
}

async function runHttp(devices: Device[]): Promise<Stats> {
  const stats: Stats = { sent: 0, ok: 0, failed: 0, latencies: [], errors: new Map(), timeline: new Map() };
  const intervalMs = 1000 / RATE;
  const startedAt = Date.now();
  const endAt = startedAt + DURATION * 1000;
  await Promise.all(devices.map(async (device, idx) => {
    // 错峰起步，避免全部设备同相位齐发
    await sleep((idx / devices.length) * intervalMs);
    let seq = 0;
    while (Date.now() < endAt) {
      const started = performance.now();
      const body = JSON.stringify(buildFrame(seq++));
      const ts = String(Math.floor(Date.now() / 1000));
      stats.sent += 1;
      try {
        const res = await fetch(`${SERVER}/api/iot/ingest/telemetry`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-IoT-Sn': device.sn,
            'X-IoT-Timestamp': ts,
            'X-IoT-Sign': sign(device.secret, device.sn, ts, body),
          },
          body,
        });
        await res.arrayBuffer();
        if (res.ok) stats.ok += 1;
        else {
          stats.failed += 1;
          stats.errors.set(`HTTP ${res.status}`, (stats.errors.get(`HTTP ${res.status}`) ?? 0) + 1);
        }
      } catch (err) {
        stats.failed += 1;
        const key = (err as Error).message.slice(0, 60);
        stats.errors.set(key, (stats.errors.get(key) ?? 0) + 1);
      }
      const elapsed = performance.now() - started;
      record(stats, startedAt, elapsed);
      const wait = intervalMs - elapsed;
      if (wait > 0) await sleep(wait);
    }
  }));
  return stats;
}

async function runWs(devices: Device[]): Promise<Stats> {
  const stats: Stats = { sent: 0, ok: 0, failed: 0, latencies: [], errors: new Map(), timeline: new Map() };
  const intervalMs = 1000 / RATE;
  const endAt = Date.now() + DURATION * 1000;
  const sockets = await Promise.all(devices.map((device) => new Promise<WebSocket | null>((resolve) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const url = `${SERVER.replace(/^http/, 'ws')}/api/iot/ws?sn=${encodeURIComponent(device.sn)}&ts=${ts}&sign=${sign(device.secret, device.sn, ts, '')}`;
    const ws = new WebSocket(url);
    ws.onopen = () => resolve(ws);
    ws.onerror = () => { stats.errors.set('ws connect error', (stats.errors.get('ws connect error') ?? 0) + 1); resolve(null); };
    ws.onclose = (evt) => { if (Date.now() < endAt) stats.errors.set(`ws closed ${evt.code}`, (stats.errors.get(`ws closed ${evt.code}`) ?? 0) + 1); };
  })));
  const live = sockets.filter((s): s is WebSocket => s !== null);
  console.log(`[load] WS 已建立 ${live.length}/${devices.length} 条连接`);
  await Promise.all(live.map(async (ws, idx) => {
    await sleep((idx / live.length) * intervalMs);
    let seq = 0;
    while (Date.now() < endAt && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'telemetry', payload: buildFrame(seq++) }));
      stats.sent += 1;
      stats.ok += 1;
      await sleep(intervalMs);
    }
  }));
  for (const ws of live) ws.close();
  return stats;
}

async function main(): Promise<void> {
  await login();
  if (CLEANUP) { await cleanup(); return; }

  const productId = await ensureProduct();
  const devices = await ensureDevices(productId, DEVICES);
  console.log(`[load] 产品 #${productId}，设备 ${devices.length} 台，${TRANSPORT.toUpperCase()} 接入，每台 ${RATE} 帧/s × ${BATCH} 点/帧，持续 ${DURATION}s`);
  console.log(`[load] 目标吞吐 ≈ ${devices.length * RATE} 帧/s（${devices.length * RATE * BATCH} 点/s）`);

  const before = await telemetryToday();
  const startedAt = Date.now();
  const stats = TRANSPORT === 'ws' ? await runWs(devices) : await runHttp(devices);
  const elapsedSec = (Date.now() - startedAt) / 1000;
  // 等待服务端微批缓冲与异步派生动作收尾：连续两次读数不变即视为写完（最多等 20s）
  let after = await telemetryToday();
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    const next = await telemetryToday();
    if (next === after) break;
    after = next;
  }

  const sorted = [...stats.latencies].sort((a, b) => a - b);
  const fmt = (n: number) => n.toFixed(1);
  console.log('\n──────── 压测结果 ────────');
  console.log(`耗时           ${fmt(elapsedSec)} s`);
  console.log(`发送帧数       ${stats.sent}（成功 ${stats.ok}，失败 ${stats.failed}）`);
  console.log(`实际吞吐       ${fmt(stats.ok / elapsedSec)} 帧/s，${fmt((stats.ok * BATCH) / elapsedSec)} 点/s`);
  if (sorted.length > 0) {
    console.log(`HTTP 延迟      p50 ${fmt(percentile(sorted, 50))} ms | p95 ${fmt(percentile(sorted, 95))} ms | p99 ${fmt(percentile(sorted, 99))} ms | max ${fmt(sorted[sorted.length - 1])} ms`);
    console.log('按 5s 窗口     ' + [...stats.timeline.entries()].sort((a, b) => a[0] - b[0]).map(([bucket, lat]) => {
      const s = [...lat].sort((a, b) => a - b);
      return `[${bucket * 5}-${bucket * 5 + 5}s] ${(lat.length / 5).toFixed(0)}帧/s p50=${fmt(percentile(s, 50))} p95=${fmt(percentile(s, 95))}`;
    }).join('\n               '));
  }
  console.log(`服务端今日上报 ${before} → ${after}（+${after - before}，期望 +${stats.ok * BATCH}）`);
  if (stats.errors.size > 0) {
    console.log('错误分布:');
    for (const [k, v] of stats.errors) console.log(`  ${k}: ${v}`);
  }
}

main().catch((err) => {
  console.error('[load] 失败:', (err as Error).message);
  process.exit(1);
});
