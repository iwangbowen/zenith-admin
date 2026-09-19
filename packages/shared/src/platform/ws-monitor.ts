/**
 * WebSocket 连接监控共享纯逻辑：活跃判定、断开原因分布、Topic 方向拆分、健康派生。
 * 服务端快照合并 / 前端监控页 / Mock 共用，禁止在 server 与 web 各写一份「对齐」的实现。
 */
import { percentOf } from '../core/math';
import type {
  MonitorWsConnection,
  MonitorWsDisconnect,
  MonitorWsMessage,
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
