/**
 * 服务端异常采集器：`captureException(err, ctx)` 把任意 thrown 值归一化、脱敏、计算指纹后放入有界缓冲，
 * 由定时器批量落入错误监控的 Issue 模型（error_groups / error_events，source = 'server'）。
 *
 * 设计要点（都是为了「记录异常」永远不能成为第二个故障）：
 * - 永不抛错、永不阻塞调用方：捕获阶段全同步且 O(1)，落库在 flush 里异步进行
 * - 三道闸：单指纹 / 全局每分钟令牌桶（超出只累加次数，不存事件详情）+ 缓冲上限（溢出丢弃并计数）
 * - 熔断：连续 flush 失败（多半是数据库本身不可用）后暂停一段时间，只走进程日志
 * - 防重：捕获过的 Error 对象打符号标记，logger.error 兜底网看到已标记的对象直接跳过
 * - 运行时设置（开关 / 闸值 / 脱敏 / 忽略规则）异步刷新，读不到时沿用上一份，绝不因设置不可读而丢异常
 */
import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import type { AnalyticsEnvironment, ErrorLevel, ServerErrorType } from '@zenith/shared/analytics';
import { resolveSettings, type ErrorTrackingSettings } from '@zenith/shared/settings';
import { config } from '../../config';
import { currentUserOrNull } from '../context';
import { isFatalShutdownInProgress } from '../fatal-handlers';
import logger, { setLoggedErrorSink } from '../logger';
import { currentMemberOrNull } from '../member-context';
import { PROCESS_HOSTNAME, PROCESS_PID } from '../process-identity';
import { getSettings } from '../settings';
import { currentCorrelationId } from '../trace-context';
import { computeServerFingerprint } from './fingerprint';
import { normalizeThrown } from './normalize';
import { snapshotRequest } from './scrub';
import { bumpErrorGroupCounts, recordErrorEventBatch } from './store';
import type { CaptureContext, ErrorEventInput, ErrorGroupBump, RecordedError, RequestSnapshot } from './types';

const CAPTURED = Symbol.for('zenith.error-tracking.captured');

/** 缓冲上限：超出直接丢弃（计数），避免风暴期间内存无界增长 */
const BUFFER_MAX = 500;
/** 达到该量立即触发一次 flush，不等定时器 */
const FLUSH_THRESHOLD = 50;
const FLUSH_INTERVAL_MS = 1000;
/** 一次事务最多写入的事件数 */
const BATCH_MAX = 100;
/** 连续失败多少次进入熔断 */
const BREAKER_FAILURES = 3;
const BREAKER_PAUSE_MS = 30_000;
/** 令牌桶空闲多久后回收 */
const BUCKET_IDLE_MS = 5 * 60_000;
/** 记住最近出现过的指纹（新 Issue 的首个事件不受全局闸约束） */
const SEEN_MAX = 5000;
const MESSAGE_MAX = 2000;

const SERVER_APP_ID = 'server';
// 大量单测以局部对象 mock config；两项都只在模块加载时读一次并宽松取值，缺省不影响采集
const PROCESS_ROLE = (config as { roles?: { label?: string } }).roles?.label ?? 'all';
const RELEASE = (config as { otel?: { serviceVersion?: string } }).otel?.serviceVersion ?? null;

/** 客户端提前断开 / 主动中止：不是服务端缺陷 */
const CLIENT_ABORT_CODES = new Set(['ECONNRESET', 'EPIPE', 'ERR_STREAM_PREMATURE_CLOSE', 'ECONNABORTED']);

interface PendingEvent {
  readonly input: ErrorEventInput;
}

interface TokenBucket {
  tokens: number;
  refilledAt: number;
  touchedAt: number;
}

