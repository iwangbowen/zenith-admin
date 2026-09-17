/**
 * 会话回放采集（rrweb）：统一分段流式流水线，双启动模式。
 *
 * - stream 模式：会话被 replaySessionSampleRate 采样命中 → 从进入即持续录制上传；
 * - buffer 模式：replayOnError 开启时常驻录制，事件仅进内存环形缓冲
 *   （保留最近 2 个 checkout 窗口 ≈ 30-60s），触发器命中（错误/手动）时
 *   把缓冲作为首批分片上传并切换为持续上传。
 *
 * 关键约束：
 * - rrweb 懒加载：远程配置开启后才 import，关闭时零体积零开销；
 * - 分片 gzip（CompressionStream）后 multipart 上报，(replayId, seq) 幂等；
 * - 隐私默认安全：maskAllInputs 恒开，可配 maskAllText / blockSelector；
 * - 任何内部异常静默（监控自身不得拖垮业务应用）。
 */
import { TOKEN_KEY, randomUUID } from '@zenith/shared/core';
import type { AnalyticsPublicConfig, ReplayTrigger, ReplayTriggerType } from '@zenith/shared/analytics';
import { analyticsRequestHeaders } from './http';
import { analyticsStorageKey } from './runtime-config';
import type { AnalyticsRuntimeBaseConfig } from './runtime-config';

// ─── 运行时参数（tracker.configureTracker 单向同步）──────────────────────────
export interface ReplayRuntimeConfig extends AnalyticsRuntimeBaseConfig {
  sdkVersion?: string;
}

let runtime: ReplayRuntimeConfig = {
  apiBase: '/api',
  tokenKey: TOKEN_KEY,
  source: 'web_admin',
  appId: 'admin',
  deploymentId: 'default',
  environment: 'development',
  sdkVersion: undefined,
  consentProvider: () => true,
  siteKey: undefined,
};

export function configureReplayRuntime(next: Partial<ReplayRuntimeConfig>): void {
  runtime = { ...runtime, ...next };
}

// ─── 常量 ─────────────────────────────────────────────────────────────────────
const CHECKOUT_EVERY_MS = 30_000;
const STREAM_FLUSH_INTERVAL_MS = 10_000;
const STREAM_FLUSH_MAX_EVENTS = 800;
const MAX_SEGMENTS = 600;
const SAMPLED_KEY = 'zenith_replay_sampled';

// rrweb 事件最小结构类型（避免静态依赖 rrweb 类型导致主包体积增长）
interface RrwebEvent { type: number; timestamp: number; data?: unknown }
const EVENT_FULL_SNAPSHOT = 2;
const EVENT_INCREMENTAL = 3;
const EVENT_META = 4;
const INCREMENTAL_SOURCE_MOUSE_INTERACTION = 2;
const MOUSE_INTERACTION_CLICK = 2;

// ─── 内部状态 ─────────────────────────────────────────────────────────────────
type Phase = 'idle' | 'buffering' | 'streaming';

let phase: Phase = 'idle';
let stopRecording: (() => void) | null = null;
let addCustomEventFn: ((tag: string, payload: unknown) => void) | null = null;
let replayId: string | null = null;
let replaySessionId = '';
let startedAtMs = 0;
let seq = 0;
let triggers: ReplayTrigger[] = [];
let entryPageUrl = '';
/** buffer 模式：checkout 窗口环形缓冲（每个窗口以 FullSnapshot 开头，最多 2 个） */
let bufferWindows: RrwebEvent[][] = [];
/** streaming 模式：待上传事件队列 */
let pending: RrwebEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let uploading = Promise.resolve();
let lifecycleBound = false;
let activeConfig: (Pick<AnalyticsPublicConfig, 'trackReplay' | 'replaySessionSampleRate' | 'replayOnError' | 'replayMaskAllText' | 'replayBlockSelector' | 'maskInputs'> & { consent: boolean }) | null = null;

/** 当前活跃回放会话 ID（error-reporter 上报错误时注入 payload） */
export function getActiveReplayId(): string | null {
  return phase === 'streaming' ? replayId : null;
}

// ─── 采集启动 / 停止 ──────────────────────────────────────────────────────────
/**
 * tracker.applyConfig 驱动：按远程配置决定录制形态。
 * 配置热更新收敛：开→关立即停止；参数变化重启录制。
 */
