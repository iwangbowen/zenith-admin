/**
 * IoT 模拟设备：跑通「WS 接入 → 遥测上报 → 指令/期望属性接收 → 回执/回报」全链路。
 *
 * 用法（默认连演示设备 1 号）：
 *   npx tsx scripts/simulate-iot-device.ts
 *   npx tsx scripts/simulate-iot-device.ts --sn SN-XXX --secret yyy --server http://localhost:3300
 *   npx tsx scripts/simulate-iot-device.ts --hot              # 上报 36~38℃ 高温，触发阈值告警
 *   npx tsx scripts/simulate-iot-device.ts --event sensor_fault  # 启动后上报一次故障事件
 *   npx tsx scripts/simulate-iot-device.ts --gateway           # 网关模式：代理演示子设备批量上报
 *   npx tsx scripts/simulate-iot-device.ts --log               # 周期上报设备运行日志（log 帧）
 *
 * 行为：
 * - WS 在线 + 按 report_interval（默认 15s，可被期望属性远程调整）上报温湿度
 * - 收到 command:exec 帧 2s 后回 ACK 成功
 * - 收到 shadow:desired 帧应用期望值并随下一次遥测回报（服务端按键收敛 desired）
 * - 收到 ota:upgrade 帧模拟下载/安装进度回报，完成后以新版本上报遥测（服务端按版本确认成功）
 * Ctrl+C 断开（管理端在线态随之变为离线）。
 */
import { createHmac } from 'node:crypto';
import { arg, flag } from './lib/cli-args';

const SERVER = arg('server', 'http://localhost:3300');
const GATEWAY_MODE = flag('gateway');
const LOG_MODE = flag('log');
const SN = arg('sn', GATEWAY_MODE ? 'SN-DEMO-GW-0001' : 'SN-DEMO-TH100-0001');
const SECRET = arg('secret', GATEWAY_MODE
  ? 'demogw01secretgw01demogw01secretgw01demogw01sec3'
  : 'demo0001secret0001demo0001secret0001demo0001sec1');
const HOT_MODE = flag('hot');
const STARTUP_EVENT = arg('event', '');
/** 网关模式代理的子设备 SN（默认演示子设备） */
const SUB_SNS = arg('subs', 'SN-DEMO-SUB-0001,SN-DEMO-SUB-0002').split(',').map((s) => s.trim()).filter(Boolean);

/** 设备本地属性状态（rw 属性可被期望值覆盖） */
const state: Record<string, number | string | boolean> = {
  report_interval: 15,
  led_enabled: true,
};

let firmwareVersion = arg('fw', '1.2.0');

function sign(ts: string, body: string): string {
  return createHmac('sha256', SECRET).update(`${SN}\n${ts}\n${body}`).digest('hex');
}

function buildMetrics() {
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const phase = Math.sin(((hour - 14) / 24) * Math.PI * 2);
  const temperature = HOT_MODE
    ? Math.round((36.5 + Math.random() * 1.5) * 10) / 10
    : Math.round((24 + phase * 3 + (Math.random() - 0.5)) * 10) / 10;
  return {
    temperature,
    humidity: Math.round(50 - phase * 8 + (Math.random() - 0.5) * 4),
    report_interval: state.report_interval,
    led_enabled: state.led_enabled,
  };
}

const ts = String(Math.floor(Date.now() / 1000));
const wsUrl = `${SERVER.replace(/^http/, 'ws')}/api/iot/ws?sn=${encodeURIComponent(SN)}&ts=${ts}&sign=${sign(ts, '')}`;

console.log(`[sim] 连接 ${wsUrl.slice(0, 60)}...`);
const ws = new WebSocket(wsUrl);

let reportTimer: ReturnType<typeof setTimeout> | null = null;

