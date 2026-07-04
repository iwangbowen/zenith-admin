/**
 * 前端埋点 SDK（对标 PostHog / 神策）：
 * - 自动采集（页面、点击 autocapture）、自定义事件、属性袋
 * - 环境/来源上下文（UTM/referrer/screen/lang）、匿名→登录身份合并
 * - Web Vitals 性能采集、API 请求监控、离线缓存重试
 * - 远程配置（开关/采样/黑名单/DNT）
 */
import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from 'web-vitals';
import { TOKEN_KEY } from '@zenith/shared';
import type { TrackEventInput, AnalyticsPublicConfig, UserBehaviorEventType } from '@zenith/shared';
import { addBreadcrumb } from './breadcrumbs';
import { reportError } from './error-reporter';

const FLUSH_INTERVAL_MS = 15_000;
const MAX_BUFFER_SIZE = 50;
const PRE_BUFFER_MAX = 100;
const UNLOAD_CHUNK_SIZE = 20; // 卸载兜底分片大小，规避 sendBeacon/keepalive 64KB body 上限
const SLOW_API_MS = 2000;
const SESSION_KEY = 'zenith_tracker_sid';
const SESSION_TS_KEY = 'zenith_tracker_sid_ts';
const SAMPLED_KEY = 'zenith_tracker_sampled';
const ANON_KEY = 'zenith_anon_id';
const QUEUE_KEY = 'zenith_tracker_queue';
const SESSION_IDLE_MS = 30 * 60_000;

const DEFAULT_CONFIG: AnalyticsPublicConfig = {
  enabled: true,
  sampleRate: 1,
  trackPageviews: true,
  trackClicks: true,
  trackPerformance: true,
  trackErrors: true,
  trackApi: true,
  maskInputs: true,
  respectDnt: false,
  blacklistPaths: [],
};

type PendingEvent = Omit<TrackEventInput, 'sessionId' | 'anonymousId' | 'distinctId'>;

function uuid(): string {
  try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
}

// maskInputs=true 时对采集文本脱敏：手机号 / 邮箱 / 身份证号
const SENSITIVE_PATTERNS: RegExp[] = [
  /1[3-9]\d{9}/g,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\d{17}[\dXx]|\d{15}/g,
];

function maskSensitiveText(text: string): string {
  let out = text;
  for (const re of SENSITIVE_PATTERNS) out = out.replace(re, '***');
  return out;
}

// 事件类型 → 远程采集开关映射（identify / custom 恒定开启）
const TYPE_SWITCH: Partial<Record<UserBehaviorEventType, keyof AnalyticsPublicConfig>> = {
  page_view: 'trackPageviews',
  page_leave: 'trackPageviews',
  feature_use: 'trackClicks',
  area_click: 'trackClicks',
  perf: 'trackPerformance',
  api_request: 'trackApi',
};

function parseUtm(): Partial<TrackEventInput> {
  try {
    const p = new URLSearchParams(globalThis.location.search);
    const out: Partial<TrackEventInput> = {};
    if (p.get('utm_source')) out.utmSource = p.get('utm_source')!;
    if (p.get('utm_medium')) out.utmMedium = p.get('utm_medium')!;
    if (p.get('utm_campaign')) out.utmCampaign = p.get('utm_campaign')!;
    if (p.get('utm_term')) out.utmTerm = p.get('utm_term')!;
    if (p.get('utm_content')) out.utmContent = p.get('utm_content')!;
    return out;
  } catch { return {}; }
}

class Tracker {
  private buffer: TrackEventInput[] = [];
  private preBuffer: PendingEvent[] = [];
  private config: AnalyticsPublicConfig = DEFAULT_CONFIG;
  private configLoaded = false;
  private distinctId: string | null = null;
  private username: string | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private initialized = false;
  private readonly utm = parseUtm();
  private readonly referrer = (() => { try { return document.referrer || undefined; } catch { return undefined; } })();

  // ─── 身份 / 会话 ──────────────────────────────────────────────────────────
  private getAnonymousId(): string {
    try {
      let id = localStorage.getItem(ANON_KEY);
      if (!id) { id = uuid(); localStorage.setItem(ANON_KEY, id); }
      return id;
    } catch { return uuid(); }
  }