export function applyReplayConfig(config: AnalyticsPublicConfig, sessionId: string): void {
  try {
    const next = {
      trackReplay: config.trackReplay,
      replaySessionSampleRate: config.replaySessionSampleRate,
      replayOnError: config.replayOnError,
      replayMaskAllText: config.replayMaskAllText,
      replayBlockSelector: config.replayBlockSelector,
      maskInputs: config.maskInputs,
      // consent 纳入快照：会员端「同意采集」授予后（false→true）必须穿透短路重新评估
      consent: runtime.consentProvider(),
    };
    const unchanged = activeConfig && JSON.stringify(activeConfig) === JSON.stringify(next);
    if (unchanged) return;
    activeConfig = next;

    if (!config.enabled || !config.trackReplay || !next.consent) {
      void teardown(false);
      return;
    }
    // 会话级采样决策缓存（同 tracker isSampled 模式）：命中 → stream，否则错误缓冲
    const sampled = isReplaySampled(config.replaySessionSampleRate);
    if (sampled) {
      void startRecording('stream', sessionId, [{ type: 'sampled', at: new Date().toISOString() }]);
    } else if (config.replayOnError) {
      void startRecording('buffer', sessionId, []);
    } else {
      void teardown(false);
    }
  } catch { /* never break the app */ }
}

function isReplaySampled(rate: number): boolean {
  if (rate <= 0) return false;
  try {
    const key = analyticsStorageKey(runtime.deploymentId, SAMPLED_KEY, runtime.appId);
    const cached = sessionStorage.getItem(key);
    if (cached != null) return cached === '1';
    const sampled = Math.random() < rate;
    sessionStorage.setItem(key, sampled ? '1' : '0');
    return sampled;
  } catch { return false; }
}

async function startRecording(mode: 'buffer' | 'stream', sessionId: string, initialTriggers: ReplayTrigger[]): Promise<void> {
  // gzip 能力是硬前提（服务端只收 gz）；极老浏览器直接放弃回放
  if (typeof CompressionStream === 'undefined') return;
  await teardown(false);

  let record: typeof import('rrweb').record;
  try {
    ({ record } = await import('rrweb'));
  } catch { return; }
  if (!activeConfig?.trackReplay) return; // 异步加载期间配置可能已关闭
  addCustomEventFn = (tag, payload) => {
    try { record.addCustomEvent(tag, payload); } catch { /* ignore */ }
  };

  replaySessionId = sessionId;
  replayId = randomUUID();
  startedAtMs = Date.now();
  seq = 0;
  triggers = [...initialTriggers];
  entryPageUrl = globalThis.location?.href?.slice(0, 512) ?? '';
  bufferWindows = [];
  pending = [];
  phase = mode === 'stream' ? 'streaming' : 'buffering';

  try {
    const stop = record({
      emit: (event: RrwebEvent, isCheckout?: boolean) => handleEvent(event, isCheckout === true),
      checkoutEveryNms: CHECKOUT_EVERY_MS,
      maskAllInputs: activeConfig.maskInputs !== false,
      maskInputOptions: { password: true },
      ...(activeConfig.replayMaskAllText ? { maskTextSelector: '*' } : {}),
      ...(activeConfig.replayBlockSelector ? { blockSelector: activeConfig.replayBlockSelector } : {}),
      slimDOMOptions: { script: true, comment: true },
    });
    stopRecording = stop ?? null;
  } catch { phase = 'idle'; return; }

  if (phase === 'streaming') startFlushLoop();
  bindLifecycle();
}

function handleEvent(event: RrwebEvent, isCheckout: boolean): void {
  try {
    if (phase === 'buffering') {
      // checkout（含首次 FullSnapshot）开新窗口，只保留最近 2 个窗口
      if (isCheckout || (event.type === EVENT_FULL_SNAPSHOT && bufferWindows.length === 0)) {
        bufferWindows.push([]);
        if (bufferWindows.length > 2) bufferWindows.shift();
      }
      if (bufferWindows.length === 0) bufferWindows.push([]);
      bufferWindows[bufferWindows.length - 1].push(event);
    } else if (phase === 'streaming') {
      pending.push(event);
      if (pending.length >= STREAM_FLUSH_MAX_EVENTS) void flushPending(false);
    }
  } catch { /* ignore */ }
}

