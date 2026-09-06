/**
 * 终端会话服务：内存注册表与持久化记录之间的唯一桥梁。
 *
 * 会话进程只存活在创建它的 Node 实例内存中，`terminal_sessions` 表是它的权威元数据。
 * 本模块负责：
 *  - 创建 / 断开 / 重连 / 结束时把状态落库，使会话可事后追溯；
 *  - 启动时结算本实例遗留的未终结记录（其进程随上次退出已消失）；
 *  - 周期性回写活跃时间与终端尺寸；
 *  - 对监控 / 终止路径施加租户判定，再把句柄交给调用方。
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { v7 as uuidv7 } from 'uuid';
import type { TerminalEndReason, TerminalSessionKind, TerminalSessionState } from '@zenith/shared/ops';
import { config } from '../../config';
import { db } from '../../db';
import { terminalSessions } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatDateTime } from '../../lib/datetime';
import { buildListResult } from '../../lib/list-query';
import logger from '../../lib/logger';
import { pageOffset } from '../../lib/pagination';
import { getEffectiveTenantId, isPlatformAdmin } from '../../lib/tenant';
import {
  NODE_ID,
  countSessionsByUser,
  findSessionForAuthorizedCaller,
  listSessionsMeta,
  setSessionLifecycleHooks,
  snapshotSessions,
  terminateSession,
  toSessionMeta,
  type TerminalSession,
  type TerminalSessionMeta,
} from '../../lib/terminal-session-registry';
import type { JwtPayload } from '../../middleware/auth';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';

/** 单个用户可同时持有的活动会话数上限，避免开标签页即耗尽宿主机进程 */
export const MAX_SESSIONS_PER_USER = 20;

/**
 * 判断用户能否观察 / 接管 / 终止归属指定租户的终端会话。
 *
 * 与 `tenantCondition` 同语义，但活动会话存活在内存注册表而非数据库，
 * 无法复用 SQL 条件，因此在此实现同一套判定。
 */
export function canAccessTerminalSession(user: JwtPayload, sessionTenantId: number | null): boolean {
  if (!config.multiTenantMode) return true;
  const effectiveTenantId = getEffectiveTenantId(user);
  // 平台超管未切换租户视角时可见全部会话
  if (isPlatformAdmin(user) && effectiveTenantId === null) return true;
  return sessionTenantId === effectiveTenantId;
}

// ─── 持久化 ────────────────────────────────────────────────────────────────

export interface CreateTerminalSessionInput {
  userId: number;
  tenantId: number | null;
  kind: TerminalSessionKind;
  target: string;
  label: string;
  clientIp: string;
}

/**
 * 生成服务端权威会话标识。
 *
 * ID 由服务端生成：客户端既无法指定新会话的 ID，也就无法凭猜测或复用
 * 让一个自选标识的会话存在。返回值即后续 WebSocket 重连使用的标识。
 */
export function newTerminalSessionId(): string {
  return uuidv7();
}

/**
 * 落库新会话记录。
 *
 * 刻意不返回 Promise：终端 I/O 不应等待一次审计写入，
 * 写失败只记日志，会话继续可用。
 */
export function persistNewTerminalSession(sessionId: string, input: CreateTerminalSessionInput): void {
  void db
    .insert(terminalSessions)
    .values({
      id: sessionId,
      userId: input.userId,
      tenantId: input.tenantId,
      kind: input.kind,
      target: input.target.slice(0, 255),
      label: input.label.slice(0, 255),
      clientIp: input.clientIp.slice(0, 64),
      nodeId: NODE_ID,
      state: 'active',
    })
    .catch((err: unknown) => logger.error('[terminal] failed to persist new session', err));
}

/** 会话启动失败时留痕，便于排查「点了没反应」的场景 */
export function recordTerminalSessionFailure(input: CreateTerminalSessionInput): void {
  void db
    .insert(terminalSessions)
    .values({
      id: uuidv7(),
      userId: input.userId,
      tenantId: input.tenantId,
      kind: input.kind,
      target: input.target.slice(0, 255),
      label: input.label.slice(0, 255),
      clientIp: input.clientIp.slice(0, 64),
      nodeId: NODE_ID,
      state: 'failed',
      endedAt: new Date(),
      endReason: 'start_failed',
    })
    .catch((err: unknown) => logger.error('[terminal] failed to record session failure', err));
}

