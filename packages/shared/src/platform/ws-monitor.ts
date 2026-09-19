/**
 * WebSocket 连接监控共享纯逻辑：活跃判定、断开原因分布、Topic 方向拆分、健康派生。
 * 服务端快照合并 / 前端监控页 / Mock 共用，禁止在 server 与 web 各写一份「对齐」的实现。
 */
import { percentOf } from '../core/math';
import type {
  MonitorWsConnection,
  MonitorWsDisconnect,
  MonitorWsMessage,
  MonitorWsMetrics,
} from './contracts/monitor';

/** 最近活动超过该阈值视为“空闲”（与既有页面行为一致） */
export const WS_ACTIVE_THRESHOLD_MS = 120_000;

export function isWsConnectionActive(lastActivityAt: number, now: number = Date.now()): boolean {
  return now - lastActivityAt <= WS_ACTIVE_THRESHOLD_MS;
}

export interface WsDisconnectReasonStat {
  reason: string;
  count: number;
}

/** 断开原因分布，按次数倒序；空原因归一为 unknown */
export function groupWsDisconnectReasons(disconnects: MonitorWsDisconnect[]): WsDisconnectReasonStat[] {
  const counts = new Map<string, number>();
  for (const d of disconnects) {
    const reason = d.reason || 'unknown';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count);
}

export interface WsTopicDirectionStat {
  topic: string;
  inbound: number;
  outbound: number;
  failed: number;
  bytes: number;
}

/** 按 topic 拆入站 / 出站 / 失败（从消息采样现算，不依赖后端聚合）；topic 缺失时回退到消息类型 */
export function statWsTopicDirections(messages: MonitorWsMessage[]): WsTopicDirectionStat[] {
  const stats = new Map<string, WsTopicDirectionStat>();
  for (const m of messages) {
    const topic = m.topic ?? m.type;
    const cur = stats.get(topic) ?? { topic, inbound: 0, outbound: 0, failed: 0, bytes: 0 };
    if (m.direction === 'inbound') cur.inbound += 1;
    else cur.outbound += 1;
    if (!m.success) cur.failed += 1;
    cur.bytes += m.bytes;
    stats.set(topic, cur);
  }
  return [...stats.values()].sort((a, b) => (b.inbound + b.outbound) - (a.inbound + a.outbound));
}

export interface WsHealthSummary {
  /** 消息采样成功率（采样为空时为 null，由调用方渲染占位） */
  successRate: number | null;
  idleCount: number;
  /** 空闲占比（无在线连接时为 null） */
  idleRatio: number | null;
  /** 人均连接数（无在线用户时为 null） */
  avgConnsPerUser: number | null;
  /** 平均在线时长（秒，无在线连接时为 null） */
  avgDurationSec: number | null;
}
/** 由连接快照与消息采样派生健康指标；分母为 0 的项返回 null */
export function summarizeWsHealth(
  connections: MonitorWsConnection[],
  currentUsers: number,
  messages: MonitorWsMessage[],
  now: number = Date.now(),
): WsHealthSummary {
  const idleCount = connections.filter((c) => !isWsConnectionActive(c.lastActivityAt, now)).length;
  const succeeded = messages.filter((m) => m.success).length;
  const totalDurationSec = connections.reduce((sum, c) => sum + Math.max(0, (now - c.connectedAt) / 1000), 0);
  return {
    successRate: percentOf(succeeded, messages.length),
    idleCount,
    idleRatio: percentOf(idleCount, connections.length),
    avgConnsPerUser: currentUsers > 0
      ? Math.round((connections.length / currentUsers) * 10) / 10
      : null,
    avgDurationSec: connections.length > 0 ? Math.round(totalDurationSec / connections.length) : null,
  };
}

export type WsClientKind = 'desktop' | 'mobile' | 'web' | 'unknown';

export interface WsClientInfo {
  browser: string;
  os: string;
  kind: WsClientKind;
}

const WS_CLIENT_LABEL_UNKNOWN = 'Unknown';