  private getSessionId(): string {
    try {
      const now = Date.now();
      const ts = Number(sessionStorage.getItem(SESSION_TS_KEY) || 0);
      let id = sessionStorage.getItem(SESSION_KEY);
      if (!id || now - ts > SESSION_IDLE_MS) {
        id = uuid();
        sessionStorage.setItem(SESSION_KEY, id);
        sessionStorage.removeItem(SAMPLED_KEY);
      }
      sessionStorage.setItem(SESSION_TS_KEY, String(now));
      return id;
    } catch { return uuid(); }
  }

  private isSampled(): boolean {
    try {
      const cached = sessionStorage.getItem(SAMPLED_KEY);
      if (cached != null) return cached === '1';
      const sampled = Math.random() < this.config.sampleRate;
      sessionStorage.setItem(SAMPLED_KEY, sampled ? '1' : '0');
      return sampled;
    } catch { return true; }
  }

  identify(userId: number | string, username?: string): void {
    const next = `u:${userId}`;
    if (this.distinctId === next) { if (username) this.username = username; return; }
    this.distinctId = next;
    if (username) this.username = username;
    this.track({ eventType: 'identify', eventName: '$identify', pagePath: globalThis.location.pathname });
  }

  reset(): void {
    this.distinctId = null;
    this.username = null;
  }