interface StatePatch {
  state?: TerminalSessionState;
  endReason?: TerminalEndReason;
  cols?: number;
  rows?: number;
}

/** 落库以「不阻塞终端 I/O」为前提：写失败只记日志，不影响正在进行的会话。 */
function persistState(sessionId: string, patch: StatePatch): void {
  const values: Record<string, unknown> = { lastActivityAt: new Date(), ...patch };
  if (patch.state === 'terminated' || patch.state === 'failed') values.endedAt = new Date();
  void db
    .update(terminalSessions)
    .set(values)
    .where(eq(terminalSessions.id, sessionId))
    .catch((err: unknown) => logger.error('[terminal] failed to persist session state', err));
}

/** 把注册表生命周期回调接到持久化上 */
export function registerTerminalSessionPersistence(): void {
  setSessionLifecycleHooks({
    onDetached: (s) => persistState(s.sessionId, { state: 'detached', cols: s.cols, rows: s.rows }),
    onReattached: (s) => persistState(s.sessionId, { state: 'active' }),
    onEnded: (s, reason) =>
      persistState(s.sessionId, { state: 'terminated', endReason: reason, cols: s.cols, rows: s.rows }),
  });
}

/**
 * 启动结算：本实例上一轮遗留的 active / detached 记录，其进程已随进程退出消失，
 * 统一标记为 failed，避免历史查询里出现永远「连接中」的幽灵会话。
 */
export async function reconcileTerminalSessionsOnStartup(): Promise<number> {
  const stale = await db
    .update(terminalSessions)
    .set({ state: 'failed', endReason: 'server_shutdown', endedAt: new Date() })
    .where(and(eq(terminalSessions.nodeId, NODE_ID), inArray(terminalSessions.state, ['active', 'detached'])))
    .returning({ id: terminalSessions.id });
  if (stale.length > 0) {
    logger.info(`[terminal] reconciled ${stale.length} stale session record(s) from a previous run`);
  }
  return stale.length;
}

/** 周期性把活跃时间与终端尺寸回写数据库，供会话列表与空闲判定使用 */
const ACTIVITY_FLUSH_INTERVAL_MS = 30_000;
let flushTimer: ReturnType<typeof setInterval> | null = null;

async function flushActivity(): Promise<void> {
  const live = snapshotSessions();
  if (live.length === 0) return;
  await Promise.all(
    live.map((s) =>
      db
        .update(terminalSessions)
        .set({ lastActivityAt: new Date(s.lastActivityAt), cols: s.cols, rows: s.rows })
        .where(eq(terminalSessions.id, s.sessionId)),
    ),
  );
}

export function startTerminalSessionReaper(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    void flushActivity().catch((err: unknown) => logger.error('[terminal] activity flush failed', err));
  }, ACTIVITY_FLUSH_INTERVAL_MS);
  flushTimer.unref();
}

export function stopTerminalSessionReaper(): void {
  if (!flushTimer) return;
  clearInterval(flushTimer);
  flushTimer = null;
}

// ─── 配额 ──────────────────────────────────────────────────────────────────

/** 用户是否还能新建会话；超限时返回面向用户的原因文案 */
export function checkSessionQuota(userId: number): string | null {
  if (countSessionsByUser(userId) >= MAX_SESSIONS_PER_USER) {
    return `已达到单用户最多 ${MAX_SESSIONS_PER_USER} 个终端会话的上限，请先关闭部分会话`;
  }
  return null;
}

// ─── 查询 / 监控 ───────────────────────────────────────────────────────────

/** 将注册表元数据映射为对外 DTO（含派生的空闲/持续时长） */
function mapMeta(m: TerminalSessionMeta) {
  const now = Date.now();
  return {
    sessionId: m.sessionId,
    userId: m.userId,
    username: m.username,
    kind: m.kind,
    label: m.label,
    clientIp: m.clientIp,
    cols: m.cols,
    rows: m.rows,
    connected: m.connected,
    observerCount: m.observerCount,
    takenOver: m.takenOver,
    startedAt: formatDateTime(new Date(m.startedAt)),
    lastActivityAt: formatDateTime(new Date(m.lastActivityAt)),
    idleSeconds: Math.max(0, Math.floor((now - m.lastActivityAt) / 1000)),
    durationSeconds: Math.max(0, Math.floor((now - m.startedAt) / 1000)),
  };
}