/** 由握手期采集的 User-Agent 原文派生浏览器 / 系统 / 端形态（轻量正则，不引入解析依赖） */
export function describeWsClient(userAgent: string | null | undefined): WsClientInfo {
  if (!userAgent) return { browser: WS_CLIENT_LABEL_UNKNOWN, os: WS_CLIENT_LABEL_UNKNOWN, kind: 'unknown' };
  const ua = userAgent;
  const browser = /Edg\/([\d.]+)/.test(ua)
    ? `Edge ${/Edg\/([\d.]+)/.exec(ua)?.[1] ?? ''}`.trim()
    : /Electron\/([\d.]+)/.test(ua)
      ? `Electron ${/Electron\/([\d.]+)/.exec(ua)?.[1] ?? ''}`.trim()
      : /Chrome\/([\d.]+)/.test(ua)
        ? `Chrome ${/Chrome\/([\d.]+)/.exec(ua)?.[1] ?? ''}`.trim()
        : /Firefox\/([\d.]+)/.test(ua)
          ? `Firefox ${/Firefox\/([\d.]+)/.exec(ua)?.[1] ?? ''}`.trim()
          : /Version\/([\d.]+).*Safari\//.test(ua)
            ? `Safari ${/Version\/([\d.]+)/.exec(ua)?.[1] ?? ''}`.trim()
            : WS_CLIENT_LABEL_UNKNOWN;
  const os = /Windows NT/.test(ua)
    ? 'Windows'
    : /Mac OS X/.test(ua)
      ? 'macOS'
      : /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad|iPod/.test(ua)
          ? 'iOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : WS_CLIENT_LABEL_UNKNOWN;
  const kind: WsClientKind = /Electron\//.test(ua)
    ? 'desktop'
    : /Mobile|Android|iPhone|iPad|iPod/.test(ua)
      ? 'mobile'
      : 'web';
  return { browser, os, kind };
}

// ─── 关系拓扑（UI 无关的图数据；页面映射为 React Flow 节点 / 边） ────────

/** 图中最多呈现的用户数（按活跃度取 Top，超出用表格查看全部） */
export const WS_TOPO_MAX_USERS = 60;
/** 图中最多呈现的 Topic 数（按下发采样取 Top） */
export const WS_TOPO_MAX_TOPICS = 30;
/** 重连推断窗口：同一 token 在断开前后该窗口内的新连接视为同一次重连（含新旧并存） */
export const WS_RECONNECT_WINDOW_MS = 60_000;

export type WsTopoNodeKind = 'bus' | 'gateway' | 'user' | 'topic';

export interface WsTopoNode {
  id: string;
  kind: WsTopoNodeKind;
  label: string;
  sub: string;
  userId?: number;
  nodeId?: string;
  topic?: string;
  /** 该点聚合的连接数 */
  connections: number;
  users: number;
  sent: number;
  recv: number;
  /** 用户点：其连接的端形态集合 */
  kinds: WsClientKind[];
  idle: boolean;
  /** 用户点：命中重连推断 */
  reconnected: boolean;
  /** 点选高亮 hook 回写位，构建时恒为 false */
  dimmed: boolean;
}

export type WsTopoEdgeKind = 'fanout' | 'attach' | 'deliver';

export interface WsTopoEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  kind: WsTopoEdgeKind;
}

export interface WsTopology {
  nodes: WsTopoNode[];
  edges: WsTopoEdge[];
  /** 因上限未进图的用户数 */
  truncatedUsers: number;
  /** 因上限未进图的 Topic 数 */
  truncatedTopics: number;
  userCount: number;
  topicCount: number;
}

function topoNodeBase(id: string, kind: WsTopoNodeKind, label: string, sub: string): WsTopoNode {
  return {
    id, kind, label, sub,
    connections: 0, users: 0, sent: 0, recv: 0,
    kinds: [], idle: false, reconnected: false, dimmed: false,
  };
}

/**
 * 由监控快照构建四层关系图：扇出总线 → 网关节点 → 用户 → Topic。
 * 说明口径（页面须如实展示，不可写作订阅）：
 * - 网关→用户是归属边（该用户在此节点有存活连接）；
 * - Topic→用户是投递边（最近 200 条出站采样中该 Topic 下发给该用户的条数），不是订阅关系；
 *   `/api/ws` 协议没有订阅原语，服务端不记录订阅。
 */