interface ReporterState {
  pending: PendingEvent[];
  countOnly: Map<string, ErrorGroupBump>;
  buckets: Map<string, TokenBucket>;
  globalBucket: TokenBucket;
  seen: Set<string>;
  settings: ErrorTrackingSettings;
  ignoreRegexps: { source: readonly string[]; compiled: RegExp[] };
  timer: ReturnType<typeof setInterval> | null;
  flushing: Promise<void> | null;
  consecutiveFailures: number;
  pausedUntil: number;
  stats: { captured: number; stored: number; countOnly: number; dropped: number; ignored: number; flushFailures: number };
  listeners: Array<(input: ErrorEventInput, recorded: RecordedError) => void>;
  settingsRefreshing: boolean;
  lastWarnAt: number;
}

function defaultSettings(): ErrorTrackingSettings {
  return resolveSettings('errorTracking', []).value;
}

function newBucket(capacity: number, now: number): TokenBucket {
  return { tokens: capacity, refilledAt: now, touchedAt: now };
}

function createState(): ReporterState {
  const settings = defaultSettings();
  return {
    pending: [],
    countOnly: new Map(),
    buckets: new Map(),
    globalBucket: newBucket(settings.globalPerMinute, Date.now()),
    seen: new Set(),
    settings,
    ignoreRegexps: { source: settings.ignorePatterns, compiled: compilePatterns(settings.ignorePatterns) },
    timer: null,
    flushing: null,
    consecutiveFailures: 0,
    pausedUntil: 0,
    stats: { captured: 0, stored: 0, countOnly: 0, dropped: 0, ignored: 0, flushFailures: 0 },
    listeners: [],
    settingsRefreshing: false,
    lastWarnAt: 0,
  };
}

let state = createState();

function compilePatterns(patterns: readonly string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const pattern of patterns) {
    try { out.push(new RegExp(pattern, 'i')); } catch { /* 无效正则忽略：设置页保存时已提示，这里不能因它抛错 */ }
  }
  return out;
}

/** 令牌桶：每分钟按容量线性补充 */
function takeToken(bucket: TokenBucket, capacity: number, now: number): boolean {
  const elapsed = now - bucket.refilledAt;
  if (elapsed > 0) {
    bucket.tokens = Math.min(capacity, bucket.tokens + (elapsed / 60_000) * capacity);
    bucket.refilledAt = now;
  }
  bucket.touchedAt = now;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

function pruneBuckets(now: number): void {
  if (state.buckets.size < 1000) return;
  for (const [key, bucket] of state.buckets) {
    if (now - bucket.touchedAt > BUCKET_IDLE_MS) state.buckets.delete(key);
  }
}

function rememberSeen(fingerprint: string): boolean {
  if (state.seen.has(fingerprint)) return false;
  if (state.seen.size >= SEEN_MAX) {
    const first = state.seen.values().next().value;
    if (first !== undefined) state.seen.delete(first);
  }
  state.seen.add(fingerprint);
  return true;
}

/** 采集器内部告警：走 warn 级别（不会再次进入兜底网），且每分钟最多一次 */
function warnThrottled(message: string, meta?: Record<string, unknown>): void {
  const now = Date.now();
  if (now - state.lastWarnAt < 60_000) return;
  state.lastWarnAt = now;
  logger.warn({ ...meta, errorTracking: true }, message);
}

function resolveEnvironment(): AnalyticsEnvironment {
  const env = (config as { nodeEnv?: string }).nodeEnv ?? 'development';
  if (env === 'production') return 'production';
  if (env === 'staging') return 'staging';
  return 'development';
}

function defaultLevel(kind: ServerErrorType, ctx: CaptureContext): ErrorLevel {
  if (ctx.level) return ctx.level;
  if (kind === 'process_crash') return 'fatal';
  if (kind === 'job_failure' && ctx.job && ctx.job.final === false) return 'warning';
  return 'error';
}

export function isCaptured(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as Record<symbol, unknown>)[CAPTURED] === true;
}

