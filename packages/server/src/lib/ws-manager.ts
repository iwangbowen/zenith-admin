import type { WSContext } from 'hono/ws';
import type { ChatPresence } from '@zenith/shared/chat';
import { isWsControlMessage, type WsMessage } from '@zenith/shared/platform';
import { formatDateTime } from './datetime';
import { PROCESS_ID } from './process-identity';
import { onWsFanout, publishWsFanout } from './ws-fanout';

// ─── 连接登记 ──────────────────────────────────────────────────────────
// 每个 socket 独立登记：同一 access token 在多个标签页各开一条连接、断网后新旧连接短暂并存时互不覆盖。
// 连接表只覆盖本进程；跨进程（多 api 副本、worker 产生的推送）经 ws-fanout 信封到达持有连接的进程，
// 因此下方每个公开的发送 / 关闭函数都是「本地投递 + 发布信封」，信封处理器只做本地那一半。
interface ConnMeta {
  connId: string;
  nodeId: string;
  tokenId: string;
  userId: number;
  /** 握手期采集：客户端 IP（经可信代理链判定） */
  ip: string | null;
  /** 握手期采集：User-Agent 原文（截断 512 字符），展示侧派生浏览器 / 系统 / 端形态 */
  userAgent: string | null;
  /** 最近一条消息画像：随每次收发更新，断开后不保留 */
  lastMessageType: string | null;
  lastMessageAt: number | null;
  lastDirection: 'inbound' | 'outbound' | null;
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
// 节点标识与 fan-out `from` 同源（hostname:pid），跨进程镜像按发送方归档时口径一致
const nodeId = PROCESS_ID;
let messageSeq = 0;
const recentMessages: WsMonitorMessage[] = [];
const RECENT_MESSAGE_MAX = 200;

export interface WsMonitorMessage {
  id: string;
  at: number;
  direction: 'inbound' | 'outbound';
  nodeId: string;
  connId: string | null;
  userId: number | null;
  type: string;
  topic: string | null;
  bytes: number;
  success: boolean;
}

function messageTopic(type: string): string | null {
  const separator = type.indexOf(':');
  return separator > 0 ? type.slice(0, separator) : type || null;
}

function recordWsMessage(
  meta: ConnMeta | undefined,
  direction: WsMonitorMessage['direction'],
  type: string,
  bytes: number,
  success: boolean,
): void {
  messageSeq += 1;
  const now = Date.now();
  recentMessages.unshift({
    id: `${now}-${messageSeq}`,
    at: now,
    direction,
    nodeId: meta?.nodeId ?? nodeId,
    connId: meta?.connId ?? null,
    userId: meta?.userId ?? null,
    type,
    topic: messageTopic(type),
    bytes,
    success,
  });
  if (meta) {
    meta.lastMessageType = type;
    meta.lastMessageAt = now;
    meta.lastDirection = direction;
  }
  if (recentMessages.length > RECENT_MESSAGE_MAX) recentMessages.length = RECENT_MESSAGE_MAX;
}

function messageTypeFromWire(data: unknown): string {
  try {
    const raw = typeof data === 'string' ? data : Buffer.from(data as ArrayBuffer).toString('utf8');
    const parsed = JSON.parse(raw) as { type?: unknown };
    return typeof parsed.type === 'string' ? parsed.type : 'unknown';
  } catch {
    return 'invalid';
  }
}

function messageBytes(data: unknown): number {
  if (typeof data === 'string') return Buffer.byteLength(data, 'utf8');
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return 0;
}

export interface RecentDisconnect {
  connId: string;
  nodeId: string;
  tokenId: string;
  userId: number;
  ip: string | null;
  userAgent: string | null;
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

export interface WsConnectionMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export function registerConnection(userId: number, tokenId: string, ws: WSContext, meta?: WsConnectionMeta) {
  if (connections.has(ws)) return;
  const now = Date.now();
  connSeq += 1;
  connections.set(ws, {
    connId: String(connSeq),
    nodeId,
    tokenId,
    userId,
    ip: meta?.ip ?? null,
    userAgent: meta?.userAgent ? meta.userAgent.slice(0, 512) : null,
    lastMessageType: null,
    lastMessageAt: null,
    lastDirection: null,
    connectedAt: now,
    lastActivityAt: now,
    sent: 0,
    recv: 0,
  });
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
    nodeId: meta.nodeId,
    tokenId: meta.tokenId,
    userId: meta.userId,
    ip: meta.ip,
    userAgent: meta.userAgent,
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
export function incWsRecv(ws: WSContext, data?: unknown) {
  counters.totalRecv += 1;
  const m = connections.get(ws);
  if (m) {
    m.recv += 1;
    m.lastActivityAt = Date.now();
  }
  recordWsMessage(m, 'inbound', messageTypeFromWire(data), messageBytes(data), Boolean(m));
}

export function sendWsControl(ws: WSContext, message: { type: string }): void {
  const data = JSON.stringify(message);
  const meta = connections.get(ws);
  recordWsMessage(meta, 'outbound', message.type, Buffer.byteLength(data, 'utf8'), Boolean(meta));
  trySend(ws, data);
}

function sendToSockets(sockets: Iterable<WSContext> | undefined, message: WsMessage) {
  if (!sockets) return;
  const data = JSON.stringify(message);
  for (const ws of sockets) {
    const meta = connections.get(ws);
    recordWsMessage(meta, 'outbound', message.type, Buffer.byteLength(data, 'utf8'), Boolean(meta));
    trySend(ws, data);
  }
}

// ─── 本地投递（本进程持有的 socket）─────────────────────────────────────
function deliverToToken(tokenId: string, message: WsMessage) {
  sendToSockets(tokenSockets.get(tokenId), message);
}

function deliverToUser(userId: number, message: WsMessage) {
  sendToSockets(userSockets.get(userId), message);
}

const broadcastListeners = new Set<(message: WsMessage) => void>();

/** 在向浏览器投递前应用本进程副作用；本地广播与跨进程广播走同一路径。 */
export function onBroadcastMessage(listener: (message: WsMessage) => void): () => void {
  broadcastListeners.add(listener);
  return () => { broadcastListeners.delete(listener); };
}

function deliverBroadcast(message: WsMessage) {
  for (const listener of broadcastListeners) listener(message);
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

// ─── 跨进程监控快照镜像 ────────────────────────────────────────────────
// presence 合并的是在线状态；监控页要看的是连接明细与计数，因此各节点周期
// 发布本地快照（wsStats 信封），本进程按发送方归档成镜像后合并展示。
// 镜像超过 TTL 未刷新（进程崩溃 / 网络分区）即丢弃，回退为本进程视图。
interface RemoteWsNodeStats {
  stats: WsNodeStats;
  updatedAt: number;
}
const remoteWsNodes = new Map<string, RemoteWsNodeStats>();

function liveRemoteWsNodes(): RemoteWsNodeStats[] {
  const cutoff = Date.now() - REMOTE_PRESENCE_TTL_MS;
  return [...remoteWsNodes.values()].filter((node) => node.updatedAt >= cutoff);
}

onWsFanout('user', (e) => deliverToUser(e.target, e.message));
onWsFanout('users', (e) => { for (const userId of e.targets) deliverToUser(userId, e.message); });
onWsFanout('perUser', (e) => { for (const entry of e.entries) deliverToUser(entry.target, entry.message); });
onWsFanout('token', (e) => deliverToToken(e.target, e.message));
onWsFanout('broadcast', (e) => deliverBroadcast(e.message));
onWsFanout('closeToken', (e) => closeSockets(tokenSockets.get(e.target), e.reason));
onWsFanout('closeUser', (e) => closeSockets(userSockets.get(e.target), e.reason));
onWsFanout('wsStats', (e) => {
  remoteWsNodes.set(e.from, { stats: e.stats, updatedAt: Date.now() });
});

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

/**
 * 一批推送、每个收件人一份专属载荷（站内信群发：每人的消息 id / 未读数不同）。
 * 与 scheduleSendToUsers 同样延后到下一个 I/O tick，跨进程只发一封信封而不是每人一封。
 */
export function scheduleSendPerUser(entries: Array<{ userId: number; message: WsMessage }>): void {
  if (entries.length === 0) return;
  setImmediate(() => {
    const wire = entries.map((e) => ({ target: e.userId, message: e.message }));
    for (const entry of wire) deliverToUser(entry.target, entry.message);
    publishWsFanout({ kind: 'perUser', entries: wire });
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
  // WS 监控镜像同 TTL 淘汰：失联节点的连接明细不再计入集群视图
  for (const [nodeId, entry] of remoteWsNodes) {
    if (entry.updatedAt >= cutoff) continue;
    remoteWsNodes.delete(nodeId);
  }
}

/**
 * 启动 presence 同步：立即发一次快照（重启后其他进程立刻拿到本进程的持有情况），
 * 之后周期发送并淘汰失联节点的镜像。持有 WS 连接的进程（api 角色）调用。
 */
export function startPresenceSync(): void {
  if (presenceSnapshotTimer) return;
  publishPresenceSnapshot();
  publishWsStatsSnapshot();
  presenceSnapshotTimer = setInterval(() => {
    pruneRemotePresence();
    publishPresenceSnapshot();
    publishWsStatsSnapshot();
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
  // 监控镜像同样主动清零，避免其他节点的集群视图残留本进程的连接
  publishWsFanout({ kind: 'wsStats', stats: emptyWsNodeStats() });
}

// ─── 监控查询 ──────────────────────────────────────────────────────────
export interface WsConnectionSnapshot {
  connId: string;
  nodeId: string;
  tokenId: string;
  userId: number;
  ip: string | null;
  userAgent: string | null;
  lastMessageType: string | null;
  lastMessageAt: number | null;
  lastDirection: 'inbound' | 'outbound' | null;
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
      nodeId: m.nodeId,
      tokenId: m.tokenId,
      userId: m.userId,
      ip: m.ip,
      userAgent: m.userAgent,
      lastMessageType: m.lastMessageType,
      lastMessageAt: m.lastMessageAt,
      lastDirection: m.lastDirection,
      connectedAt: m.connectedAt,
      lastActivityAt: m.lastActivityAt,
      sent: m.sent,
      recv: m.recv,
    });
  }
  const { nodes, topics } = buildWsAggregates(snapshot, recentMessages);
  return {
    currentConnections: connections.size,
    currentUsers: userSockets.size,
    totalConnects: counters.totalConnects,
    totalDisconnects: counters.totalDisconnects,
    totalSent: counters.totalSent,
    totalRecv: counters.totalRecv,
    messages: [...recentMessages],
    nodes,
    topics,
    connections: snapshot,
    recentDisconnects: [...recentDisconnects],
  };
}

/** 由连接明细与消息采样现算节点 / Topic 聚合：本进程快照与集群合并共用同一口径 */
function buildWsAggregates(
  conns: WsConnectionSnapshot[],
  sampled: WsMonitorMessage[],
): {
  nodes: Array<{ nodeId: string; connections: number; users: number; sent: number; recv: number }>;
  topics: Array<{ topic: string; messages: number; bytes: number }>;
} {
  const topicMap = new Map<string, { messages: number; bytes: number }>();
  for (const message of sampled) {
    if (!message.topic || isWsControlMessage(message)) continue;
    const current = topicMap.get(message.topic) ?? { messages: 0, bytes: 0 };
    current.messages += 1;
    current.bytes += message.bytes;
    topicMap.set(message.topic, current);
  }
  const nodeStats = new Map<string, { connections: number; users: Set<number>; sent: number; recv: number }>();
  for (const m of conns) {
    const current = nodeStats.get(m.nodeId) ?? { connections: 0, users: new Set<number>(), sent: 0, recv: 0 };
    current.connections += 1;
    current.users.add(m.userId);
    current.sent += m.sent;
    current.recv += m.recv;
    nodeStats.set(m.nodeId, current);
  }
  return {
    nodes: [...nodeStats.entries()].map(([id, value]) => ({ nodeId: id, connections: value.connections, users: value.users.size, sent: value.sent, recv: value.recv })),
    topics: [...topicMap.entries()].map(([topic, value]) => ({ topic, ...value })),
  };
}

/** 跨进程 WS 监控快照的单节点载荷（本进程发布、远端镜像存储的都是它） */
export interface WsNodeStats {
  nodeId: string;
  at: number;
  currentConnections: number;
  currentUsers: number;
  totalConnects: number;
  totalDisconnects: number;
  totalSent: number;
  totalRecv: number;
  connections: WsConnectionSnapshot[];
  recentDisconnects: RecentDisconnect[];
  messages: WsMonitorMessage[];
}

function collectWsNodeStats(): WsNodeStats {
  const snapshot: WsConnectionSnapshot[] = [];
  for (const m of connections.values()) {
    snapshot.push({
      connId: m.connId,
      nodeId: m.nodeId,
      tokenId: m.tokenId,
      userId: m.userId,
      ip: m.ip,
      userAgent: m.userAgent,
      lastMessageType: m.lastMessageType,
      lastMessageAt: m.lastMessageAt,
      lastDirection: m.lastDirection,
      connectedAt: m.connectedAt,
      lastActivityAt: m.lastActivityAt,
      sent: m.sent,
      recv: m.recv,
    });
  }
  return {
    nodeId,
    at: Date.now(),
    currentConnections: connections.size,
    currentUsers: userSockets.size,
    totalConnects: counters.totalConnects,
    totalDisconnects: counters.totalDisconnects,
    totalSent: counters.totalSent,
    totalRecv: counters.totalRecv,
    connections: snapshot,
    recentDisconnects: [...recentDisconnects],
    messages: [...recentMessages],
  };
}

function emptyWsNodeStats(): WsNodeStats {
  return {
    nodeId,
    at: Date.now(),
    currentConnections: 0,
    currentUsers: 0,
    totalConnects: counters.totalConnects,
    totalDisconnects: counters.totalDisconnects,
    totalSent: counters.totalSent,
    totalRecv: counters.totalRecv,
    connections: [],
    recentDisconnects: [],
    messages: [],
  };
}

/** 发布本进程 WS 监控快照：presence 同步节拍顺带调用，退出时发空快照主动清零 */
export function publishWsStatsSnapshot(): void {
  publishWsFanout({ kind: 'wsStats', stats: collectWsNodeStats() });
}

/**
 * 集群合并视图：本进程快照 + 存活远端镜像。
 * 计数器按节点求和，在线用户按 userId 去重，明细（连接 / 断开 / 消息）按时间倒序截断
 * （与单进程快照同样的 50 / 200 上限），节点 / Topic 聚合由合并后的明细重算。
 * 单进程部署时退化为与 getWsSnapshot 等价的结果。
 */
export function getWsClusterSnapshot() {
  const local = collectWsNodeStats();
  const remotes = liveRemoteWsNodes().map((entry) => entry.stats);
  const userIds = new Set<number>(local.connections.map((c) => c.userId));
  let totalConnects = local.totalConnects;
  let totalDisconnects = local.totalDisconnects;
  let totalSent = local.totalSent;
  let totalRecv = local.totalRecv;
  const connections = [...local.connections];
  const disconnects = [...local.recentDisconnects];
  const sampled = [...local.messages];
  for (const remote of remotes) {
    totalConnects += remote.totalConnects;
    totalDisconnects += remote.totalDisconnects;
    totalSent += remote.totalSent;
    totalRecv += remote.totalRecv;
    for (const c of remote.connections) {
      connections.push(c);
      userIds.add(c.userId);
    }
    disconnects.push(...remote.recentDisconnects);
    sampled.push(...remote.messages);
  }
  disconnects.sort((a, b) => b.at - a.at);
  if (disconnects.length > RECENT_DISCONNECT_MAX) disconnects.length = RECENT_DISCONNECT_MAX;
  sampled.sort((a, b) => b.at - a.at);
  if (sampled.length > RECENT_MESSAGE_MAX) sampled.length = RECENT_MESSAGE_MAX;
  const { nodes, topics } = buildWsAggregates(connections, sampled);
  return {
    currentConnections: connections.length,
    currentUsers: userIds.size,
    totalConnects,
    totalDisconnects,
    totalSent,
    totalRecv,
    messages: sampled,
    nodes,
    topics,
    connections,
    recentDisconnects: disconnects,
  };
}

/**
 * 按可见用户裁剪集群快照（租户可见范围，见 monitor.service 的 resolveVisibleWsUserIds）。
 *
 * 连接 / 断开 / 消息明细只保留可见用户，派生项（当前连接数、在线用户数、节点与 Topic 聚合）
 * 由裁剪后的明细重算，保证明细列表与统计卡片同口径；不带用户身份的消息（`userId` 为空，
 * 实际只有 ping / pong 之类控制帧）对受限视角一并丢弃，避免「采样消息数」混入他租户流量。
 *
 * 累计计数器（totalConnects / totalDisconnects / totalSent / totalRecv）是进程级计数，
 * 没有按用户的历史可回溯，保持平台级原值 —— 契约上已标注该口径。
 * 裁剪结果必然是原子集，无需再套 50 / 200 上限。
 */
export function filterWsClusterSnapshot(
  snap: ReturnType<typeof getWsClusterSnapshot>,
  visibleUserIds: ReadonlySet<number>,
): ReturnType<typeof getWsClusterSnapshot> {
  const connections = snap.connections.filter((c) => visibleUserIds.has(c.userId));
  const messages = snap.messages.filter((m) => m.userId !== null && visibleUserIds.has(m.userId));
  const recentDisconnects = snap.recentDisconnects.filter((d) => visibleUserIds.has(d.userId));
  const { nodes, topics } = buildWsAggregates(connections, messages);
  return {
    currentConnections: connections.length,
    currentUsers: new Set(connections.map((c) => c.userId)).size,
    totalConnects: snap.totalConnects,
    totalDisconnects: snap.totalDisconnects,
    totalSent: snap.totalSent,
    totalRecv: snap.totalRecv,
    messages,
    nodes,
    topics,
    connections,
    recentDisconnects,
  };
}
