import type { WSContext } from 'hono/ws';
import type { ChatPresence } from '@zenith/shared/chat';
import type { WsMessage } from '@zenith/shared/platform';
import { formatDateTime } from './datetime';

// ─── 连接登记 ──────────────────────────────────────────────────────────
// 每个 socket 独立登记：同一 access token 在多个标签页各开一条连接、断网后新旧连接短暂并存时互不覆盖。
interface ConnMeta {
  connId: string;
  tokenId: string;
  userId: number;
  connectedAt: number;
  lastActivityAt: number;
  sent: number;
  recv: number;
}
const connections = new Map<WSContext, ConnMeta>();
// tokenId（jti）→ 该登录会话的全部 socket：按会话精确推送 / 强制下线
const tokenSockets = new Map<string, Set<WSContext>>();
// userId → 该用户全部 socket（跨会话、跨标签页）
const userSockets = new Map<number, Set<WSContext>>();
// userId → 最近在线时间戳（ms），仅在用户全部连接断开后记录
const userLastSeen = new Map<number, number>();
let connSeq = 0;

// ─── 监控指标 ──────────────────────────────────────────────────────────
const counters = { totalConnects: 0, totalDisconnects: 0, totalSent: 0, totalRecv: 0 };

export interface RecentDisconnect {
  connId: string;
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

function trySend(ws: WSContext, data: string) {
  try {
    ws.send(data);
    counters.totalSent += 1;
    const m = connections.get(ws);
    if (m) {
      m.sent += 1;
      m.lastActivityAt = Date.now();
    }
  } catch { /* connection may be stale */ }
}

/** 加入索引，返回该 key 此前是否没有任何 socket */
function addToIndex<K>(index: Map<K, Set<WSContext>>, key: K, ws: WSContext): boolean {
  let set = index.get(key);
  if (!set) {
    set = new Set();
    index.set(key, set);
  }
  const wasEmpty = set.size === 0;
  set.add(ws);
  return wasEmpty;
}

/** 从索引移除，返回该 key 是否因此不再有任何 socket */
function removeFromIndex<K>(index: Map<K, Set<WSContext>>, key: K, ws: WSContext): boolean {
  const set = index.get(key);
  if (!set || !set.delete(ws)) return false;
  if (set.size > 0) return false;
  index.delete(key);
  return true;
}

export function registerConnection(userId: number, tokenId: string, ws: WSContext) {
  if (connections.has(ws)) return;
  const now = Date.now();
  connSeq += 1;
  connections.set(ws, { connId: String(connSeq), tokenId, userId, connectedAt: now, lastActivityAt: now, sent: 0, recv: 0 });
  addToIndex(tokenSockets, tokenId, ws);
  const wentOnline = addToIndex(userSockets, userId, ws);
  counters.totalConnects += 1;
  if (wentOnline) {
    userLastSeen.delete(userId);
    queuePresenceChange(userId);
  }
}

/** 移除一条 socket 的登记；未登记 / 已移除的 socket 为空操作（closeTokenConnection 之后 socket 自身的 close 事件） */
export function removeConnection(ws: WSContext, reason = 'close') {
  const meta = connections.get(ws);
  if (!meta) return;
  connections.delete(ws);
  removeFromIndex(tokenSockets, meta.tokenId, ws);
  const wentOffline = removeFromIndex(userSockets, meta.userId, ws);
  counters.totalDisconnects += 1;
  const now = Date.now();
  recentDisconnects.unshift({
    connId: meta.connId,
    tokenId: meta.tokenId,
    userId: meta.userId,
    at: now,
    reason,
    duration: now - meta.connectedAt,
    sent: meta.sent,
    recv: meta.recv,
  });
  if (recentDisconnects.length > RECENT_DISCONNECT_MAX) {
    recentDisconnects.length = RECENT_DISCONNECT_MAX;
  }
  if (wentOffline) {
    userLastSeen.set(meta.userId, now);
    queuePresenceChange(meta.userId);
  }
}

/** Increment recv counter for a socket (called from WS onMessage). */
export function incWsRecv(ws: WSContext) {
  counters.totalRecv += 1;
  const m = connections.get(ws);
  if (m) {
    m.recv += 1;
    m.lastActivityAt = Date.now();
  }
}

function sendToSockets(sockets: Iterable<WSContext> | undefined, message: WsMessage) {
  if (!sockets) return;
  const data = JSON.stringify(message);
  for (const ws of sockets) trySend(ws, data);
}

/** Send a message to every socket of the login session identified by tokenId */
export function sendToToken(tokenId: string, message: WsMessage) {
  sendToSockets(tokenSockets.get(tokenId), message);
}

/** Send a message to all connections of a specific user */
export function sendToUser(userId: number, message: WsMessage) {
  sendToSockets(userSockets.get(userId), message);
}

/** Broadcast a message to all connected sockets */
export function broadcast(message: WsMessage) {
  sendToSockets(connections.keys(), message);
}

function closeSockets(sockets: Set<WSContext> | undefined, reason: string) {
  if (!sockets) return;
  for (const ws of [...sockets]) {
    try {
      ws.close(1000, reason);
    } catch { /* ignore */ }
    removeConnection(ws, reason);
  }
}

/** Close every socket of the login session identified by tokenId */
export function closeTokenConnection(tokenId: string, reason?: string) {
  closeSockets(tokenSockets.get(tokenId), reason ?? 'force-logout');
}

/** Close all WebSocket connections for a specific user (e.g. account disabled) */
export function closeUserConnections(userId: number, reason?: string) {
  closeSockets(userSockets.get(userId), reason ?? 'force-logout');
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
  return userSockets.has(userId);
}

/** 当前所有在线用户 ID */
export function getOnlineUserIds(): number[] {
  return [...userSockets.keys()];
}

/** 用户最近在线时间（ms 时间戳）；在线或无记录时返回 null */
export function getUserLastSeen(userId: number): number | null {
  if (userSockets.has(userId)) return null;
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
  if (connections.size === 0) return;
  broadcast({ type: 'chat:presence', payload: changes });
}

// ─── 监控查询 ──────────────────────────────────────────────────────────
export interface WsConnectionSnapshot {
  connId: string;
  tokenId: string;
  userId: number;
  connectedAt: number;
  lastActivityAt: number;
  sent: number;
  recv: number;
}

export function getWsSnapshot() {
  const snapshot: WsConnectionSnapshot[] = [];
  for (const m of connections.values()) {
    snapshot.push({
      connId: m.connId,
      tokenId: m.tokenId,
      userId: m.userId,
      connectedAt: m.connectedAt,
      lastActivityAt: m.lastActivityAt,
      sent: m.sent,
      recv: m.recv,
    });
  }
  return {
    currentConnections: connections.size,
    currentUsers: userSockets.size,
    totalConnects: counters.totalConnects,
    totalDisconnects: counters.totalDisconnects,
    totalSent: counters.totalSent,
    totalRecv: counters.totalRecv,
    connections: snapshot,
    recentDisconnects: [...recentDisconnects],
  };
}