export function markCaptured(err: unknown): void {
  if (typeof err !== 'object' || err === null) return;
  try {
    Object.defineProperty(err, CAPTURED, { value: true, enumerable: false, configurable: true });
  } catch { /* 冻结对象等极端情况忽略 */ }
}

/** 内建过滤：预期内的业务失败 / 客户端中断 / 停机中的收尾错误不记 */
function shouldSkip(cause: unknown, ctx: CaptureContext): boolean {
  if (ctx.force) return false;
  if (isFatalShutdownInProgress()) return true;
  if (cause instanceof HTTPException && cause.status < 500) return true;
  if (typeof cause === 'object' && cause !== null) {
    const name = (cause as { name?: unknown }).name;
    if (name === 'OAuth2Error' || name === 'AbortError') return true;
    const code = (cause as { code?: unknown }).code;
    if (typeof code === 'string' && CLIENT_ABORT_CODES.has(code)) return true;
  }
  return false;
}

function isIgnoredByPattern(message: string): boolean {
  if (state.ignoreRegexps.source !== state.settings.ignorePatterns) {
    state.ignoreRegexps = { source: state.settings.ignorePatterns, compiled: compilePatterns(state.settings.ignorePatterns) };
  }
  return state.ignoreRegexps.compiled.some((re) => re.test(message));
}

function buildInput(cause: unknown, ctx: CaptureContext): ErrorEventInput {
  const normalized = normalizeThrown(cause);
  const kind = ctx.kind ?? 'server_exception';
  const level = defaultLevel(kind, ctx);
  const environment = resolveEnvironment();
  const message = (ctx.message ? `${ctx.message}: ${normalized.message}` : normalized.message).slice(0, MESSAGE_MAX);
  const fingerprint = computeServerFingerprint({ environment, errorType: kind, errorName: normalized.name, message, stack: normalized.stack, override: ctx.fingerprint });

  const user = currentUserOrNull();
  const member = user ? undefined : currentMemberOrNull();
  const userId = ctx.userId !== undefined ? ctx.userId : user?.userId ?? null;
  const username = ctx.username !== undefined ? ctx.username : user?.username ?? member?.identifier ?? null;
  const affectedTenantId = ctx.tenantId !== undefined ? ctx.tenantId : user?.tenantId ?? member?.tenantId ?? null;
  const identity = userId != null ? `u:${userId}` : member?.memberId != null ? `m:${member.memberId}` : null;
  const correlationId = (ctx.correlationId !== undefined ? ctx.correlationId : currentCorrelationId()) ?? null;
  const request = ctx.request;

  const context: Record<string, unknown> = {};
  if (request) context.request = request;
  if (ctx.job) context.job = ctx.job;
  if (normalized.details) context.errorDetails = normalized.details;
  if (ctx.extra) context.extra = ctx.extra;

  return {
    tenantId: null,
    fingerprint,
    source: 'server',
    appId: SERVER_APP_ID,
    environment,
    errorType: kind,
    level,
    message,
    release: RELEASE,
    occurredAt: ctx.occurredAt ?? new Date(),
    identity,
    event: {
      stack: normalized.stack,
      context: Object.keys(context).length > 0 ? context : null,
      httpStatus: request?.status ?? null,
      httpMethod: request?.method ?? null,
      httpUrl: request?.url?.slice(0, 512) ?? null,
      userId,
      username: username?.slice(0, 64) ?? null,
      memberId: member?.memberId ?? null,
      correlationId: correlationId?.slice(0, 64) ?? null,
      route: request?.route?.slice(0, 256) ?? null,
      errorName: normalized.name,
      errorCode: normalized.code,
      jobType: ctx.job?.type.slice(0, 64) ?? null,
      jobId: ctx.job?.id != null ? String(ctx.job.id).slice(0, 64) : null,
      processRole: PROCESS_ROLE,
      hostname: PROCESS_HOSTNAME.slice(0, 128),
      pid: PROCESS_PID,
      affectedTenantId,
    },
  };
}