export interface ListTerminalSessionsParams {
  page: number;
  pageSize: number;
  keyword?: string;
  kind?: TerminalSessionKind;
}

/** 分页列出活动终端会话（内存注册表，进程内分页）。 */
export function listTerminalSessions(params: ListTerminalSessionsParams) {
  const { page, pageSize, keyword, kind } = params;
  const user = currentUser();
  let all = listSessionsMeta().filter((s) => canAccessTerminalSession(user, s.tenantId));
  if (kind) all = all.filter((s) => s.kind === kind);
  if (keyword) {
    const kw = keyword.toLowerCase();
    all = all.filter(
      (s) => s.username.toLowerCase().includes(kw) || s.label.toLowerCase().includes(kw) || s.clientIp.includes(kw),
    );
  }
  const total = all.length;
  const list = all.slice(pageOffset(page, pageSize), page * pageSize).map(mapMeta);
  return { list, total, page, pageSize };
}

/**
 * 取得会话句柄用于监控 / 接管；租户不符返回 null。
 *
 * 这是唯一被允许绕过归属校验的入口，租户判定集中在此，
 * 监控 WebSocket 与强制终止不再各写一遍。
 */
export function acquireSessionForMonitor(sessionId: string, user: JwtPayload): TerminalSession | null {
  const session = findSessionForAuthorizedCaller(sessionId);
  if (!session || !canAccessTerminalSession(user, session.tenantId)) return null;
  return session;
}

/** 获取单个会话快照（用于强制终止前的审计记录）。跨租户返回 null。 */
export function getTerminalSessionSnapshot(sessionId: string) {
  const session = acquireSessionForMonitor(sessionId, currentUser());
  return session ? mapMeta(toSessionMeta(session)) : null;
}

/** 强制终止指定会话。跨租户按「不存在」处理，避免暴露他租户会话的存在性。 */
export function terminateTerminalSession(sessionId: string): void {
  const session = acquireSessionForMonitor(sessionId, currentUser());
  if (!session) throw new HTTPException(404, { message: '会话不存在或已结束' });
  terminateSession(session);
}

// ─── 历史记录 ──────────────────────────────────────────────────────────────

export interface ListTerminalSessionHistoryParams {
  page: number;
  pageSize: number;
  keyword?: string;
  kind?: TerminalSessionKind;
}

/** 分页查询会话历史（含已结束会话），用于事后追溯。 */
export async function listTerminalSessionHistory(params: ListTerminalSessionHistoryParams) {
  const { page, pageSize, keyword, kind } = params;
  const user = currentUser();
  const conditions = [];
  if (config.multiTenantMode && !(isPlatformAdmin(user) && getEffectiveTenantId(user) === null)) {
    const effectiveTenantId = getEffectiveTenantId(user);
    conditions.push(
      effectiveTenantId === null
        ? sql`${terminalSessions.tenantId} is null`
        : eq(terminalSessions.tenantId, effectiveTenantId),
    );
  }
  if (kind) conditions.push(eq(terminalSessions.kind, kind));
  conditions.push(keywordCondition(keyword, [terminalSessions.label, terminalSessions.clientIp]));
  const where = buildWhere(...conditions);

  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(terminalSessions, where),
    rows: () => db
      .select()
      .from(terminalSessions)
      .where(where)
      .orderBy(desc(terminalSessions.startedAt))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
    map: (r) => ({
      sessionId: r.id,
      userId: r.userId,
      kind: r.kind,
      target: r.target,
      label: r.label,
      clientIp: r.clientIp,
      state: r.state,
      cols: r.cols,
      rows: r.rows,
      endReason: r.endReason,
      startedAt: formatDateTime(r.startedAt),
      lastActivityAt: formatDateTime(r.lastActivityAt),
      endedAt: r.endedAt ? formatDateTime(r.endedAt) : null,
    }),
  });
}