function report() {
  if (GATEWAY_MODE) {
    // 网关模式：代理子设备批量上报（gateway:batch 帧），子设备在线态随之续期
    const items = SUB_SNS.map((subSn) => ({ subSn, metrics: buildMetrics() }));
    ws.send(JSON.stringify({ type: 'gateway:batch', payload: { items } }));
    console.log(`[sim] 📤 网关代理上报 ${items.length} 台子设备`, items.map((i) => `${i.subSn}:${String((i.metrics as { temperature: number }).temperature)}℃`).join(' '));
  } else {
    const metrics = buildMetrics();
    ws.send(JSON.stringify({ type: 'telemetry', payload: { items: [{ metrics }], firmwareVersion } }));
    console.log(`[sim] 📤 上报遥测 (fw ${firmwareVersion})`, metrics);
  }
  if (LOG_MODE) {
    const levels = ['debug', 'info', 'warn'] as const;
    ws.send(JSON.stringify({
      type: 'log',
      payload: { items: [{ level: levels[Math.floor(Math.random() * levels.length)], tag: 'sim', content: `heartbeat ok, uptime=${process.uptime().toFixed(0)}s, rssi=${-40 - Math.floor(Math.random() * 30)}dBm` }] },
    }));
  }
  reportTimer = setTimeout(report, Number(state.report_interval) * 1000);
}

ws.onopen = () => {
  console.log(`[sim] ✅ 已连接，设备 ${SN} 在线${HOT_MODE ? '（高温模式）' : ''}${GATEWAY_MODE ? `（网关模式，代理 ${SUB_SNS.length} 台子设备）` : ''}`);
  report();
  setInterval(() => ws.send(JSON.stringify({ type: 'heartbeat' })), 30_000);
  if (STARTUP_EVENT) {
    const payload = STARTUP_EVENT === 'sensor_fault' ? { code: 'E-101' } : { temperature: 37.5 };
    ws.send(JSON.stringify({ type: 'event', payload: { items: [{ identifier: STARTUP_EVENT, payload }] } }));
    console.log(`[sim] 🚨 已上报事件 ${STARTUP_EVENT}`, payload);
  }
};

ws.onmessage = (evt) => {
  const frame = JSON.parse(String(evt.data)) as {
    type: string;
    payload?: {
      commandId?: number; service?: string; params?: unknown; version?: number | string;
      desired?: Record<string, number | string | boolean>;
      taskId?: number; fileName?: string; sha256?: string; downloadPath?: string;
    };
  };
  if (frame.type === 'command:exec' && frame.payload?.commandId) {
    const { commandId, service, params } = frame.payload;
    console.log(`[sim] 📥 收到指令 #${commandId} ${service}`, params ?? '');
    setTimeout(() => {
      ws.send(JSON.stringify({
        type: 'command:ack',
        payload: { commandId, success: true, response: { executed: service, at: new Date().toISOString() } },
      }));
      console.log(`[sim] ✅ 已回执 #${commandId}`);
    }, 2_000);
  } else if (frame.type === 'shadow:desired' && frame.payload?.desired) {
    const { version, desired } = frame.payload;
    console.log(`[sim] 📥 收到期望属性 v${version}`, desired);
    Object.assign(state, desired);
    // 立即回报一次，让服务端按键收敛 desired
    if (reportTimer) clearTimeout(reportTimer);
    report();
  } else if (frame.type === 'ota:upgrade' && frame.payload?.taskId) {
    const { taskId, version, fileName } = frame.payload;
    console.log(`[sim] 📥 收到 OTA 升级 任务#${taskId} → v${version}（${fileName}）`);
    const progress = (status: string, pct?: number, delay = 0) => setTimeout(() => {
      ws.send(JSON.stringify({ type: 'ota:progress', payload: { taskId, status, ...(pct !== undefined ? { progress: pct } : {}) } }));
      console.log(`[sim] 📶 OTA ${status}${pct !== undefined ? ` ${pct}%` : ''}`);
    }, delay);
    progress('downloading', 30, 1_000);
    progress('downloading', 80, 3_000);
    progress('installing', 90, 5_000);
    // 安装完成：切换版本并立即上报遥测，服务端按版本一致自动确认成功
    setTimeout(() => {
      firmwareVersion = String(version);
      console.log(`[sim] ✅ OTA 安装完成，当前固件 v${firmwareVersion}`);
      if (reportTimer) clearTimeout(reportTimer);
      report();
    }, 7_000);
  } else if (frame.type === 'heartbeat:ack') {
    console.log('[sim] 💓 心跳确认');
  }
};

ws.onclose = (evt) => {
  console.log(`[sim] 连接关闭 code=${evt.code} reason=${evt.reason}`);
  process.exit(0);
};

ws.onerror = () => console.error('[sim] 连接错误');
