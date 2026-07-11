/**
 * 前端埋点 SDK（对标 PostHog / 神策）：
 * - 自动采集（页面、点击 autocapture）、自定义事件、属性袋
 * - 环境/来源上下文（UTM/referrer/screen/lang）、匿名→登录身份合并
 * - Web Vitals 性能采集、API 请求监控、离线缓存重试
 * - 远程配置（开关/采样/黑名单/DNT）
 */
import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from 'web-vitals';
import { TOKEN_KEY, ANALYTICS_CONFIG_VERSION_KEY, ANALYTICS_SITE_KEY_HEADER, ANALYTICS_EXPERIMENT_EXPOSURE_EVENT } from '@zenith/shared';
import type { TrackEventInput, AnalyticsPublicConfig, UserBehaviorEventType, AnalyticsEventSource, AnalyticsEnvironment, AnalyticsExperimentAssignment } from '@zenith/shared';
import { addBreadcrumb } from './breadcrumbs';
import { configureErrorReporting, configureErrorReporterRuntime, reportError } from './error-reporter';

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
const EXP_ASSIGNMENTS_KEY = 'zenith_tracker_exp_assignments';
const EXPOSURE_SESSION_KEY = 'zenith_tracker_exp_exposure';
const EXP_ASSIGNMENTS_TTL_MS = 5 * 60_000;
const DEFAULT_SESSION_IDLE_MINUTES = 30;
const WHITE_SCREEN_CHECK_DELAY_MS = 6000;
const RAGE_CLICK_WINDOW_MS = 2000;
const RAGE_CLICK_THRESHOLD = 3;
// 设置热更新：60s 兜底轮询 + 同浏览器其它标签的 storage 事件即时触发（key 见 shared constants）
const CONFIG_RELOAD_INTERVAL_MS = 60_000;

// ─── 滚动深度（页面级最大滚动百分比，usePageTracker 在 page_leave 时读取）─────
let maxScrollDepth = 0;
let scrollTicking = false;

function measureScrollDepth(): void {
  try {
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - doc.clientHeight;
    const depth = scrollable <= 0 ? 100 : Math.min(100, Math.round(((doc.scrollTop + doc.clientHeight) / doc.scrollHeight) * 100));
    if (depth > maxScrollDepth) maxScrollDepth = depth;
  } catch { /* ignore */ }
}

/** 当前页面的最大滚动深度（0-100）。 */
export function getMaxScrollDepth(): number { return maxScrollDepth; }

/** 路由切换时重置滚动深度统计。 */
export function resetScrollDepth(): void { maxScrollDepth = 0; measureScrollDepth(); }

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
  sessionTimeoutMinutes: DEFAULT_SESSION_IDLE_MINUTES,
};

type PendingEvent = Omit<TrackEventInput, 'sessionId' | 'anonymousId' | 'distinctId'>;

// ─── 运行时参数化（多端 SDK 接入：后台 admin / 会员 member 共用同一份 tracker）───
export interface TrackerRuntimeConfig {
  /** API 基础路径，默认 /api */
  apiBase: string;
  /** localStorage 中存放访问令牌的 key（admin/member 各自独立） */
  tokenKey: string;
  /** 事件来源平台，不允许业务方伪造为 'server' */
  source: AnalyticsEventSource;
  /** 应用标识 */
  appId: string;
  /** 采集环境 */
  environment: AnalyticsEnvironment;
  /** 采集 SDK 版本 */
  sdkVersion: string;
  /** 白屏检测根节点选择器 */
  rootSelector: string;
  /** 是否已获得采集同意；admin 端恒为 true，member 端由用户隐私同意状态驱动 */
  consentProvider: () => boolean;
  /** 匿名站点 Key；有值时配置拉取与上报携带请求头 */
  siteKey?: string;
}