  // ─── 初始化 ───────────────────────────────────────────────────────────────
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.getSessionId();
    void this.loadConfig();
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    this.setupUnloadFlush();
    this.flushQueue();
  }

  private async loadConfig(): Promise<void> {
    try {
      const apiBase = (import.meta.env.VITE_API_BASE_URL as string) || '/api';
      const res = await fetch(`${apiBase}/analytics/config`);
      const json = await res.json() as { code: number; data: AnalyticsPublicConfig };
      if (json.code === 0 && json.data) this.config = json.data;
    } catch { /* keep defaults */ } finally {
      this.configLoaded = true;
      this.drainPreBuffer();
      if (this.isEnabled()) {
        if (this.config.trackClicks) this.setupAutocapture();
        if (this.config.trackPerformance) this.setupWebVitals();
        if (this.config.trackApi) this.setupApiMonitor();
      }
    }
  }

  /** 配置就绪后按最终配置重放 pre-buffer 事件（disabled/未采样则丢弃）。 */
  private drainPreBuffer(): void {
    const pending = this.preBuffer.splice(0);
    for (const e of pending) this.doTrack(e);
  }

  private isEnabled(): boolean {
    if (!this.config.enabled) return false;
    if (this.config.respectDnt && (navigator.doNotTrack === '1' || (globalThis as { doNotTrack?: string }).doNotTrack === '1')) return false;
    return true;
  }

  private isTypeEnabled(eventType: UserBehaviorEventType): boolean {
    const key = TYPE_SWITCH[eventType];
    return key ? this.config[key] !== false : true;
  }

  private isBlacklisted(path: string): boolean {
    return this.config.blacklistPaths.some((p) => p && path.startsWith(p));
  }

  // ─── 核心 track ───────────────────────────────────────────────────────────
  track(event: PendingEvent): void {
    // 远程配置返回前暂存，就绪后按最终配置过滤重放，避免首屏事件绕过开关/采样
    if (!this.configLoaded) {
      if (this.preBuffer.length < PRE_BUFFER_MAX) this.preBuffer.push(event);
      return;
    }
    this.doTrack(event);
  }

  private doTrack(event: PendingEvent): void {
    if (!this.isEnabled()) return;
    if (!this.isTypeEnabled(event.eventType)) return;
    if (this.isBlacklisted(event.pagePath)) return;
    if (!this.isSampled()) return;

    const enriched: TrackEventInput = {
      ...event,
      sessionId: this.getSessionId(),
      anonymousId: this.getAnonymousId(),
      distinctId: this.distinctId ?? undefined,
      referrer: event.referrer ?? (event.eventType === 'page_view' ? this.referrer : undefined),
      screenW: event.screenW ?? globalThis.screen?.width,
      screenH: event.screenH ?? globalThis.screen?.height,
      language: event.language ?? navigator.language,
      ...(event.eventType === 'page_view' ? this.utm : {}),
    };
    this.buffer.push(enriched);
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.flush();
  }

  // ─── 上报 / 重试 ──────────────────────────────────────────────────────────
  private flush(): void {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string) || '/api';
    const token = localStorage.getItem(TOKEN_KEY);
    fetch(`${apiBase}/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ events }),
    })
      .then((res) => { if (!res.ok) this.enqueue(events); })
      .catch(() => this.enqueue(events));
  }

  private flushSync(): void {
    // 卸载前配置未就绪时，按默认配置（全开）放行 pre-buffer，避免首屏事件全丢
    if (!this.configLoaded) this.drainPreBuffer();
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    const apiBase = (import.meta.env.VITE_API_BASE_URL as string) || '/api';
    const url = `${apiBase}/analytics/events`;
    // 分片规避 sendBeacon / keepalive 的 64KB body 上限
    for (let i = 0; i < events.length; i += UNLOAD_CHUNK_SIZE) {
      const chunk = events.slice(i, i + UNLOAD_CHUNK_SIZE);
      const body = JSON.stringify({ events: chunk });
      let sent = false;
      try {
        // sendBeacon 专为卸载上报设计：浏览器保证页面关闭后继续发送
        if (typeof navigator.sendBeacon === 'function') {
          sent = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        }
      } catch { sent = false; }
      if (sent) continue;
      try {
        const token = localStorage.getItem(TOKEN_KEY);
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body,
          keepalive: true,
        }).catch(() => this.enqueue(chunk));
      } catch { this.enqueue(chunk); }
    }
  }

  private enqueue(events: TrackEventInput[]): void {
    try {
      const existing = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as TrackEventInput[];
      const merged = [...existing, ...events].slice(-500);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(merged));
    } catch { /* storage full / unavailable */ }
  }

  private flushQueue(): void {
    try {
      const queued = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as TrackEventInput[];
      if (queued.length === 0) return;
      const events = queued.slice(0, MAX_BUFFER_SIZE);     // 单批 ≤ 后端上限，避免 100+ 触发 400
      const rest = queued.slice(MAX_BUFFER_SIZE);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(rest)); // 先留下剩余，成功不动、失败回灌
      const apiBase = (import.meta.env.VITE_API_BASE_URL as string) || '/api';
      const token = localStorage.getItem(TOKEN_KEY);
      fetch(`${apiBase}/analytics/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ events }),
      }).then((res) => { if (!res.ok) this.enqueue(events); else if (rest.length) this.flushQueue(); }).catch(() => this.enqueue(events));
    } catch { /* ignore */ }
  }

  private setupUnloadFlush(): void {
    document.addEventListener('pagehide', () => this.flushSync());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flushSync(); });
  }

  // ─── 自动采集：点击 ───────────────────────────────────────────────────────
  private setupAutocapture(): void {
    document.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const el = target.closest<HTMLElement>('[data-track],button,a,[role="button"],input[type="submit"],input[type="button"]');
      if (!el) return;
      const dataKey = el.getAttribute('data-track');
      // data-sensitive 元素（或其后代）不采集任何文本，仅保留 tag / 显式 key
      const sensitive = el.closest('[data-sensitive]') != null;
      const rawLabel = sensitive ? '' : (el.getAttribute('data-track-label') || el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '').trim().slice(0, 60);
      const label = this.config.maskInputs ? maskSensitiveText(rawLabel) : rawLabel;
      const tag = el.tagName.toLowerCase();
      const key = dataKey || (el.id ? `${tag}#${el.id}` : label ? `${tag}:${label.slice(0, 24)}` : tag);
      const area = el.closest<HTMLElement>('[data-area]')?.getAttribute('data-area') || el.getAttribute('data-track-area') || undefined;
      addBreadcrumb({ type: 'click', message: label || key, data: { tag } });
      this.track({ eventType: 'feature_use', eventName: '$autocapture', pagePath: globalThis.location.pathname, elementKey: key.slice(0, 128), elementLabel: label || key, componentArea: area ?? undefined });
    }, { capture: true, passive: true });
  }

  // ─── 自动采集：Web Vitals ─────────────────────────────────────────────────
  private setupWebVitals(): void {
    const handler = (m: Metric) => {
      this.track({ eventType: 'perf', eventName: '$web_vitals', pagePath: globalThis.location.pathname, metricName: m.name, metricValue: Math.round(m.value * 1000) / 1000 });
    };
    try { onLCP(handler); onINP(handler); onCLS(handler); onFCP(handler); onTTFB(handler); } catch { /* ignore */ }
  }

  // ─── 自动采集：API 监控 ───────────────────────────────────────────────────
  private setupApiMonitor(): void {
    const isInternal = (url: string) => url.includes('/api/analytics') || url.includes('/api/frontend-errors');

    const record = (url: string, method: string, status: number, durationMs: number, failed: boolean) => {
      if (isInternal(url)) return;
      addBreadcrumb({ type: 'http', message: `${method} ${url} → ${failed ? 'ERR' : status}`, level: status >= 400 || failed ? 'warning' : 'info', data: { status, durationMs } });
      if (status >= 400 || failed || durationMs > SLOW_API_MS) {
        this.track({ eventType: 'api_request', eventName: '$api', pagePath: globalThis.location.pathname, durationMs: Math.round(durationMs), properties: { url, method, status, failed } });
      }
      if ((status >= 500 || failed) && this.config.trackErrors) {
        reportError('http_error', `${method} ${url} ${failed ? '请求失败' : status}`, { level: 'error', httpStatus: status || undefined, httpMethod: method, httpUrl: url });
      }
    };

    const origFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
      const req = args[0];
      const url = typeof req === 'string' ? req : req instanceof URL ? req.href : (req as Request).url;
      const method = (args[1]?.method || (req instanceof Request ? req.method : 'GET') || 'GET').toUpperCase();
      const start = performance.now();
      try {
        const res = await origFetch(...args);
        record(url, method, res.status, performance.now() - start, false);
        return res;
      } catch (err) {
        record(url, method, 0, performance.now() - start, true);
        throw err;
      }
    };

    const OrigXHR = globalThis.XMLHttpRequest;
    if (OrigXHR) {
      const open = OrigXHR.prototype.open;
      const send = OrigXHR.prototype.send;
      type Tracked = XMLHttpRequest & { __t?: { url: string; method: string; start: number } };
      OrigXHR.prototype.open = function (this: Tracked, method: string, url: string | URL, ...rest: unknown[]) {
        this.__t = { url: String(url), method: (method || 'GET').toUpperCase(), start: 0 };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (open as any).apply(this, [method, url, ...rest]);
      };
      OrigXHR.prototype.send = function (this: Tracked, ...args: unknown[]) {
        if (this.__t) {
          this.__t.start = performance.now();
          this.addEventListener('loadend', () => {
            if (!this.__t) return;
            const failed = this.status === 0;
            record(this.__t.url, this.__t.method, this.status, performance.now() - this.__t.start, failed);
          });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (send as any).apply(this, args);
      };
    }
  }
}