export function buildWsTopology(metrics: MonitorWsMetrics, now: number = Date.now()): WsTopology {
  const reconnectedUsers = new Set(inferWsReconnects(metrics.connections, metrics.recentDisconnects).map((r) => r.userId));
  const nodes: WsTopoNode[] = [];
  const edges: WsTopoEdge[] = [];

  nodes.push({
    ...topoNodeBase('bus', 'bus', 'Redis 扇出总线', 'at-most-once · 跨进程投递'),
    users: metrics.currentUsers,
  });

  const gatewayIds = new Set<string>();
  for (const n of metrics.nodes) {
    gatewayIds.add(n.nodeId);
    nodes.push({
      ...topoNodeBase(`node:${n.nodeId}`, 'gateway', n.nodeId, `${n.connections} 连接 · ${n.users} 用户`),
      nodeId: n.nodeId,
      connections: n.connections,
      users: n.users,
      sent: n.sent,
      recv: n.recv,
    });
    edges.push({ id: `fanout:${n.nodeId}`, source: 'bus', target: `node:${n.nodeId}`, label: 'wsStats / 推送', kind: 'fanout' });
  }

  const byUser = new Map<number, MonitorWsConnection[]>();
  for (const c of metrics.connections) {
    const list = byUser.get(c.userId) ?? [];
    list.push(c);
    byUser.set(c.userId, list);
  }
  const ranked = [...byUser.entries()].sort((a, b) => {
    const activity = (list: MonitorWsConnection[]) => list.reduce((s, c) => s + c.sent + c.recv, 0);
    return activity(b[1]) - activity(a[1]);
  });
  const shown = ranked.slice(0, WS_TOPO_MAX_USERS);
  for (const [userId, list] of shown) {
    const first = list[0];
    const kinds = [...new Set(list.map((c) => describeWsClient(c.userAgent).kind))];
    const sent = list.reduce((s, c) => s + c.sent, 0);
    const recv = list.reduce((s, c) => s + c.recv, 0);
    const idle = list.every((c) => !isWsConnectionActive(c.lastActivityAt, now));
    nodes.push({
      ...topoNodeBase(
        `user:${userId}`,
        'user',
        first.nickname || first.username || `用户 #${userId}`,
        `${list.length} 连接 · ${kinds.join('/')}`,
      ),
      userId,
      connections: list.length,
      users: 1,
      sent,
      recv,
      kinds,
      idle,
      reconnected: reconnectedUsers.has(userId),
    });
    const byNode = new Map<string, number>();
    for (const c of list) byNode.set(c.nodeId, (byNode.get(c.nodeId) ?? 0) + 1);
    for (const [nodeId, count] of byNode) {
      if (!gatewayIds.has(nodeId)) continue;
      edges.push({ id: `attach:${nodeId}:${userId}`, source: `node:${nodeId}`, target: `user:${userId}`, label: `${count} 连接`, kind: 'attach' });
    }
  }

  const delivered = new Map<string, Map<number, number>>();
  const topicBytes = new Map<string, number>();
  for (const m of metrics.messages) {
    if (m.direction !== 'outbound' || m.userId === null) continue;
    const topic = m.topic ?? m.type;
    const perUser = delivered.get(topic) ?? new Map<number, number>();
    perUser.set(m.userId, (perUser.get(m.userId) ?? 0) + 1);
    delivered.set(topic, perUser);
    topicBytes.set(topic, (topicBytes.get(topic) ?? 0) + m.bytes);
  }
  const rankedTopics = [...delivered.entries()].sort((a, b) => {
    const total = (perUser: Map<number, number>) => [...perUser.values()].reduce((s, n) => s + n, 0);
    return total(b[1]) - total(a[1]);
  });
  const shownTopics = rankedTopics.slice(0, WS_TOPO_MAX_TOPICS);
  const shownUserIds = new Set(shown.map(([userId]) => userId));
  for (const [topic, perUser] of shownTopics) {
    const total = [...perUser.values()].reduce((s, n) => s + n, 0);
    nodes.push({
      ...topoNodeBase(`topic:${topic}`, 'topic', topic, `${total} 条下发采样`),
      topic,
      users: perUser.size,
      sent: total,
      recv: topicBytes.get(topic) ?? 0,
    });
    for (const [userId, count] of perUser) {
      if (!shownUserIds.has(userId)) continue;
      edges.push({ id: `deliver:${topic}:${userId}`, source: `topic:${topic}`, target: `user:${userId}`, label: `${count} 条`, kind: 'deliver' });
    }
  }

  return {
    nodes,
    edges,
    truncatedUsers: ranked.length - shown.length,
    truncatedTopics: rankedTopics.length - shownTopics.length,
    userCount: ranked.length,
    topicCount: rankedTopics.length,
  };
}