let runtime: TrackerRuntimeConfig = {
  apiBase: '/api',
  tokenKey: TOKEN_KEY,
  source: 'web_admin',
  appId: 'admin',
  environment: 'development',
  sdkVersion: '0.0.0',
  rootSelector: '#root',
  consentProvider: () => true,
  siteKey: undefined,
};

function runtimeStorageKey(baseKey: string): string {
  return runtime.appId === 'admin' ? baseKey : `${baseKey}:${runtime.appId}`;
}

/**
 * 配置 tracker 运行时参数，需在 initTracker() 之前调用。
 * 未显式传入的字段沿用默认值（保持后台现状不变）。
 * 同时把 tokenKey/source/appId/environment/consentProvider 同步给 error-reporter，
 * 避免两个 SDK 的身份/平台字段配置漂移（单向同步：tracker → error-reporter，不产生循环依赖）。
 */
export function configureTracker(next: Partial<TrackerRuntimeConfig>): void {
  const shouldClearExperiments = (next.appId !== undefined && next.appId !== runtime.appId) || (next.siteKey !== undefined && next.siteKey !== runtime.siteKey) || (next.tokenKey !== undefined && next.tokenKey !== runtime.tokenKey);
  runtime = { ...runtime, ...next };
  if (shouldClearExperiments) tracker.clearExperimentCache();
  configureErrorReporterRuntime({
    apiBase: runtime.apiBase,
    tokenKey: runtime.tokenKey,
    source: runtime.source,
    appId: runtime.appId,
    environment: runtime.environment,
    sdkVersion: runtime.sdkVersion,
    consentProvider: runtime.consentProvider,
    siteKey: runtime.siteKey,
  });
}


