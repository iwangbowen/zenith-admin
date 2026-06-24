/**
 * 公众号多客服会话治理（实时状态机）。
 *
 * 状态机：waiting（排队）→ active（进行）→ closed（结束）。
 *  - 接入：粉丝来消息时建会话；按策略自动分配客服（会话分配），或人工接入（accept）
 *  - 转接：将进行中的会话改派给另一名客服（transfer）
 *  - 超时自动路由：定时任务扫描——排队超时重新路由（reroute）、会话空闲超时自动结束
 *
 * 鉴权路由（list/detail/stats/accept/transfer/close/reply/config）走 tenantScope；
 * 回调接入钩子 onFanInboundMessage 与定时任务 runMpKfSessionTimeouts 无登录上下文，按 accountId 直接查询。
 */
import { eq, and, ne, lt, gte, inArray, desc, asc, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import {
  mpKfSessions, mpKfSessionEvents, mpKfRoutingConfigs, mpKfAccounts, mpFans, mpMessages, mpAccounts, users,
} from '../db/schema';
import type {
  MpKfSessionRow, MpKfRoutingConfigRow, MpAccountRow,
} from '../db/schema';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import { currentUserOrNull } from '../lib/context';
import { ensureMpAccountExists } from './mp-account.service';
import { mapMpMessage } from './mp-message.service';
import { sendCustomServiceMessage, WechatApiError } from '../lib/wechat';
import { broadcast } from '../lib/ws-manager';
import logger from '../lib/logger';
import type {
  MpKfSession, MpKfSessionDetail, MpKfSessionEvent, MpKfRoutingConfig, MpKfSessionStats,
  MpKfSessionEventType, MpKfSessionCloseReason, MpKfRoutingStrategy, MpMessageType,
  AcceptMpKfSessionInput, TransferMpKfSessionInput, CloseMpKfSessionInput,
  ReplyMpKfSessionInput, UpdateMpKfRoutingConfigInput,
} from '@zenith/shared';

// ─── 映射 ────────────────────────────────────────────────────────────────────
interface SessionJoinRow {
  s: MpKfSessionRow;
  kfNickname: string | null;
  fanNickname: string | null;
  fanAvatar: string | null;
}

function mapSession(r: SessionJoinRow): MpKfSession {
  const s = r.s;
  let waitSeconds: number | undefined;
  if (s.status === 'waiting' && s.waitingSince) {
    waitSeconds = Math.max(0, Math.floor((Date.now() - s.waitingSince.getTime()) / 1000));
  }
  return {
    id: s.id,
    accountId: s.accountId,
    openid: s.openid,
    kfId: s.kfId ?? null,
    kfNickname: r.kfNickname ?? null,
    fanNickname: r.fanNickname ?? null,
    fanAvatar: r.fanAvatar ?? null,
    status: s.status,
    priority: s.priority,
    source: s.source ?? null,
    unreadCount: s.unreadCount,
    lastFanMsgAt: formatNullableDateTime(s.lastFanMsgAt),
    lastKfMsgAt: formatNullableDateTime(s.lastKfMsgAt),
    lastMsgAt: formatNullableDateTime(s.lastMsgAt),
    waitingSince: formatNullableDateTime(s.waitingSince),
    acceptedAt: formatNullableDateTime(s.acceptedAt),
    closedAt: formatNullableDateTime(s.closedAt),
    closeReason: s.closeReason ?? null,
    remark: s.remark ?? null,
    waitSeconds,
    createdAt: formatDateTime(s.createdAt),
    updatedAt: formatDateTime(s.updatedAt),
  };
}

function mapConfig(row: MpKfRoutingConfigRow): MpKfRoutingConfig {
  return {
    id: row.id,
    accountId: row.accountId,
    enabled: row.enabled,
    strategy: row.strategy,
    maxConcurrent: row.maxConcurrent,
    waitTimeoutMinutes: row.waitTimeoutMinutes,
    idleTimeoutMinutes: row.idleTimeoutMinutes,
    autoCloseEnabled: row.autoCloseEnabled,
    welcomeText: row.welcomeText ?? null,
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function sessionSelection() {
  return db
    .select({
      s: mpKfSessions,
      kfNickname: mpKfAccounts.nickname,
      fanNickname: mpFans.nickname,
      fanAvatar: mpFans.avatar,
    })
    .from(mpKfSessions)
    .leftJoin(mpKfAccounts, eq(mpKfAccounts.id, mpKfSessions.kfId))
    .leftJoin(mpFans, and(eq(mpFans.accountId, mpKfSessions.accountId), eq(mpFans.openid, mpKfSessions.openid)));
}

async function loadMappedSession(id: number): Promise<MpKfSession | null> {
  const [r] = await sessionSelection().where(eq(mpKfSessions.id, id)).limit(1);
  return r ? mapSession(r) : null;
}

// ─── WebSocket 实时推送（广播给所有后台连接，前端按 accountId 过滤）──────────────
async function notifySession(type: 'mp-kf:session-new' | 'mp-kf:session-update', id: number): Promise<void> {
  try {
    const m = await loadMappedSession(id);
    if (m) broadcast({ type, payload: m });
  } catch (err) {
    logger.warn(`[mp-kf-session] WS 推送失败: ${(err as Error).message}`);
  }
}

function notifyMessage(payload: { sessionId: number; accountId: number; openid: string; direction: 'in' | 'out'; msgType: MpMessageType; content: string | null; createdAt: string }): void {
  try {
    broadcast({ type: 'mp-kf:session-message', payload });
  } catch { /* ignore */ }
}

// ─── 内部工具 ──────────────────────────────────────────────────────────────────
function operatorId(): number | null {
  return currentUserOrNull()?.userId ?? null;
}

/** 直接按 id 取公众号（无租户域，供回调/定时/已通过会话租户校验的鉴权路径取凭证） */
async function getAccountRowById(accountId: number): Promise<MpAccountRow | null> {
  const [row] = await db.select().from(mpAccounts).where(eq(mpAccounts.id, accountId)).limit(1);
  return row ?? null;
}

async function getEnabledConfigRow(accountId: number): Promise<MpKfRoutingConfigRow | null> {
  const [row] = await db.select().from(mpKfRoutingConfigs).where(eq(mpKfRoutingConfigs.accountId, accountId)).limit(1);
  return row && row.enabled ? row : null;
}

/** 写一条会话事件流水 */
async function logEvent(p: {
  sessionId: number; accountId: number; type: MpKfSessionEventType;
  fromKfId?: number | null; toKfId?: number | null; operatorId?: number | null;
  detail?: string | null; tenantId: number | null;
}): Promise<void> {
  await db.insert(mpKfSessionEvents).values({
    sessionId: p.sessionId,
    accountId: p.accountId,
    type: p.type,
    fromKfId: p.fromKfId ?? null,
    toKfId: p.toKfId ?? null,
    operatorId: p.operatorId ?? null,
    detail: p.detail ?? null,
    tenantId: p.tenantId,
  });
}

/**
 * 会话分配核心：按策略在「启用 + 未满容量」的客服中挑选一名。
 * - manual：不自动分配（返回 null，等待人工抢单）
 * - least_active：当前进行中会话最少者优先
 * - round_robin：最久未被分配者优先（轮询）
 */
async function pickKf(accountId: number, strategy: MpKfRoutingStrategy, maxConcurrent: number): Promise<number | null> {
  if (strategy === 'manual') return null;
  const candidates = await db
    .select({ id: mpKfAccounts.id })
    .from(mpKfAccounts)
    .where(and(eq(mpKfAccounts.accountId, accountId), eq(mpKfAccounts.status, 'enabled')));
  if (candidates.length === 0) return null;
  const ids = candidates.map((c) => c.id);

  const [counts, lasts] = await Promise.all([
    db
      .select({ kfId: mpKfSessions.kfId, n: sql<number>`count(*)::int` })
      .from(mpKfSessions)
      .where(and(eq(mpKfSessions.accountId, accountId), eq(mpKfSessions.status, 'active'), inArray(mpKfSessions.kfId, ids)))
      .groupBy(mpKfSessions.kfId),
    db
      .select({ kfId: mpKfSessions.kfId, t: sql<number>`coalesce(extract(epoch from max(${mpKfSessions.acceptedAt})), 0)::float` })
      .from(mpKfSessions)
      .where(and(eq(mpKfSessions.accountId, accountId), inArray(mpKfSessions.kfId, ids)))
      .groupBy(mpKfSessions.kfId),
  ]);
  const countMap = new Map<number, number>();
  for (const c of counts) if (c.kfId != null) countMap.set(c.kfId, c.n);
  const lastMap = new Map<number, number>();
  for (const l of lasts) if (l.kfId != null) lastMap.set(l.kfId, Number(l.t) || 0);

  const available = ids.filter((id) => (countMap.get(id) ?? 0) < maxConcurrent);
  if (available.length === 0) return null;

  if (strategy === 'least_active') {
    available.sort((a, b) => (countMap.get(a) ?? 0) - (countMap.get(b) ?? 0) || (lastMap.get(a) ?? 0) - (lastMap.get(b) ?? 0) || a - b);
  } else {
    available.sort((a, b) => (lastMap.get(a) ?? 0) - (lastMap.get(b) ?? 0) || a - b);
  }
  return available[0];
}

/** 接入后异步发送欢迎语（最佳努力，不阻塞主流程；假账号 40013 仅告警） */
function scheduleWelcome(accountId: number, openid: string, sessionId: number, welcomeText: string, tenantId: number | null): void {
  setImmediate(() => {
    void (async () => {
      try {
        const account = await getAccountRowById(accountId);
        if (!account) return;
        await sendCustomServiceMessage(account, openid, { msgType: 'text', content: welcomeText });
        const now = new Date();
        await Promise.all([
          db.insert(mpMessages).values({ accountId, openid, direction: 'out', msgType: 'text', content: welcomeText, status: 'sent', tenantId }),
          db.update(mpKfSessions).set({ lastKfMsgAt: now, lastMsgAt: now }).where(eq(mpKfSessions.id, sessionId)),
        ]);
        notifyMessage({ sessionId, accountId, openid, direction: 'out', msgType: 'text', content: welcomeText, createdAt: formatDateTime(now) });
      } catch (err) {
        logger.warn(`[mp-kf-session] 欢迎语发送失败（已忽略）: ${(err as Error).message}`);
      }
    })();
  });
}

/** 分配/改派会话给指定客服并落事件，返回是否应发欢迎语由调用方决定 */
async function assignKf(p: {
  session: MpKfSessionRow; toKfId: number; type: MpKfSessionEventType;
  operatorId: number | null; cfg: MpKfRoutingConfigRow; detail: string; sendWelcome: boolean;
}): Promise<void> {
  const now = new Date();
  const fromKfId = p.session.kfId ?? null;
  await db
    .update(mpKfSessions)
    .set({ kfId: p.toKfId, status: 'active', acceptedAt: p.session.acceptedAt ?? now, waitingSince: null, lastMsgAt: now })
    .where(eq(mpKfSessions.id, p.session.id));
  await logEvent({
    sessionId: p.session.id, accountId: p.session.accountId, type: p.type,
    fromKfId, toKfId: p.toKfId, operatorId: p.operatorId, detail: p.detail, tenantId: p.session.tenantId,
  });
  if (p.sendWelcome && p.cfg.welcomeText) {
    scheduleWelcome(p.session.accountId, p.session.openid, p.session.id, p.cfg.welcomeText, p.session.tenantId);
  }
}

// ─── 回调接入钩子（公开回调调用，无登录上下文）─────────────────────────────────
/**
 * 粉丝入站消息触发会话接入。
 * 已有未结束会话 → 累加未读并刷新时间；无会话 → 建排队会话并按策略尝试自动分配。
 */
export async function onFanInboundMessage(accountId: number, tenantId: number | null, openid: string, source: string): Promise<void> {
  const cfg = await getEnabledConfigRow(accountId);
  if (!cfg) return;
  const now = new Date();

  const [open] = await db
    .select()
    .from(mpKfSessions)
    .where(and(eq(mpKfSessions.accountId, accountId), eq(mpKfSessions.openid, openid), ne(mpKfSessions.status, 'closed')))
    .limit(1);

  if (open) {
    await db
      .update(mpKfSessions)
      .set({ lastFanMsgAt: now, lastMsgAt: now, unreadCount: sql`${mpKfSessions.unreadCount} + 1` })
      .where(eq(mpKfSessions.id, open.id));
    notifyMessage({ sessionId: open.id, accountId, openid, direction: 'in', msgType: source as MpMessageType, content: null, createdAt: formatDateTime(now) });
    void notifySession('mp-kf:session-update', open.id);
    return;
  }

  let created: MpKfSessionRow;
  try {
    const [row] = await db
      .insert(mpKfSessions)
      .values({ accountId, openid, status: 'waiting', source, unreadCount: 1, lastFanMsgAt: now, lastMsgAt: now, waitingSince: now, tenantId })
      .returning();
    created = row;
  } catch {
    // 并发竞态：另一条入站已建会话 → 退化为累加未读
    const [again] = await db
      .select()
      .from(mpKfSessions)
      .where(and(eq(mpKfSessions.accountId, accountId), eq(mpKfSessions.openid, openid), ne(mpKfSessions.status, 'closed')))
      .limit(1);
    if (!again) return;
    await db
      .update(mpKfSessions)
      .set({ lastFanMsgAt: now, lastMsgAt: now, unreadCount: sql`${mpKfSessions.unreadCount} + 1` })
      .where(eq(mpKfSessions.id, again.id));
    void notifySession('mp-kf:session-update', again.id);
    return;
  }

  await logEvent({ sessionId: created.id, accountId, type: 'create', detail: '粉丝发起会话', tenantId });

  const kfId = await pickKf(accountId, cfg.strategy, cfg.maxConcurrent);
  if (kfId) {
    await assignKf({ session: created, toKfId: kfId, type: 'assign', operatorId: null, cfg, detail: '系统自动分配', sendWelcome: true });
  }
  void notifySession('mp-kf:session-new', created.id);
}

// ─── 鉴权路由：列表 / 详情 / 概览 ───────────────────────────────────────────────
export interface ListMpKfSessionsQuery {
  accountId: number;
  status?: 'waiting' | 'active' | 'closed';
  kfId?: number;
  keyword?: string;
  page: number;
  pageSize: number;
}

export async function listMpKfSessions(q: ListMpKfSessionsQuery) {
  await ensureMpAccountExists(q.accountId);
  const conditions: SQL[] = [eq(mpKfSessions.accountId, q.accountId)];
  const tenant = tenantScope(mpKfSessions);
  if (tenant) conditions.push(tenant);
  if (q.status) conditions.push(eq(mpKfSessions.status, q.status));
  if (q.kfId) conditions.push(eq(mpKfSessions.kfId, q.kfId));
  if (q.keyword) {
    const kw = `%${escapeLike(q.keyword)}%`;
    conditions.push(sql`(${mpKfSessions.openid} ilike ${kw} or ${mpFans.nickname} ilike ${kw})`);
  }
  const where = mergeWhere(and(...conditions));

  const order = q.status === 'waiting'
    ? [desc(mpKfSessions.priority), asc(mpKfSessions.waitingSince)]
    : [desc(mpKfSessions.lastMsgAt), desc(mpKfSessions.id)];

  const [total, rows] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(mpKfSessions)
      .leftJoin(mpFans, and(eq(mpFans.accountId, mpKfSessions.accountId), eq(mpFans.openid, mpKfSessions.openid)))
      .where(where)
      .then((r) => r[0]?.n ?? 0),
    withPagination(sessionSelection().where(where).orderBy(...order).$dynamic(), q.page, q.pageSize),
  ]);
  return { list: rows.map(mapSession), total, page: q.page, pageSize: q.pageSize };
}

async function ensureSession(id: number): Promise<MpKfSessionRow> {
  const [row] = await db.select().from(mpKfSessions).where(and(eq(mpKfSessions.id, id), tenantScope(mpKfSessions))).limit(1);
  if (!row) throw new HTTPException(404, { message: '会话不存在' });
  return row;
}

async function ensureKf(accountId: number, kfId: number) {
  const [row] = await db.select().from(mpKfAccounts).where(and(eq(mpKfAccounts.id, kfId), eq(mpKfAccounts.accountId, accountId))).limit(1);
  if (!row) throw new HTTPException(404, { message: '客服账号不存在' });
  if (row.status !== 'enabled') throw new HTTPException(400, { message: '该客服账号已禁用' });
  return row;
}

export async function getMpKfSessionDetail(id: number): Promise<MpKfSessionDetail> {
  const row = await ensureSession(id);
  const base = await loadMappedSession(id);
  if (!base) throw new HTTPException(404, { message: '会话不存在' });

  const fromKf = alias(mpKfAccounts, 'from_kf');
  const toKf = alias(mpKfAccounts, 'to_kf');
  const [eventRows, messageRows] = await Promise.all([
    db
      .select({
        e: mpKfSessionEvents,
        fromKfNickname: fromKf.nickname,
        toKfNickname: toKf.nickname,
        operatorName: users.nickname,
      })
      .from(mpKfSessionEvents)
      .leftJoin(fromKf, eq(fromKf.id, mpKfSessionEvents.fromKfId))
      .leftJoin(toKf, eq(toKf.id, mpKfSessionEvents.toKfId))
      .leftJoin(users, eq(users.id, mpKfSessionEvents.operatorId))
      .where(eq(mpKfSessionEvents.sessionId, id))
      .orderBy(asc(mpKfSessionEvents.id)),
    db
      .select()
      .from(mpMessages)
      .where(and(eq(mpMessages.accountId, row.accountId), eq(mpMessages.openid, row.openid)))
      .orderBy(desc(mpMessages.id))
      .limit(50),
  ]);

  const events: MpKfSessionEvent[] = eventRows.map((r) => ({
    id: r.e.id,
    sessionId: r.e.sessionId,
    accountId: r.e.accountId,
    type: r.e.type,
    fromKfId: r.e.fromKfId ?? null,
    toKfId: r.e.toKfId ?? null,
    fromKfNickname: r.fromKfNickname ?? null,
    toKfNickname: r.toKfNickname ?? null,
    operatorId: r.e.operatorId ?? null,
    operatorName: r.operatorName ?? null,
    detail: r.e.detail ?? null,
    createdAt: formatDateTime(r.e.createdAt),
  }));
  const messages = messageRows.reverse().map(mapMpMessage);

  return { ...base, events, messages };
}

export async function getMpKfSessionStats(accountId: number): Promise<MpKfSessionStats> {
  await ensureMpAccountExists(accountId);
  const tenant = tenantScope(mpKfSessions);
  const scoped = (extra: SQL) => (tenant ? and(extra, tenant) : extra);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [waiting, active, closedTodayRows, agentsRows] = await Promise.all([
    db.$count(mpKfSessions, scoped(and(eq(mpKfSessions.accountId, accountId), eq(mpKfSessions.status, 'waiting'))!)),
    db.$count(mpKfSessions, scoped(and(eq(mpKfSessions.accountId, accountId), eq(mpKfSessions.status, 'active'))!)),
    db
      .select({
        n: sql<number>`count(*)::int`,
        avgWait: sql<number>`coalesce(avg(extract(epoch from (${mpKfSessions.acceptedAt} - ${mpKfSessions.createdAt}))), 0)::float`,
      })
      .from(mpKfSessions)
      .where(scoped(and(eq(mpKfSessions.accountId, accountId), eq(mpKfSessions.status, 'closed'), gte(mpKfSessions.closedAt, todayStart))!)),
    db
      .select({
        kfId: mpKfAccounts.id,
        kfAccount: mpKfAccounts.kfAccount,
        nickname: mpKfAccounts.nickname,
        status: mpKfAccounts.status,
        activeCount: sql<number>`count(${mpKfSessions.id}) filter (where ${mpKfSessions.status} = 'active')`,
      })
      .from(mpKfAccounts)
      .leftJoin(mpKfSessions, eq(mpKfSessions.kfId, mpKfAccounts.id))
      .where(eq(mpKfAccounts.accountId, accountId))
      .groupBy(mpKfAccounts.id, mpKfAccounts.kfAccount, mpKfAccounts.nickname, mpKfAccounts.status),
  ]);

  return {
    waiting,
    active,
    closedToday: closedTodayRows[0]?.n ?? 0,
    avgWaitSeconds: Math.round(Number(closedTodayRows[0]?.avgWait ?? 0)),
    agents: agentsRows.map((a) => ({
      kfId: a.kfId,
      kfAccount: a.kfAccount,
      nickname: a.nickname,
      status: a.status,
      activeCount: Number(a.activeCount) || 0,
    })),
  };
}

// ─── 鉴权路由：接入 / 转接 / 结束 / 回复 ────────────────────────────────────────
export async function acceptMpKfSession(id: number, data: AcceptMpKfSessionInput): Promise<MpKfSession> {
  const session = await ensureSession(id);
  if (session.status !== 'waiting') throw new HTTPException(400, { message: '仅排队中的会话可接入' });
  await ensureKf(session.accountId, data.kfId);
  const cfg = (await getEnabledConfigRow(session.accountId)) ?? (await getOrCreateConfigRow(session.accountId));
  await assignKf({ session, toKfId: data.kfId, type: 'accept', operatorId: operatorId(), cfg, detail: '人工接入', sendWelcome: true });
  void notifySession('mp-kf:session-update', id);
  return (await loadMappedSession(id))!;
}

export async function transferMpKfSession(id: number, data: TransferMpKfSessionInput): Promise<MpKfSession> {
  const session = await ensureSession(id);
  if (session.status !== 'active') throw new HTTPException(400, { message: '仅进行中的会话可转接' });
  if (session.kfId === data.toKfId) throw new HTTPException(400, { message: '不能转接给当前客服' });
  await ensureKf(session.accountId, data.toKfId);
  const now = new Date();
  await db.update(mpKfSessions).set({ kfId: data.toKfId, lastMsgAt: now }).where(eq(mpKfSessions.id, id));
  await logEvent({
    sessionId: id, accountId: session.accountId, type: 'transfer',
    fromKfId: session.kfId, toKfId: data.toKfId, operatorId: operatorId(),
    detail: data.remark ? `转接：${data.remark}` : '人工转接', tenantId: session.tenantId,
  });
  void notifySession('mp-kf:session-update', id);
  return (await loadMappedSession(id))!;
}

export async function closeMpKfSession(id: number, data: CloseMpKfSessionInput): Promise<MpKfSession> {
  const session = await ensureSession(id);
  if (session.status === 'closed') throw new HTTPException(400, { message: '会话已结束' });
  await closeSessionRow(session, 'manual', data.remark ? `手动结束：${data.remark}` : '手动结束', operatorId());
  void notifySession('mp-kf:session-update', id);
  return (await loadMappedSession(id))!;
}

async function closeSessionRow(session: MpKfSessionRow, reason: MpKfSessionCloseReason, detail: string, opId: number | null): Promise<void> {
  const now = new Date();
  await db.update(mpKfSessions).set({ status: 'closed', closedAt: now, closeReason: reason, unreadCount: 0 }).where(eq(mpKfSessions.id, session.id));
  await logEvent({ sessionId: session.id, accountId: session.accountId, type: 'close', fromKfId: session.kfId, operatorId: opId, detail, tenantId: session.tenantId });
}

export async function replyMpKfSession(id: number, data: ReplyMpKfSessionInput): Promise<MpKfSession> {
  const session = await ensureSession(id);
  if (session.status !== 'active') throw new HTTPException(400, { message: '仅进行中的会话可回复' });
  const account = await getAccountRowById(session.accountId);
  if (!account) throw new HTTPException(404, { message: '公众号不存在' });

  try {
    await sendCustomServiceMessage(account, session.openid, { msgType: data.msgType, content: data.content, mediaId: data.mediaId });
  } catch (err) {
    if (err instanceof WechatApiError) throw new HTTPException(400, { message: err.message });
    throw new HTTPException(502, { message: '调用微信接口失败，请检查网络或稍后重试' });
  }

  const storedType: MpMessageType = data.msgType === 'news' ? 'text' : data.msgType;
  const storedContent = data.msgType === 'text' ? (data.content ?? '')
    : data.msgType === 'image' ? '[图片消息]'
      : data.msgType === 'voice' ? '[语音消息]'
        : data.msgType === 'video' ? (data.content ? `[视频] ${data.content}` : '[视频消息]')
          : '[图文消息]';
  const now = new Date();
  await Promise.all([
    db.insert(mpMessages).values({
      accountId: session.accountId, openid: session.openid, direction: 'out', msgType: storedType,
      content: storedContent, mediaId: data.msgType === 'text' ? null : (data.mediaId ?? null), status: 'sent', tenantId: session.tenantId,
    }),
    db.update(mpKfSessions).set({ lastKfMsgAt: now, lastMsgAt: now, unreadCount: 0 }).where(eq(mpKfSessions.id, id)),
  ]);
  notifyMessage({ sessionId: id, accountId: session.accountId, openid: session.openid, direction: 'out', msgType: storedType, content: storedContent, createdAt: formatDateTime(now) });
  void notifySession('mp-kf:session-update', id);
  return (await loadMappedSession(id))!;
}

// ─── 路由治理配置 ───────────────────────────────────────────────────────────────
async function getOrCreateConfigRow(accountId: number): Promise<MpKfRoutingConfigRow> {
  const [existing] = await db.select().from(mpKfRoutingConfigs).where(and(eq(mpKfRoutingConfigs.accountId, accountId), tenantScope(mpKfRoutingConfigs))).limit(1);
  if (existing) return existing;
  try {
    const [row] = await db.insert(mpKfRoutingConfigs).values({ accountId, tenantId: currentCreateTenantId() }).returning();
    return row;
  } catch {
    const [row] = await db.select().from(mpKfRoutingConfigs).where(eq(mpKfRoutingConfigs.accountId, accountId)).limit(1);
    return row;
  }
}

export async function getMpKfRoutingConfig(accountId: number): Promise<MpKfRoutingConfig> {
  await ensureMpAccountExists(accountId);
  return mapConfig(await getOrCreateConfigRow(accountId));
}

export async function updateMpKfRoutingConfig(accountId: number, data: UpdateMpKfRoutingConfigInput): Promise<MpKfRoutingConfig> {
  await ensureMpAccountExists(accountId);
  const current = await getOrCreateConfigRow(accountId);
  const [row] = await db
    .update(mpKfRoutingConfigs)
    .set({
      enabled: data.enabled ?? current.enabled,
      strategy: data.strategy ?? current.strategy,
      maxConcurrent: data.maxConcurrent ?? current.maxConcurrent,
      waitTimeoutMinutes: data.waitTimeoutMinutes ?? current.waitTimeoutMinutes,
      idleTimeoutMinutes: data.idleTimeoutMinutes ?? current.idleTimeoutMinutes,
      autoCloseEnabled: data.autoCloseEnabled ?? current.autoCloseEnabled,
      welcomeText: data.welcomeText === undefined ? current.welcomeText : data.welcomeText,
    })
    .where(eq(mpKfRoutingConfigs.id, current.id))
    .returning();
  return mapConfig(row);
}

// ─── 定时任务：超时自动路由 + 空闲自动结束 ─────────────────────────────────────
export async function runMpKfSessionTimeouts(): Promise<{ rerouted: number; idleClosed: number }> {
  const configs = await db.select().from(mpKfRoutingConfigs).where(eq(mpKfRoutingConfigs.enabled, true));
  const now = Date.now();
  let rerouted = 0;
  let idleClosed = 0;

  for (const cfg of configs) {
    // 1) 排队超时 → 重新路由（尝试再分配，并提升优先级）
    if (cfg.strategy !== 'manual') {
      const waitCutoff = new Date(now - cfg.waitTimeoutMinutes * 60_000);
      const stale = await db
        .select()
        .from(mpKfSessions)
        .where(and(eq(mpKfSessions.accountId, cfg.accountId), eq(mpKfSessions.status, 'waiting'), lt(mpKfSessions.waitingSince, waitCutoff)));
      for (const s of stale) {
        const kfId = await pickKf(cfg.accountId, cfg.strategy, cfg.maxConcurrent);
        if (kfId) {
          await assignKf({ session: s, toKfId: kfId, type: 'reroute', operatorId: null, cfg, detail: '排队超时自动路由', sendWelcome: false });
          rerouted += 1;
          void notifySession('mp-kf:session-update', s.id);
        } else {
          await db.update(mpKfSessions).set({ priority: sql`${mpKfSessions.priority} + 1` }).where(eq(mpKfSessions.id, s.id));
        }
      }
    }

    // 2) 会话空闲超时 → 自动结束
    if (cfg.autoCloseEnabled) {
      const idleCutoff = new Date(now - cfg.idleTimeoutMinutes * 60_000);
      const idle = await db
        .select()
        .from(mpKfSessions)
        .where(and(eq(mpKfSessions.accountId, cfg.accountId), eq(mpKfSessions.status, 'active'), lt(mpKfSessions.lastMsgAt, idleCutoff)));
      for (const s of idle) {
        await closeSessionRow(s, 'idle_timeout', `空闲超过 ${cfg.idleTimeoutMinutes} 分钟自动结束`, null);
        idleClosed += 1;
        void notifySession('mp-kf:session-update', s.id);
      }
    }
  }
  return { rerouted, idleClosed };
}
