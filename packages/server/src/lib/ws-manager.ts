import type { WSContext } from 'hono/ws';
import type { ChatPresence } from '@zenith/shared/chat';
import type { WsMessage } from '@zenith/shared/platform';
import { formatDateTime } from './datetime';

// tokenId → WSContext (precise single-session targeting)
const tokenConnections = new Map<string, WSContext>();
// userId → Set<tokenId> (for broadcast to all sessions of a user)
const userTokens = new Map<number, Set<string>>();
// userId → 最近在线时间戳（ms），仅在用户全部连接断开后记录
const userLastSeen = new Map<number, number>();

// ─── 监控指标 ──────────────────────────────────────────────────────────
interface ConnMeta {
  userId: number;
  connectedAt: number;
  lastActivityAt: number;
  sent: number;
  recv: number;
}
const connMeta = new Map<string, ConnMeta>();
const counters = { totalConnects: 0, totalDisconnects: 0, totalSent: 0, totalRecv: 0 };

export interface RecentDisconnect {
  tokenId: string;
  userId: number;
  at: number;
  reason: string;
  duration: number;
  sent: number;
  recv: number;
}
const recentDisconnects: RecentDisconnect[] = [];
const RECENT_DISCONNECT_MAX = 50;

function trySend(ws: WSContext, data: string, tokenId: string) {
  try {
    ws.send(data);
    counters.totalSent += 1;
    const m = connMeta.get(tokenId);
    if (m) {
      m.sent += 1;
      m.lastActivityAt = Date.now();
    }
  } catch { /* connection may be stale */ }
}

function recordDisconnect(tokenId: string, userId: number, reason: string) {
  const meta = connMeta.get(tokenId);
  if (!meta) return;
  counters.totalDisconnects += 1;
  const now = Date.now();
  recentDisconnects.unshift({
    tokenId,
    userId,
    at: now,
    reason,
    duration: now - meta.connectedAt,
    sent: meta.sent,
    recv: meta.recv,
  });
  if (recentDisconnects.length > RECENT_DISCONNECT_MAX) {
    recentDisconnects.length = RECENT_DISCONNECT_MAX;
  }
  connMeta.delete(tokenId);
}

export function registerConnection(userId: number, tokenId: string, ws: WSContext) {
  // 同一 access token 再次登记（断网后重连 / 多标签页）：旧 socket 让位并按断开计入统计
  const previous = tokenConnections.get(tokenId);
  if (previous && previous !== ws) recordDisconnect(tokenId, userId, 'replaced');
  tokenConnections.set(tokenId, ws);
  let set = userTokens.get(userId);
  const wentOnline = !set || set.size === 0;
  if (!set) {
    set = new Set();
    userTokens.set(userId, set);
  }
  set.add(tokenId);
  const now = Date.now();
  connMeta.set(tokenId, { userId, connectedAt: now, lastActivityAt: now, sent: 0, recv: 0 });
  counters.totalConnects += 1;
  if (wentOnline) {
    userLastSeen.delete(userId);
    queuePresenceChange(userId);
  }
}

/** 该 token 是否已由另一个 socket 接管（同一 access token 断网重连 / 多标签页时旧连接为 true） */
export function isSupersededConnection(tokenId: string, ws: WSContext): boolean {
  const current = tokenConnections.get(tokenId);
  return current !== undefined && current !== ws;
}

/**
 * 移除连接。传入 ws 时若该 token 已被新 socket 接管则直接忽略：
 * 旧 socket 迟到的 close 不得把活连接删掉、也不得把用户标为离线
 */
export function removeConnection(userId: number, tokenId: string, reason = 'close', ws?: WSContext) {
  if (ws && isSupersededConnection(tokenId, ws)) return;
  tokenConnections.delete(tokenId);
  const set = userTokens.get(userId);
  let wentOffline = false;
  if (set) {
    set.delete(tokenId);
    if (set.size === 0) {
      userTokens.delete(userId);
      wentOffline = true;
    }
  }
  recordDisconnect(tokenId, userId, reason);
  if (wentOffline) {
    userLastSeen.set(userId, Date.now());
    queuePresenceChange(userId);
  }
}

/** Increment recv counter for a token (called from WS onMessage). */
export function incWsRecv(tokenId: string) {
  counters.totalRecv += 1;
  const m = connMeta.get(tokenId);
  if (m) {
    m.recv += 1;
    m.lastActivityAt = Date.now();
  }
}

/** Send a message to the specific session identified by tokenId */
export function sendToToken(tokenId: string, message: WsMessage) {
  const ws = tokenConnections.get(tokenId);
  if (!ws) return;
  trySend(ws, JSON.stringify(message), tokenId);
}

/** Send a message to all connections of a specific user */
export function sendToUser(userId: number, message: WsMessage) {
  const set = userTokens.get(userId);
  if (!set) return;
  const data = JSON.stringify(message);
  for (const tokenId of set) {
    const ws = tokenConnections.get(tokenId);
    if (!ws) continue;
    trySend(ws, data, tokenId);
  }
}