/**
 * 采集一个异常。同步返回，不抛错；实际落库由后台 flush 完成。
 * 同一个 Error 对象重复传入只记一次（`markCaptured`），显式采集与 logger 兜底网因此不会重复。
 */
export function captureException(cause: unknown, ctx: CaptureContext = {}): void {
  if (isCaptured(cause)) return;
  markCaptured(cause);
  captureMarked(cause, ctx);
}

/**
 * HTTP 处理链的采集入口：先同步打标（随后的 `logger.error` 兜底网不会抢先记一条无上下文的事件），
 * 再异步构建脱敏请求快照后入队。
 */
export async function captureRequestException(cause: unknown, c: Context, options: { status: number; extra?: Record<string, unknown> } ): Promise<void> {
  if (isCaptured(cause)) return;
  markCaptured(cause);
  let request: RequestSnapshot | undefined;
  try {
    const { captureBody, bodyMaxBytes, redactKeys } = state.settings.request;
    request = await snapshotRequest(c, { status: options.status, captureBody, bodyMaxBytes, extraKeys: redactKeys });
  } catch { /* 快照失败不影响采集 */ }
  captureMarked(cause, { kind: 'server_exception', request, extra: options.extra });
}

/** 已打标的异常进入过滤 / 限流 / 缓冲 */
function captureMarked(cause: unknown, ctx: CaptureContext): void {
  try {
    if (!state.settings.enabled) return;
    if (ctx.kind === 'logged_error' && !state.settings.captureLoggedErrors) return;
    if (shouldSkip(cause, ctx)) return;

    const input = buildInput(cause, ctx);
    state.stats.captured += 1;
    if (isIgnoredByPattern(input.message)) {
      state.stats.ignored += 1;
      return;
    }

    const now = Date.now();
    const isNew = rememberSeen(input.fingerprint);
    let bucket = state.buckets.get(input.fingerprint);
    if (!bucket) {
      bucket = newBucket(state.settings.perIssuePerMinute, now);
      state.buckets.set(input.fingerprint, bucket);
      pruneBuckets(now);
    }
    const perIssueOk = takeToken(bucket, state.settings.perIssuePerMinute, now);
    const globalOk = isNew || takeToken(state.globalBucket, state.settings.globalPerMinute, now);
    if (!perIssueOk || !globalOk) {
      // 事件详情不再保存，但次数与最近发生时间必须准确
      const prev = state.countOnly.get(input.fingerprint);
      state.countOnly.set(input.fingerprint, {
        fingerprint: input.fingerprint,
        count: (prev?.count ?? 0) + 1,
        lastSeenAt: input.occurredAt,
      });
      state.stats.countOnly += 1;
      return;
    }
    if (state.pending.length >= BUFFER_MAX) {
      state.stats.dropped += 1;
      warnThrottled('[error-tracking] 缓冲已满，异常事件被丢弃', { dropped: state.stats.dropped });
      return;
    }
    state.pending.push({ input });
    if (state.pending.length >= FLUSH_THRESHOLD) void flushErrorReporter();
  } catch (err) {
    // 采集器自身的问题只能进日志（warn 级别不会回流到兜底网）
    warnThrottled('[error-tracking] 采集失败', { err: err instanceof Error ? err.message : String(err) });
  }
}

function refreshSettings(): void {
  if (state.settingsRefreshing) return;
  state.settingsRefreshing = true;
  getSettings('errorTracking')
    .then((settings) => { state.settings = settings; })
    .catch(() => { /* 设置不可读时沿用上一份（首次为 schema 默认值） */ })
    .finally(() => { state.settingsRefreshing = false; });
}