const tracker = new Tracker();

/** 在 App 启动时调用一次，开启自动采集。 */
export function initTracker(): void { tracker.init(); }

/** 关联登录用户身份（匿名 → 登录合并）。 */
export function identify(userId: number | string, username?: string): void { tracker.identify(userId, username); }

/** 退出登录时重置身份。 */
export function resetIdentity(): void { tracker.reset(); }

/** 页面进入。 */
export function trackPageView(pagePath: string, pageTitle?: string): void {
  addBreadcrumb({ type: 'navigation', message: pageTitle ? `${pageTitle} (${pagePath})` : pagePath });
  tracker.track({ eventType: 'page_view', eventName: '$pageview', pagePath, pageTitle });
}

/** 页面离开（携带停留时长）。 */
export function trackPageLeave(pagePath: string, durationMs: number, pageTitle?: string): void {
  tracker.track({ eventType: 'page_leave', eventName: '$pageleave', pagePath, durationMs, pageTitle });
}

/** 功能点击（手动埋点）。 */
export function trackFeature(elementKey: string, elementLabel: string, componentArea?: string): void {
  tracker.track({ eventType: 'feature_use', eventName: '$feature', pagePath: globalThis.location.pathname, elementKey, elementLabel, componentArea });
}

/** 自定义事件（带属性袋）。 */
export function trackEvent(eventName: string, properties?: Record<string, unknown>): void {
  tracker.track({ eventType: 'custom', eventName, pagePath: globalThis.location.pathname, properties });
}

/** 区域点击采集（用于点击分布图）。 */
export function trackAreaClick(e: { clientX: number; clientY: number }, containerEl: HTMLElement, componentArea: string): void {
  const rect = containerEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;
  const clickX = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10;
  const clickY = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10;
  tracker.track({
    eventType: 'area_click', eventName: '$areaclick', pagePath: globalThis.location.pathname, componentArea,
    clickX: Math.max(0, Math.min(100, clickX)), clickY: Math.max(0, Math.min(100, clickY)),
  });
}

export type { UserBehaviorEventType };