/** Broadcast a message to all connected users */
export function broadcast(message: WsMessage) {
  const data = JSON.stringify(message);
  for (const [tokenId, ws] of tokenConnections) {
    trySend(ws, data, tokenId);
  }
}

/** Close the specific session's WebSocket connection */
export function closeTokenConnection(tokenId: string, reason?: string) {
  const ws = tokenConnections.get(tokenId);
  if (!ws) return;
  try {
    ws.close(1000, reason ?? 'force-logout');
  } catch { /* ignore */ }
  const meta = connMeta.get(tokenId);
  if (meta) {
    removeConnection(meta.userId, tokenId, reason ?? 'force-logout', ws);
  } else {
    tokenConnections.delete(tokenId);
  }
}

/** Close all WebSocket connections for a specific user (e.g. account disabled) */
export function closeUserConnections(userId: number, reason?: string) {
  const set = userTokens.get(userId);
  if (!set) return;
  const tokenIds = [...set];
  for (const tokenId of tokenIds) {
    const ws = tokenConnections.get(tokenId);
    if (!ws) continue;
    try {
      ws.close(1000, reason ?? 'force-logout');
    } catch { /* ignore */ }
    removeConnection(userId, tokenId, reason ?? 'force-logout', ws);
  }
}

/**
 * Defer WebSocket notifications to a list of users to the next I/O tick,
 * allowing the current HTTP response to flush before WS sends begin.
 */
export function scheduleSendToUsers(members: { userId: number }[], message: WsMessage): void {
  if (members.length === 0) return;
  setImmediate(() => {
    for (const { userId } of members) {
      sendToUser(userId, message);
    }
  });
}

/** 全量广播的延后版本：先让当前 HTTP 响应落盘，下一个 I/O tick 再推送 */
export function scheduleBroadcast(message: WsMessage): void {
  setImmediate(() => broadcast(message));
}

// ─── 在线状态（presence）─────────────────────────────────────────────────
/** presence 变更合并窗口（ms）：窗口内的上下线折叠为一条批量广播，重连风暴下从 O(N²) 条消息降为 O(N) */
const PRESENCE_FLUSH_DELAY_MS = 1_000;
const pendingPresenceUserIds = new Set<number>();
let presenceFlushTimer: ReturnType<typeof setTimeout> | null = null;

/** 用户是否在线（至少有一个活跃连接） */
export function isUserOnline(userId: number): boolean {
  return userTokens.has(userId);
}

/** 当前所有在线用户 ID */
export function getOnlineUserIds(): number[] {
  return [...userTokens.keys()];
}

/** 用户最近在线时间（ms 时间戳）；在线或无记录时返回 null */
export function getUserLastSeen(userId: number): number | null {
  if (userTokens.has(userId)) return null;
  return userLastSeen.get(userId) ?? null;
}

/** 单个用户的在线状态快照（WS 推送与 GET /api/chat/presence 同一口径） */
export function getUserPresence(userId: number): ChatPresence {
  const lastSeenMs = getUserLastSeen(userId);
  return {
    userId,
    online: isUserOnline(userId),
    lastSeen: lastSeenMs === null ? null : formatDateTime(new Date(lastSeenMs)),
  };
}

/** 上下线变更进入合并窗口；到期按 flush 时刻的真实连接状态一次性广播 */
function queuePresenceChange(userId: number): void {
  pendingPresenceUserIds.add(userId);
  if (presenceFlushTimer) return;
  presenceFlushTimer = setTimeout(flushPresenceChanges, PRESENCE_FLUSH_DELAY_MS);
}

function flushPresenceChanges(): void {
  presenceFlushTimer = null;
  if (pendingPresenceUserIds.size === 0) return;
  const changes = [...pendingPresenceUserIds].map(getUserPresence);
  pendingPresenceUserIds.clear();
  if (tokenConnections.size === 0) return;
  broadcast({ type: 'chat:presence', payload: changes });
}

// ─── 监控查询 ──────────────────────────────────────────────────────────
export interface WsConnectionSnapshot {
  tokenId: string;
  userId: number;
  connectedAt: number;
  lastActivityAt: number;
  sent: number;
  recv: number;
}

export function getWsSnapshot() {
  const connections: WsConnectionSnapshot[] = [];
  for (const [tokenId, m] of connMeta) {
    connections.push({
      tokenId,
      userId: m.userId,
      connectedAt: m.connectedAt,
      lastActivityAt: m.lastActivityAt,
      sent: m.sent,
      recv: m.recv,
    });
  }
  return {
    currentConnections: tokenConnections.size,
    currentUsers: userTokens.size,
    totalConnects: counters.totalConnects,
    totalDisconnects: counters.totalDisconnects,
    totalSent: counters.totalSent,
    totalRecv: counters.totalRecv,
    connections,
    recentDisconnects: [...recentDisconnects],
  };
}