async function flushOnce(): Promise<void> {
  const now = Date.now();
  if (state.pausedUntil > now) {
    // 熔断期间不落库；丢弃缓冲避免堆积，次数聚合保留到恢复后一并写入
    if (state.pending.length > 0) {
      state.stats.dropped += state.pending.length;
      state.pending = [];
    }
    return;
  }
  const batch = state.pending.splice(0, BATCH_MAX);
  const bumps = [...state.countOnly.values()];
  state.countOnly.clear();
  if (batch.length === 0 && bumps.length === 0) return;

  try {
    if (batch.length > 0) {
      const recorded = await recordErrorEventBatch(batch.map((p) => p.input));
      state.stats.stored += recorded.length;
      recorded.forEach((result, index) => {
        for (const listener of state.listeners) {
          try { listener(batch[index].input, result); } catch { /* 监听器自身失败不影响采集 */ }
        }
      });
    }
    if (bumps.length > 0) await bumpErrorGroupCounts(bumps);
    state.consecutiveFailures = 0;
  } catch (err) {
    state.stats.flushFailures += 1;
    state.stats.dropped += batch.length;
    state.consecutiveFailures += 1;
    if (state.consecutiveFailures >= BREAKER_FAILURES) {
      state.pausedUntil = Date.now() + BREAKER_PAUSE_MS;
      state.consecutiveFailures = 0;
      warnThrottled('[error-tracking] 连续落库失败，暂停采集 30 秒', { err: err instanceof Error ? err.message : String(err), dropped: batch.length });
    } else {
      warnThrottled('[error-tracking] 异常事件落库失败', { err: err instanceof Error ? err.message : String(err), dropped: batch.length });
    }
  }
}

/** 立即执行一次 flush（并发调用合并为同一次） */
export function flushErrorReporter(): Promise<void> {
  if (state.flushing) return state.flushing;
  refreshSettings();
  state.flushing = flushOnce().finally(() => { state.flushing = null; });
  return state.flushing;
}

/** 事件落库后的回调（告警评估等由上层注册，lib 不反向依赖 service） */
export function onErrorRecorded(listener: (input: ErrorEventInput, recorded: RecordedError) => void): () => void {
  state.listeners.push(listener);
  return () => { state.listeners = state.listeners.filter((l) => l !== listener); };
}

/**
 * 启动采集器：定时 flush + 接管 logger 的 error / fatal 兜底网。api / worker 角色都需要；重复调用幂等。
 */
export function startErrorReporter(): void {
  if (state.timer) return;
  refreshSettings();
  state.timer = setInterval(() => { void flushErrorReporter(); }, FLUSH_INTERVAL_MS);
  state.timer.unref?.();
  setLoggedErrorSink(({ err, message, level }) => {
    captureException(err, { kind: 'logged_error', level: level === 'fatal' ? 'fatal' : 'error', message });
  });
}

/** 停机：停止定时器并把缓冲写完（带超时，不阻塞优雅停机） */
export async function stopErrorReporter(timeoutMs = 3000): Promise<void> {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  setLoggedErrorSink(undefined);
  await Promise.race([
    flushErrorReporter(),
    new Promise<void>((resolve) => { setTimeout(resolve, timeoutMs).unref?.(); }),
  ]);
}

export function errorReporterStats(): Readonly<ReporterState['stats']> & { pending: number; paused: boolean } {
  return { ...state.stats, pending: state.pending.length, paused: state.pausedUntil > Date.now() };
}

/** 当前生效的采集设置（采集点构建请求快照时读取；随 flush 异步刷新） */
export function currentErrorTrackingSettings(): ErrorTrackingSettings {
  return state.settings;
}

/** 测试专用：重置全部状态与定时器 */
export function __resetErrorReporterForTests(settings?: Partial<ErrorTrackingSettings>): void {
  if (state.timer) clearInterval(state.timer);
  setLoggedErrorSink(undefined);
  state = createState();
  if (settings) state.settings = { ...state.settings, ...settings, request: { ...state.settings.request, ...settings.request } };
  state.globalBucket = newBucket(state.settings.globalPerMinute, Date.now());
}
