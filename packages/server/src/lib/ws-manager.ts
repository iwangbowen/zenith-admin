import type { WSContext } from 'hono/ws';
import type { ChatPresence } from '@zenith/shared/chat';
import type { WsMessage } from '@zenith/shared/platform';
import { formatDateTime } from './datetime';
import { onWsFanout, publishWsFanout } from './ws-fanout';

// ─── 连接登记 ──────────────────────────────────────────────────────────
// 每个 socket 独立登记：同一 access token 在多个标签页各开一条连接、断网后新旧连接短暂并存时互不覆盖。
// 连接表只覆盖本进程；跨进程（多 api 副本、worker 产生的推送）经 ws-fanout 信封到达持有连接的进程，
// 因此下方每个公开的发送 / 关闭函数都是「本地投递 + 发布信封」，信封处理器只做本地那一半。
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

// ─── 本地投递（本进程持有的 socket）─────────────────────────────────────
function deliverToToken(tokenId: string, message: WsMessage) {
  sendToSockets(tokenSockets.get(tokenId), message);
}

function deliverToUser(userId: number, message: WsMessage) {
  sendToSockets(userSockets.get(userId), message);
}

function deliverBroadcast(message: WsMessage) {
  if (connections.size === 0) return;
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

onWsFanout('user', (e) => deliverToUser(e.target, e.message));
onWsFanout('users', (e) => { for (const userId of e.targets) deliverToUser(userId, e.message); });
onWsFanout('token', (e) => deliverToToken(e.target, e.message));
onWsFanout('broadcast', (e) => deliverBroadcast(e.message));
onWsFanout('closeToken', (e) => closeSockets(tokenSockets.get(e.target), e.reason));
onWsFanout('closeUser', (e) => closeSockets(userSockets.get(e.target), e.reason));

// ─── 公开发送 / 关闭（本地 + 跨进程）────────────────────────────────────
/** Send a message to every socket of the login session identified by tokenId */
export function sendToToken(tokenId: string, message: WsMessage) {
  deliverToToken(tokenId, message);
  publishWsFanout({ kind: 'token', target: tokenId, message });
}

/** Send a message to all connections of a specific user */
export function sendToUser(userId: number, message: WsMessage) {
  deliverToUser(userId, message);
  publishWsFanout({ kind: 'user', target: userId, message });
}

/** Broadcast a message to all connected sockets */
export function broadcast(message: WsMessage) {
  deliverBroadcast(message);
  publishWsFanout({ kind: 'broadcast', message });
}

/** Close every socket of the login session identified by tokenId */
export function closeTokenConnection(tokenId: string, reason?: string) {
  const why = reason ?? 'force-logout';
  closeSockets(tokenSockets.get(tokenId), why);
  publishWsFanout({ kind: 'closeToken', target: tokenId, reason: why });
}

/** Close all WebSocket connections for a specific user (e.g. account disabled) */
export function closeUserConnections(userId: number, reason?: string) {
  const why = reason ?? 'force-logout';
  closeSockets(userSockets.get(userId), why);
  publishWsFanout({ kind: 'closeUser', target: userId, reason: why });
}

/**
 * Defer WebSocket notifications to a list of users to the next I/O tick,
 * allowing the current HTTP response to flush before WS sends begin.
 * 跨进程只发一封批量信封，而不是每个成员一封。
 */
export function scheduleSendToUsers(members: { userId: number }[], message: WsMessage): void {
  if (members.length === 0) return;
  setImmediate(() => {
    const targets = [...new Set(members.map((m) => m.userId))];
    for (const userId of targets) deliverToUser(userId, message);
    publishWsFanout({ kind: 'users', targets, message });
  });
}

/** 全量广播的延后版本：先让当前 HTTP 响应落盘，下一个 I/O tick 再推送 */
export function scheduleBroadcast(message: WsMessage): void {
  setImmediate(() => broadcast(message));
}

// ─── 在线状态（presence）─────────────────────────────────────────────────
// 在线 = 在**任一**进程上有活跃连接。本进程只知道自己的连接表，其他进程的持有情况经 fan-out 以
// 「本地增量 + 周期全量快照」同步过来，按发送方节点归档成镜像；镜像超过 TTL 未刷新（进程崩溃 / 网络分区）
// 即视为该节点全部离线。对外的 isUserOnline / getUserPresence 返回合并视图，调用方不感知多进程。

/** presence 变更合并窗口（ms）：窗口内的上下线折叠为一条批量广播，重连风暴下从 O(N²) 条消息降为 O(N) */
const PRESENCE_FLUSH_DELAY_MS = 1_000;
/** 远端节点快照的有效期：超过即认为该节点已消失（快照周期的 3 倍，容忍两次丢包） */
const REMOTE_PRESENCE_TTL_MS = 90_000;
const PRESENCE_SNAPSHOT_INTERVAL_MS = 30_000;
const pendingPresenceUserIds = new Set<number>();
let presenceFlushTimer: ReturnType<typeof setTimeout> | null = null;
let presenceSnapshotTimer: ReturnType<typeof setInterval> | null = null;

interface RemoteNodePresence {
  online: Set<number>;
  lastSeen: Map<number, number>;
  updatedAt: number;
}
const remoteNodes = new Map<string, RemoteNodePresence>();

function liveRemoteNodes(): RemoteNodePresence[] {
  const cutoff = Date.now() - REMOTE_PRESENCE_TTL_MS;
  return [...remoteNodes.values()].filter((node) => node.updatedAt >= cutoff);
}

function remoteNode(nodeId: string): RemoteNodePresence {
  let node = remoteNodes.get(nodeId);
  if (!node) {
    node = { online: new Set(), lastSeen: new Map(), updatedAt: 0 };
    remoteNodes.set(nodeId, node);
  }
  node.updatedAt = Date.now();
  return node;
}

/** 用户是否在线（本进程或任一存活的远端进程上至少有一个活跃连接） */
export function isUserOnline(userId: number): boolean {
  if (userSockets.has(userId)) return true;
  return liveRemoteNodes().some((node) => node.online.has(userId));
}

/** 当前所有在线用户 ID（集群合并视图） */
export function getOnlineUserIds(): number[] {
  const ids = new Set(userSockets.keys());
  for (const node of liveRemoteNodes()) for (const id of node.online) ids.add(id);
  return [...ids];
}

/** 用户最近在线时间（ms 时间戳，取各进程中最近的一次）；在线或无记录时返回 null */
export function getUserLastSeen(userId: number): number | null {
  if (isUserOnline(userId)) return null;
  let latest = userLastSeen.get(userId) ?? null;
  for (const node of liveRemoteNodes()) {
    const seen = node.lastSeen.get(userId);
    if (seen !== undefined && (latest === null || seen > latest)) latest = seen;
  }
  return latest;
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
  const userIds = [...pendingPresenceUserIds];
  pendingPresenceUserIds.clear();
  // 本地客户端收合并视图；其他进程收的是本进程的**本地**增量（它们各自合并后再推给自己的客户端）
  deliverBroadcast({ type: 'chat:presence', payload: userIds.map(getUserPresence) });
  publishWsFanout({
    kind: 'presence',
    changes: userIds.map((userId) => ({
      userId,
      online: userSockets.has(userId),
      lastSeen: userSockets.has(userId) ? null : (userLastSeen.get(userId) ?? null),
    })),
  });
}

/** 收到远端节点的本地增量：更新该节点镜像，再把本进程的合并视图推给本地客户端 */
onWsFanout('presence', (e) => {
  const node = remoteNode(e.from);
  for (const change of e.changes) {
    if (change.online) {
      node.online.add(change.userId);
      node.lastSeen.delete(change.userId);
    } else {
      node.online.delete(change.userId);
      if (change.lastSeen !== null) node.lastSeen.set(change.userId, change.lastSeen);
    }
  }
  deliverBroadcast({ type: 'chat:presence', payload: e.changes.map((change) => getUserPresence(change.userId)) });
});

/** 收到远端节点的全量快照：整体替换镜像；快照与旧镜像的差集用户推合并视图给本地客户端 */
onWsFanout('presenceSnapshot', (e) => {
  const previous = remoteNodes.get(e.from);
  const node = remoteNode(e.from);
  const nextOnline = new Set(e.online);
  const changed = new Set<number>();
  for (const id of nextOnline) if (!previous?.online.has(id)) changed.add(id);
  if (previous) for (const id of previous.online) if (!nextOnline.has(id)) changed.add(id);
  node.online = nextOnline;
  node.lastSeen = new Map(e.lastSeen);
  if (changed.size > 0) {
    deliverBroadcast({ type: 'chat:presence', payload: [...changed].map(getUserPresence) });
  }
});

function publishPresenceSnapshot(): void {
  publishWsFanout({
    kind: 'presenceSnapshot',
    online: [...userSockets.keys()],
    lastSeen: [...userLastSeen.entries()],
  });
}

/** 淘汰长期未刷新的远端镜像：该进程上的用户此刻已不可达，其最后心跳时刻并入本地 lastSeen 供展示 */
function pruneRemotePresence(): void {
  const cutoff = Date.now() - REMOTE_PRESENCE_TTL_MS;
  for (const [nodeId, node] of remoteNodes) {
    if (node.updatedAt >= cutoff) continue;
    remoteNodes.delete(nodeId);
    const absorb = (userId: number, seenAt: number) => {
      if (userSockets.has(userId)) return;
      userLastSeen.set(userId, Math.max(userLastSeen.get(userId) ?? 0, seenAt));
    };
    for (const [userId, seenAt] of node.lastSeen) absorb(userId, seenAt);
    for (const userId of node.online) absorb(userId, node.updatedAt);
    if (node.online.size > 0) {
      deliverBroadcast({ type: 'chat:presence', payload: [...node.online].map(getUserPresence) });
    }
  }
}

/**
 * 启动 presence 同步：立即发一次快照（重启后其他进程立刻拿到本进程的持有情况），
 * 之后周期发送并淘汰失联节点的镜像。持有 WS 连接的进程（api 角色）调用。
 */
export function startPresenceSync(): void {
  if (presenceSnapshotTimer) return;
  publishPresenceSnapshot();
  presenceSnapshotTimer = setInterval(() => {
    pruneRemotePresence();
    publishPresenceSnapshot();
  }, PRESENCE_SNAPSHOT_INTERVAL_MS);
  presenceSnapshotTimer.unref?.();
}

export function stopPresenceSync(): void {
  if (!presenceSnapshotTimer) return;
  clearInterval(presenceSnapshotTimer);
  presenceSnapshotTimer = null;
  // 本进程即将退出：主动宣告自己持有的用户已离线，其他进程不必等 TTL 过期
  const now = Date.now();
  publishWsFanout({
    kind: 'presence',
    changes: [...userSockets.keys()].map((userId) => ({ userId, online: false, lastSeen: now })),
  });
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