export interface WsReconnectLink {
  userId: number;
  username: string | null;
  nickname: string | null;
  tokenId: string;
  prevConnId: string;
  prevReason: string;
  prevAt: number;
  newConnId: string;
  newNodeId: string;
  /** 断开与重建落在不同节点即跨节点迁移 */
  crossNode: boolean;
  /** 新连接建立相对断开的时间差（毫秒；负值表示新旧并存的重叠拨号） */
  gapMs: number;
}

/**
 * 重连推断：同一 token 的最新一条断开 + 一条存活连接配对，
 * 且两者时间差在窗口内。返回按断开时间倒序。
 * 这是启发式推断（服务端不存连接血缘），页面须标注“推断”。
 */
export function inferWsReconnects(
  connections: MonitorWsConnection[],
  recentDisconnects: MonitorWsDisconnect[],
  windowMs: number = WS_RECONNECT_WINDOW_MS,
): WsReconnectLink[] {
  const latestByToken = new Map<string, MonitorWsDisconnect>();
  for (const d of recentDisconnects) {
    const cur = latestByToken.get(d.tokenId);
    if (!cur || d.at > cur.at) latestByToken.set(d.tokenId, d);
  }
  const out: WsReconnectLink[] = [];
  for (const c of connections) {
    const d = latestByToken.get(c.tokenId);
    if (!d || d.connId === c.connId) continue;
    if (Math.abs(c.connectedAt - d.at) > windowMs) continue;
    const first = connections.find((x) => x.userId === c.userId);
    out.push({
      userId: c.userId,
      username: c.username,
      nickname: first?.nickname ?? c.nickname,
      tokenId: c.tokenId,
      prevConnId: d.connId,
      prevReason: d.reason,
      prevAt: d.at,
      newConnId: c.connId,
      newNodeId: c.nodeId,
      crossNode: d.nodeId !== c.nodeId,
      gapMs: c.connectedAt - d.at,
    });
  }
  return out.sort((a, b) => b.prevAt - a.prevAt);
}

export interface WsClientKindStat {
  kind: WsClientKind;
  connections: number;
  users: number;
}

export interface WsClientStats {
  byKind: WsClientKindStat[];
  topBrowsers: Array<{ name: string; connections: number }>;
  topOSs: Array<{ name: string; connections: number }>;
}

/** 客户端分布：端形态 × Top 浏览器 × Top 系统（UA 缺失的连接归为 unknown，不丢数） */
export function statWsClients(connections: MonitorWsConnection[]): WsClientStats {
  const kinds = new Map<WsClientKind, { connections: number; users: Set<number> }>();
  const browsers = new Map<string, number>();
  const oss = new Map<string, number>();
  for (const c of connections) {
    const info = describeWsClient(c.userAgent);
    const cur = kinds.get(info.kind) ?? { connections: 0, users: new Set<number>() };
    cur.connections += 1;
    cur.users.add(c.userId);
    kinds.set(info.kind, cur);
    browsers.set(info.browser, (browsers.get(info.browser) ?? 0) + 1);
    oss.set(info.os, (oss.get(info.os) ?? 0) + 1);
  }
  const top = (m: Map<string, number>) => [...m.entries()]
    .map(([name, count]) => ({ name, connections: count }))
    .sort((a, b) => b.connections - a.connections)
    .slice(0, 5);
  return {
    byKind: [...kinds.entries()]
      .map(([kind, v]) => ({ kind, connections: v.connections, users: v.users.size }))
      .sort((a, b) => b.connections - a.connections),
    topBrowsers: top(browsers),
    topOSs: top(oss),
  };
}