/**
 * 触发器命中：buffer → 缓冲整体作为首分片上传并转 streaming；
 * streaming → 仅追加触发记录。返回本次关联的 replayId（error-reporter 同步取用）。
 */
export function notifyReplayTrigger(type: ReplayTriggerType, refId?: string): string | null {
  try {
    if (phase === 'idle' || !replayId) return null;
    triggers.push({ type, at: new Date().toISOString(), ...(refId ? { refId } : {}) });
    if (phase === 'buffering') {
      phase = 'streaming';
      const buffered = bufferWindows.flat();
      bufferWindows = [];
      pending = [...buffered, ...pending];
      void flushPending(false);
      startFlushLoop();
    }
    return replayId;
  } catch { return null; }
}

/** 手动开始持续录制（如反馈联动场景）；buffer 模式下等价触发 manual */
export function startManualReplay(): string | null {
  return notifyReplayTrigger('manual');
}

/**
 * 向录制流写入自定义事件（rrweb EventType.Custom）：
 * 行为面包屑（导航/点击/HTTP/console）经此进入回放时间轴，播放器据此渲染打点。
 */
export function addReplayCustomEvent(tag: string, payload: unknown): void {
  try {
    if (phase === 'idle') return;
    addCustomEventFn?.(tag, payload);
  } catch { /* ignore */ }
}

function startFlushLoop(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => { void flushPending(false); }, STREAM_FLUSH_INTERVAL_MS);
}