function analyticsHeaders(token: string | null, includeJson = true): Record<string, string> {
  return {
    ...(includeJson ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(runtime.siteKey ? { [ANALYTICS_SITE_KEY_HEADER]: runtime.siteKey } : {}),
  };
}

function uuid(): string {
  try { return crypto.randomUUID(); } catch {
    const bytes = new Uint8Array(16);
    try { crypto.getRandomValues(bytes); } catch {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
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
  private queueFlushInFlight = false;
  private identityGeneration = 0;
  private configRequestId = 0;
  private initialized = false;
  private configReloadTimer: ReturnType<typeof setInterval> | null = null;
  private readonly utm = parseUtm();
  private readonly referrer = (() => { try { return document.referrer || undefined; } catch { return undefined; } })();
  private assignmentsCache: { fetchedAt: number; data: AnalyticsExperimentAssignment[] } | null = null;

  // ─── 身份 / 会话 ──────────────────────────────────────────────────────────
  private getAnonymousId(): string {
    try {
      const anonymousKey = runtimeStorageKey(ANON_KEY);
      let id = localStorage.getItem(anonymousKey);
      if (!id) { id = uuid(); localStorage.setItem(anonymousKey, id); }
      return id;
    } catch { return uuid(); }
  }

  private getSessionId(): string {
    try {
      const now = Date.now();
      const sessionKey = runtimeStorageKey(SESSION_KEY);
      const sessionTsKey = runtimeStorageKey(SESSION_TS_KEY);
      const sampledKey = runtimeStorageKey(SAMPLED_KEY);
      const ts = Number(sessionStorage.getItem(sessionTsKey) || 0);
      let id = sessionStorage.getItem(sessionKey);
      if (!id || now - ts > this.config.sessionTimeoutMinutes * 60_000) {
        id = uuid();
        sessionStorage.setItem(sessionKey, id);
        sessionStorage.removeItem(sampledKey);
      }
      sessionStorage.setItem(sessionTsKey, String(now));
      return id;
    } catch { return uuid(); }
  }

  private isSampled(): boolean {
    try {
      const sampledKey = runtimeStorageKey(SAMPLED_KEY);
      const cached = sessionStorage.getItem(sampledKey);
      if (cached != null) return cached === '1';
      const sampled = Math.random() < this.config.sampleRate;
      sessionStorage.setItem(sampledKey, sampled ? '1' : '0');
      return sampled;
    } catch { return true; }
  }

  private identifyWithPrefix(prefix: 'u' | 'm', id: number | string, displayName?: string): void {
    const next = `${prefix}:${id}`;
    if (this.distinctId === next) { if (displayName) this.username = displayName; return; }
    if (this.distinctId !== null) this.discardPendingIdentityData();
    this.distinctId = next;
    if (displayName) this.username = displayName;
    this.track({ eventType: 'identify', eventName: '$identify', pagePath: globalThis.location.pathname });
    if (this.initialized) void this.loadConfig();
  }

  identify(userId: number | string, username?: string): void { this.identifyWithPrefix('u', userId, username); }

  identifyMember(memberId: number | string, displayName?: string): void { this.identifyWithPrefix('m', memberId, displayName); }

  reset(): void {
    if (this.distinctId === null) return;
    this.discardPendingIdentityData();
    this.distinctId = null;
    this.username = null;
    if (this.initialized) void this.loadConfig();
  }

  prepareLogout(): void {
    const token = localStorage.getItem(runtime.tokenKey);
    this.flush(token, false);
    this.flushQueueSnapshot(token);
    this.discardPendingIdentityData();
  }

  clearExperimentCache(): void {
    this.assignmentsCache = null;
    try {
      localStorage.removeItem(runtimeStorageKey(EXP_ASSIGNMENTS_KEY));
      sessionStorage.removeItem(runtimeStorageKey(EXPOSURE_SESSION_KEY));
    } catch { /* storage unavailable */ }
  }

  private readExposureSet(): Set<string> {
    try {
      return new Set(JSON.parse(sessionStorage.getItem(runtimeStorageKey(EXPOSURE_SESSION_KEY)) || '[]') as string[]);
    } catch { return new Set(); }
  }

  private writeExposureSet(set: Set<string>): void {
    try { sessionStorage.setItem(runtimeStorageKey(EXPOSURE_SESSION_KEY), JSON.stringify([...set].slice(-200))); } catch { /* ignore */ }
  }

  async fetchExperimentAssignments(): Promise<AnalyticsExperimentAssignment[]> {
    const now = Date.now();
    if (this.assignmentsCache && now - this.assignmentsCache.fetchedAt < EXP_ASSIGNMENTS_TTL_MS) return this.assignmentsCache.data;
    const cacheKey = runtimeStorageKey(EXP_ASSIGNMENTS_KEY);
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null') as { fetchedAt: number; data: AnalyticsExperimentAssignment[] } | null;
      if (cached && now - cached.fetchedAt < EXP_ASSIGNMENTS_TTL_MS) {
        this.assignmentsCache = cached;
        return cached.data;
      }
    } catch { /* ignore */ }
    try {
      const token = localStorage.getItem(runtime.tokenKey);
      const anonymousId = token ? null : this.getAnonymousId();
      const query = anonymousId ? `?distinctId=${encodeURIComponent(anonymousId)}` : '';
      const res = await fetch(`${runtime.apiBase}/analytics/experiments/assignments${query}`, { headers: analyticsHeaders(token, false) });
      const json = await res.json() as { code: number; data?: AnalyticsExperimentAssignment[] };
      const data = res.ok && json.code === 0 && Array.isArray(json.data) ? json.data : [];
      const entry = { fetchedAt: now, data };
      this.assignmentsCache = entry;
      try { localStorage.setItem(cacheKey, JSON.stringify(entry)); } catch { /* ignore */ }
      return data;
    } catch { return []; }
  }

  async getVariant(expKey: string): Promise<string | null> {
    const assignments = await this.fetchExperimentAssignments();
    const assignment = assignments.find((item) => item.expKey === expKey);
    if (!assignment) return null;
    const exposureKey = `${assignment.expKey}:${assignment.variantKey}:${this.getSessionId()}`;
    const exposed = this.readExposureSet();
    if (!exposed.has(exposureKey)) {
      exposed.add(exposureKey);
      this.writeExposureSet(exposed);
      this.track({
        eventType: 'custom',
        eventName: ANALYTICS_EXPERIMENT_EXPOSURE_EVENT,
        pagePath: globalThis.location?.pathname || '/',
        properties: { expKey: assignment.expKey, variantKey: assignment.variantKey },
      });
    }
    return assignment.variantKey;
  }

  private discardPendingIdentityData(): void {
    this.identityGeneration += 1;
    this.clearExperimentCache();
    this.buffer = [];
    this.preBuffer = [];
    try {
      localStorage.removeItem(runtimeStorageKey(QUEUE_KEY));
      sessionStorage.removeItem(runtimeStorageKey(SESSION_KEY));
      sessionStorage.removeItem(runtimeStorageKey(SESSION_TS_KEY));
      sessionStorage.removeItem(runtimeStorageKey(SAMPLED_KEY));
    } catch { /* storage unavailable */ }
  }

  // ─── 初始化 ───────────────────────────────────────────────────────────────
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.getSessionId();
    this.setupAutocapture();
    this.setupWebVitals();
    this.setupApiMonitor();
    void this.loadConfig();
    this.flushTimer = setInterval(() => {
      this.flush();
      this.flushQueue();
    }, FLUSH_INTERVAL_MS);
    this.setupUnloadFlush();
    this.setupScrollDepth();
    this.setupWhiteScreenCheck();
    this.setupConfigHotReload();
    this.flushQueue();
  }

  /** 采集设置热更新：60s 兜底轮询 + 同浏览器其它标签写入版本号后 storage 事件即时重拉。 */
  private setupConfigHotReload(): void {
    if (this.configReloadTimer) return; // 已注册（init 已由 initialized 保护，双重防御避免重复计时器/监听）
    this.configReloadTimer = setInterval(() => { void this.loadConfig(); }, CONFIG_RELOAD_INTERVAL_MS);
    try {
      globalThis.addEventListener?.('storage', (e: StorageEvent) => {
        if (e.key === ANALYTICS_CONFIG_VERSION_KEY) void this.loadConfig();
      });
    } catch { /* 非浏览器环境（SSR/测试）忽略 */ }
  }

  private applyConfig(config: AnalyticsPublicConfig): void {
    this.config = config;
    configureErrorReporting({
      enabled: this.config.enabled,
      trackErrors: this.config.trackErrors,
      respectDnt: this.config.respectDnt,
    });
    this.configLoaded = true;
    this.drainPreBuffer();
  }

  /** 供设置页保存成功后手动触发当前标签页立即重拉配置（不下发配置内容，仅重新拉取）。 */
  reloadConfig(): void { void this.loadConfig(); }

  /** 供宿主应用的实时通道直接下发远程配置。 */
  updateConfig(config: AnalyticsPublicConfig): void { this.applyConfig(config); }

  private setupScrollDepth(): void {
    document.addEventListener('scroll', () => {
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => { measureScrollDepth(); scrollTicking = false; });
    }, { capture: true, passive: true });
  }

  /** 白屏检测：应用启动数秒后根节点仍无可见内容则上报。 */
  private setupWhiteScreenCheck(): void {
    setTimeout(() => {
      try {
        if (!this.config.trackErrors) return;
        const root = document.querySelector(runtime.rootSelector);
        const hasContent = !!root && (root.children.length > 0 || (root.textContent ?? '').trim().length > 0);
        if (!hasContent) {
          reportError('white_screen', '检测到疑似白屏：根节点无渲染内容', {
            level: 'fatal',
            context: { readyState: document.readyState, path: globalThis.location.pathname },
          });
        }
      } catch { /* ignore */ }
    }, WHITE_SCREEN_CHECK_DELAY_MS);
  }

  private async loadConfig(): Promise<void> {
    const requestId = ++this.configRequestId;
    try {
      const token = localStorage.getItem(runtime.tokenKey);
      const res = await fetch(`${runtime.apiBase}/analytics/config`, {
        headers: analyticsHeaders(token, false),
      });
      const json = await res.json() as { code: number; data: AnalyticsPublicConfig };
      if (requestId === this.configRequestId && json.code === 0 && json.data) this.config = json.data;
    } catch { /* keep defaults */ }
    if (requestId !== this.configRequestId) return;
    this.applyConfig(this.config);
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
    if (!runtime.consentProvider()) return;
    if (!this.isEnabled()) return;
    if (!this.isTypeEnabled(event.eventType)) return;
    if (this.isBlacklisted(event.pagePath)) return;
    if (event.eventType !== 'identify' && !this.isSampled()) return;

    const enriched: TrackEventInput = {
      ...event,
      eventId: event.eventId ?? uuid(),
      sessionId: this.getSessionId(),
      anonymousId: this.getAnonymousId(),
      distinctId: this.distinctId ?? undefined,
      referrer: event.referrer ?? (event.eventType === 'page_view' ? this.referrer : undefined),
      screenW: event.screenW ?? globalThis.screen?.width,
      screenH: event.screenH ?? globalThis.screen?.height,
      language: event.language ?? navigator.language,
      ts: event.ts ?? Date.now(),
      ...(event.eventType === 'page_view' ? this.utm : {}),
      // 强制覆盖平台字段：调用方（业务代码/离线队列）不可伪造 source/appId/environment/sdkVersion
      source: runtime.source,
      appId: runtime.appId,
      environment: runtime.environment,
      sdkVersion: runtime.sdkVersion,
    };
    this.buffer.push(enriched);
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.flush();
  }

  // ─── 上报 / 重试 ──────────────────────────────────────────────────────────
  private flush(tokenOverride?: string | null, requeueOnFailure = true): void {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    const generation = this.identityGeneration;
    const token = tokenOverride === undefined ? localStorage.getItem(runtime.tokenKey) : tokenOverride;
    fetch(`${runtime.apiBase}/analytics/events`, {
      method: 'POST',
      headers: analyticsHeaders(token),
      body: JSON.stringify({ events }),
    })
      .then((res) => {
        if (!res.ok && requeueOnFailure && generation === this.identityGeneration) this.enqueue(events);
      })
      .catch(() => {
        if (requeueOnFailure && generation === this.identityGeneration) this.enqueue(events);
      });
  }

  private flushSync(): void {
    // 卸载前配置未就绪时，按默认配置（全开）放行 pre-buffer，避免首屏事件全丢
    if (!this.configLoaded) this.drainPreBuffer();
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0);
    const generation = this.identityGeneration;
    const url = `${runtime.apiBase}/analytics/events`;
    // 分片规避 sendBeacon / keepalive 的 64KB body 上限
    for (let i = 0; i < events.length; i += UNLOAD_CHUNK_SIZE) {
      const chunk = events.slice(i, i + UNLOAD_CHUNK_SIZE);
      const body = JSON.stringify({ events: chunk });
      const token = localStorage.getItem(runtime.tokenKey);
      let sent = false;
      try {
        // sendBeacon 专为卸载上报设计：浏览器保证页面关闭后继续发送
        if (!token && !runtime.siteKey && typeof navigator.sendBeacon === 'function') {
          sent = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        }
      } catch { sent = false; }
      if (sent) continue;
      try {
        fetch(url, {
          method: 'POST',
          headers: analyticsHeaders(token),
          body,
          keepalive: true,
        }).catch(() => {
          if (generation === this.identityGeneration) this.enqueue(chunk);
        });
      } catch {
        if (generation === this.identityGeneration) this.enqueue(chunk);
      }
    }
  }

  private enqueue(events: TrackEventInput[]): void {
    try {
      const queueKey = runtimeStorageKey(QUEUE_KEY);
      const existing = JSON.parse(localStorage.getItem(queueKey) || '[]') as TrackEventInput[];
      const merged = [...existing, ...events].slice(-500);
      localStorage.setItem(queueKey, JSON.stringify(merged));
    } catch { /* storage full / unavailable */ }
  }

  private flushQueueSnapshot(token: string | null): void {
    try {
      const queueKey = runtimeStorageKey(QUEUE_KEY);
      const queued = JSON.parse(localStorage.getItem(queueKey) || '[]') as TrackEventInput[];
      localStorage.removeItem(queueKey);
      if (queued.length === 0) return;
      for (let i = 0; i < queued.length; i += MAX_BUFFER_SIZE) {
        const events = queued.slice(i, i + MAX_BUFFER_SIZE);
        fetch(`${runtime.apiBase}/analytics/events`, {
          method: 'POST',
          headers: analyticsHeaders(token),
          body: JSON.stringify({ events }),
          keepalive: true,
        }).catch(() => { /* identity is leaving; never leak this batch into the next account */ });
      }
    } catch { /* ignore */ }
  }

  private flushQueue(tokenOverride?: string | null, requeueOnFailure = true): void {
    if (this.queueFlushInFlight) return;
    this.queueFlushInFlight = true;
    const token = tokenOverride === undefined ? localStorage.getItem(runtime.tokenKey) : tokenOverride;
    const generation = this.identityGeneration;
    void this.drainQueue(token, requeueOnFailure, generation).finally(() => {
      this.queueFlushInFlight = false;
    });
  }

  private async drainQueue(token: string | null, requeueOnFailure: boolean, generation: number): Promise<void> {
    try {
      while (true) {
        if (generation !== this.identityGeneration) return;
        const queueKey = runtimeStorageKey(QUEUE_KEY);
        const queued = JSON.parse(localStorage.getItem(queueKey) || '[]') as TrackEventInput[];
        if (queued.length === 0) return;
        const events = queued.slice(0, MAX_BUFFER_SIZE);
        const rest = queued.slice(MAX_BUFFER_SIZE);
        localStorage.setItem(queueKey, JSON.stringify(rest));
        try {
          const res = await fetch(`${runtime.apiBase}/analytics/events`, {
            method: 'POST',
            headers: analyticsHeaders(token),
            body: JSON.stringify({ events }),
          });
          if (!res.ok) {
            if (requeueOnFailure && generation === this.identityGeneration) this.enqueue(events);
            return;
          }
        } catch {
          if (requeueOnFailure && generation === this.identityGeneration) this.enqueue(events);
          return;
        }
      }
    } catch { /* ignore */ }
  }

  private setupUnloadFlush(): void {
    document.addEventListener('pagehide', () => this.flushSync());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.flushSync(); });
  }

  // ─── 自动采集：点击 ───────────────────────────────────────────────────────
  private rageState: { key: string; count: number; lastTs: number } | null = null;

  /** Rage click 检测：同元素短时间连点，暗示按钮失效或 UI 卡顿。 */
  private detectRageClick(key: string, label: string): void {
    const now = Date.now();
    if (this.rageState?.key === key && now - this.rageState.lastTs < RAGE_CLICK_WINDOW_MS) {
      this.rageState.count += 1;
      this.rageState.lastTs = now;
      if (this.rageState.count === RAGE_CLICK_THRESHOLD) {
        this.track({
          eventType: 'custom', eventName: '$rage_click', pagePath: globalThis.location.pathname,
          elementKey: key.slice(0, 128), elementLabel: label.slice(0, 128),
          properties: { clicks: RAGE_CLICK_THRESHOLD, windowMs: RAGE_CLICK_WINDOW_MS },
        });
        addBreadcrumb({ type: 'custom', message: `rage click: ${label || key}`, level: 'warning' });
      }
    } else {
      this.rageState = { key, count: 1, lastTs: now };
    }
  }

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
      // 视口相对坐标（百分比），支撑零配置全页点击热力图
      const vw = globalThis.innerWidth;
      const vh = globalThis.innerHeight;
      const clickX = vw > 0 ? Math.max(0, Math.min(100, Math.round((e.clientX / vw) * 1000) / 10)) : undefined;
      const clickY = vh > 0 ? Math.max(0, Math.min(100, Math.round((e.clientY / vh) * 1000) / 10)) : undefined;
      addBreadcrumb({ type: 'click', message: label || key, data: { tag } });
      this.detectRageClick(key, label || key);
      this.track({ eventType: 'feature_use', eventName: '$autocapture', pagePath: globalThis.location.pathname, elementKey: key.slice(0, 128), elementLabel: label || key, componentArea: area ?? undefined, clickX, clickY });
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
    const isInternal = (url: string, method: string) => {
      if (method !== 'POST') return false;
      try {
        const path = new URL(url, globalThis.location.origin).pathname;
        return path.endsWith('/api/analytics/events') || path.endsWith('/api/frontend-errors');
      } catch {
        return false;
      }
    };

    const record = (url: string, method: string, status: number, durationMs: number, failed: boolean) => {
      if (isInternal(url, method)) return;
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

/**
 * 设置热更新：立即重拉采集配置（远程 /analytics/config），不下发配置内容本身。
 * 供采集设置页保存成功后调用，使当前标签页无需刷新即可生效；跨标签页请配合
 * `localStorage.setItem(ANALYTICS_CONFIG_VERSION_KEY, ...)` 触发 storage 事件。
 */
export function reloadTrackerConfig(): void { tracker.reloadConfig(); }

/** 由宿主实时通道直接应用远程配置。 */
export function applyRemoteConfig(config: AnalyticsPublicConfig): void { tracker.updateConfig(config); }

/** 使远程配置缓存失效并立即重新拉取。 */
export function invalidateConfigCache(): void { tracker.reloadConfig(); }

/** 拉取当前身份的 A/B 实验分流结果（5 分钟本地缓存）。 */
export function fetchExperimentAssignments(): Promise<AnalyticsExperimentAssignment[]> { return tracker.fetchExperimentAssignments(); }

/** 获取指定实验变体；命中时自动上报会话内去重的曝光事件。 */
export function getVariant(expKey: string): Promise<string | null> { return tracker.getVariant(expKey); }

/** 关联登录用户身份（匿名 → 登录合并）。 */
export function identify(userId: number | string, username?: string): void { tracker.identify(userId, username); }

/** 关联登录会员身份（会员 SPA 专用，distinctId 前缀为 `m:`，与 admin 的 `u:` 互不相同）。 */
export function identifyMember(memberId: number | string, displayName?: string): void { tracker.identifyMember(memberId, displayName); }

/** 退出登录时重置身份。 */
export function resetIdentity(): void { tracker.reset(); }

/** 退出登录前用当前 token 尽力发送旧身份事件，避免后续账号接管队列。 */
export function prepareTrackerLogout(): void { tracker.prepareLogout(); }

/** 页面进入。 */
export function trackPageView(pagePath: string, pageTitle?: string): void {
  addBreadcrumb({ type: 'navigation', message: pageTitle ? `${pageTitle} (${pagePath})` : pagePath });
  tracker.track({ eventType: 'page_view', eventName: '$pageview', pagePath, pageTitle });
}

/** 页面离开（携带可见停留时长与最大滚动深度）。 */
export function trackPageLeave(pagePath: string, durationMs: number, pageTitle?: string, scrollDepth?: number): void {
  tracker.track({ eventType: 'page_leave', eventName: '$pageleave', pagePath, durationMs, pageTitle, scrollDepth });
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