// ─── 分片上传 ─────────────────────────────────────────────────────────────────
async function gzipJson(events: RrwebEvent[]): Promise<Blob> {
  const stream = new Blob([JSON.stringify(events)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob();
}

interface SegmentStats {
  pages: number;
  clicks: number;
  hasFullSnapshot: boolean;
  /** 分片内访问的页面路径（去重，检索索引用） */
  pagePaths: string[];
  /** 分片内点击的元素文案（面包屑提取，去重，检索索引用） */
  clickLabels: string[];
  /** 归一化点击坐标（按当时页面路径分组，热力聚合用） */
  clickPoints: Array<{ path: string; x: number; y: number }>;
}

function countStats(events: RrwebEvent[]): SegmentStats {
  let pages = 0;
  let clicks = 0;
  let hasFullSnapshot = false;
  const pagePaths = new Set<string>();
  const clickLabels = new Set<string>();
  const clickPoints: Array<{ path: string; x: number; y: number }> = [];
  let currentPath = '';
  let viewportW = 0;
  let viewportH = 0;
  for (const e of events) {
    if (e.type === EVENT_META) {
      pages += 1;
      const d = e.data as { href?: string; width?: number; height?: number } | undefined;
      if (d?.width && d?.height) { viewportW = d.width; viewportH = d.height; }
      if (d?.href) {
        try {
          currentPath = new URL(d.href).pathname.slice(0, 256);
          if (pagePaths.size < 20) pagePaths.add(currentPath);
        } catch { /* ignore */ }
      }
    } else if (e.type === EVENT_FULL_SNAPSHOT) {
      hasFullSnapshot = true;
    } else if (e.type === EVENT_INCREMENTAL) {
      const d = e.data as { source?: number; type?: number; x?: number; y?: number } | undefined;
      if (d?.source === INCREMENTAL_SOURCE_MOUSE_INTERACTION && d?.type === MOUSE_INTERACTION_CLICK) {
        clicks += 1;
        if (clickPoints.length < 100 && viewportW > 0 && viewportH > 0 && typeof d.x === 'number' && typeof d.y === 'number') {
          clickPoints.push({
            path: currentPath,
            x: Math.min(100, Math.max(0, Math.round((d.x / viewportW) * 100))),
            y: Math.min(100, Math.max(0, Math.round((d.y / viewportH) * 100))),
          });
        }
      }
    } else if (e.type === 5) {
      // 点击面包屑（自定义事件）：语义化元素文案
      const d = e.data as { tag?: string; payload?: { type?: string; message?: string } } | undefined;
      if (d?.tag === 'breadcrumb' && d.payload?.type === 'click' && d.payload.message && clickLabels.size < 30) {
        clickLabels.add(d.payload.message.slice(0, 64));
      }
    }
  }
  return { pages, clicks, hasFullSnapshot, pagePaths: [...pagePaths], clickLabels: [...clickLabels], clickPoints };
}

/** 串行 flush（uploading 链）：分片按 seq 有序到达，避免并发交错 */
function flushPending(final: boolean): Promise<void> {
  const events = pending;
  if (events.length === 0 && !final) return uploading;
  pending = [];
  const currentSeq = seq;
  seq += 1;
  if (final) {
    // 终包旁路串行链：pagehide 下不等待前序分片的异步 gzip，立即 keepalive 发出
    return uploadSegment(events, currentSeq, true);
  }
  uploading = uploading.then(() => uploadSegment(events, currentSeq, false)).catch(() => { /* ignore */ });
  return uploading;
}

async function uploadSegment(events: RrwebEvent[], segmentSeq: number, final: boolean): Promise<void> {
  try {
    if (!replayId || segmentSeq >= MAX_SEGMENTS) return;
    if (events.length === 0 && !final) return;
    const stats = countStats(events);
    const fromTs = events.length > 0 ? events[0].timestamp : Date.now();
    const toTs = events.length > 0 ? events[events.length - 1].timestamp : Date.now();
    const meta = {
      replayId,
      sessionId: replaySessionId,
      seq: segmentSeq,
      mode: 'stream' as const,
      triggers,
      startedAt: startedAtMs,
      fromTs,
      toTs,
      eventCount: events.length,
      hasFullSnapshot: stats.hasFullSnapshot,
      pageCount: stats.pages,
      clickCount: stats.clicks,
      pagePaths: stats.pagePaths,
      clickLabels: stats.clickLabels,
      clickPoints: stats.clickPoints,
      final,
      entryPageUrl,
      sdkVersion: runtime.sdkVersion,
      source: runtime.source,
      appId: runtime.appId,
      environment: runtime.environment,
    };
    // 首分片带 mode 真实起始形态（服务端 upsert 只在 insert 时取 mode）
    if (segmentSeq === 0) meta.mode = (triggers.some((t) => t.type === 'sampled') ? 'stream' : 'buffer') as 'stream';

    // final 包（pagehide 场景）：CompressionStream 异步在页面冻结前无法完成，
    // 改发原始 JSON（服务端按 gzip magic 检测并兜底压缩），确保 keepalive 送达；
    // keepalive 有 64KB body 上限，超限时从头部丢弃事件保住最后现场
    let blob: Blob;
    if (final) {
      let payload = JSON.stringify(events);
      let trimmed = events;
      while (payload.length > 60_000 && trimmed.length > 1) {
        trimmed = trimmed.slice(Math.ceil(trimmed.length / 4));
        payload = JSON.stringify(trimmed);
      }
      blob = new Blob([payload], { type: 'application/json' });
    } else {
      blob = await gzipJson(events);
    }
    const form = new FormData();
    form.append('meta', JSON.stringify(meta));
    form.append('data', blob, 'segment.json.gz');
    const token = localStorage.getItem(runtime.tokenKey);
    const headers = analyticsRequestHeaders({ token, siteKey: runtime.siteKey, includeJson: false });
    await fetch(`${runtime.apiBase}/session-replays/segments`, {
      method: 'POST',
      headers,
      body: form,
      // 终包走 keepalive 保证 unload 后仍能送达（64KB 上限内的小尾片）
      keepalive: final,
    });
  } catch { /* ignore */ }
}

// ─── 生命周期 ─────────────────────────────────────────────────────────────────
function bindLifecycle(): void {
  if (lifecycleBound) return;
  lifecycleBound = true;
  try {
    // pagehide 比 beforeunload 更可靠（bfcache/移动端）；隐藏即尽力送出终包
    globalThis.addEventListener?.('pagehide', () => { void finalizeNow(); });
    document.addEventListener?.('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && phase === 'streaming') void flushPending(false);
    });
  } catch { /* ignore */ }
}

function finalizeNow(): Promise<void> {
  if (phase !== 'streaming') return Promise.resolve();
  return flushPending(true);
}

async function teardown(sendFinal: boolean): Promise<void> {
  try {
    if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
    if (sendFinal && phase === 'streaming') await flushPending(true);
    stopRecording?.();
  } catch { /* ignore */ } finally {
    stopRecording = null;
    addCustomEventFn = null;
    phase = 'idle';
    replayId = null;
    bufferWindows = [];
    pending = [];
    triggers = [];
  }
}

/** 停止回放采集并尽力送出终包（登出等场景） */
export function stopReplay(): Promise<void> {
  return teardown(true);
}
