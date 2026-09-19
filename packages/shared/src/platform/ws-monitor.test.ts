/**
 * ws-monitor 共享纯逻辑单测：活跃判定、原因分布、Topic 方向拆分、健康派生。
 */
import { describe, expect, it } from 'vitest';
import {
  WS_ACTIVE_THRESHOLD_MS,
  buildWsTopology,
  describeWsClient,
  groupWsDisconnectReasons,
  inferWsReconnects,
  isWsConnectionActive,
  statWsClients,
  statWsTopicDirections,
  summarizeWsHealth,
} from './ws-monitor';
import type { MonitorWsConnection, MonitorWsDisconnect, MonitorWsMessage, MonitorWsMetrics } from './contracts/monitor';

const NOW = 1_700_000_000_000;

const connection = (overrides: Partial<MonitorWsConnection> = {}): MonitorWsConnection => ({
  connId: 'c1',
  nodeId: 'n1',
  tokenId: 't1',
  userId: 1,
  username: 'admin',
  nickname: null,
  ip: null,
  userAgent: null,
  lastMessageType: null,
  lastMessageAt: null,
  lastDirection: null,
  connectedAt: NOW - 600_000,
  lastActivityAt: NOW,
  sent: 10,
  recv: 5,
  ...overrides,
});

const disconnect = (overrides: Partial<MonitorWsDisconnect> = {}): MonitorWsDisconnect => ({
  connId: 'c9',
  nodeId: 'n1',
  tokenId: 't9',
  userId: 2,
  username: null,
  nickname: null,
  ip: null,
  userAgent: null,
  at: NOW,
  reason: 'close',
  duration: 60_000,
  sent: 3,
  recv: 1,
  ...overrides,
});

const message = (overrides: Partial<MonitorWsMessage> = {}): MonitorWsMessage => ({
  id: 'm1',
  at: NOW,
  direction: 'outbound',
  nodeId: 'n1',
  connId: 'c1',
  userId: 1,
  type: 'chat:message',
  topic: 'chat',
  bytes: 128,
  success: true,
  ...overrides,
});

describe('isWsConnectionActive', () => {
  it('阈值内活跃、超阈值空闲、边界值仍算活跃', () => {
    expect(isWsConnectionActive(NOW, NOW)).toBe(true);
    expect(isWsConnectionActive(NOW - WS_ACTIVE_THRESHOLD_MS, NOW)).toBe(true);
    expect(isWsConnectionActive(NOW - WS_ACTIVE_THRESHOLD_MS - 1, NOW)).toBe(false);
  });
});

describe('groupWsDisconnectReasons', () => {
  it('按次数倒序，空原因归一为 unknown', () => {
    const out = groupWsDisconnectReasons([
      disconnect({ reason: 'close' }),
      disconnect({ reason: '' }),
      disconnect({ reason: 'force-logout' }),
      disconnect({ reason: 'close' }),
    ]);
    expect(out).toEqual([
      { reason: 'close', count: 2 },
      { reason: 'unknown', count: 1 },
      { reason: 'force-logout', count: 1 },
    ]);
  });

  it('空输入返回空数组', () => {
    expect(groupWsDisconnectReasons([])).toEqual([]);
  });
});

describe('statWsTopicDirections', () => {
  it('拆入站 / 出站 / 失败并按总量倒序，缺失 topic 回退到 type', () => {
    const out = statWsTopicDirections([
      message({ topic: 'chat', direction: 'outbound', bytes: 100 }),
      message({ topic: 'chat', direction: 'inbound', bytes: 50 }),
      message({ topic: 'chat', direction: 'outbound', success: false, bytes: 60 }),
      message({ topic: null, type: 'ping', direction: 'inbound', bytes: 8 }),
    ]);
    expect(out).toEqual([
      { topic: 'chat', inbound: 1, outbound: 2, failed: 1, bytes: 210 },
    ]);
  });

  it('排除 ping / pong 控制帧，避免心跳污染业务 Topic 统计', () => {
    expect(statWsTopicDirections([
      message({ type: 'ping', topic: null, direction: 'inbound' }),
      message({ type: 'pong', topic: null, direction: 'outbound' }),
      message({ type: 'chat:message', topic: 'chat', direction: 'outbound' }),
    ])).toEqual([
      { topic: 'chat', inbound: 0, outbound: 1, failed: 0, bytes: 128 },
    ]);
  });
});

describe('summarizeWsHealth', () => {
  it('派生成功率 / 空闲数 / 人均连接 / 平均时长', () => {
    const out = summarizeWsHealth(
      [
        connection({ connId: 'c1', lastActivityAt: NOW }),
        connection({ connId: 'c2', lastActivityAt: NOW - WS_ACTIVE_THRESHOLD_MS - 1 }),
      ],
      1,
      [message({}), message({ success: false })],
      NOW,
    );
    expect(out).toEqual({
      successRate: 50,
      idleCount: 1,
      idleRatio: 50,
      avgConnsPerUser: 2,
      avgDurationSec: 600,
    });
  });

  it('空快照的分母为 0 项返回 null', () => {
    expect(summarizeWsHealth([], 0, [], NOW)).toEqual({
      successRate: null,
      idleCount: 0,
      idleRatio: null,
      avgConnsPerUser: null,
      avgDurationSec: null,
    });
  });
});

describe('describeWsClient', () => {
  it('空 UA 返回 unknown', () => {
    expect(describeWsClient(null)).toEqual({ browser: 'Unknown', os: 'Unknown', kind: 'unknown' });
    expect(describeWsClient('')).toEqual({ browser: 'Unknown', os: 'Unknown', kind: 'unknown' });
  });

  it('识别桌面浏览器与系统', () => {
    expect(describeWsClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'))
      .toEqual({ browser: 'Chrome 120.0.0.0', os: 'Windows', kind: 'web' });
    expect(describeWsClient('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'))
      .toEqual({ browser: 'Safari 17.0', os: 'macOS', kind: 'web' });
  });

  it('Electron 判为桌面端，移动 UA 判为移动端', () => {
    expect(describeWsClient('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Electron/28.0.0').kind).toBe('desktop');
    expect(describeWsClient('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1').kind).toBe('mobile');
  });
});

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const metricsOf = (overrides: Partial<MonitorWsMetrics> = {}): MonitorWsMetrics => ({
  currentConnections: 0,
  currentUsers: 0,
  totalConnects: 0,
  totalDisconnects: 0,
  totalSent: 0,
  totalRecv: 0,
  messages: [],
  nodes: [],
  topics: [],
  connections: [],
  recentDisconnects: [],
  ...overrides,
});

describe('buildWsTopology', () => {
  it('构建总线 → 网关 → 用户 → Topic 四层与三类边；入站采样不产生投递边', () => {
    const topo = buildWsTopology(metricsOf({
      currentConnections: 2,
      currentUsers: 2,
      nodes: [{ nodeId: 'n1', connections: 2, users: 2, sent: 30, recv: 8 }],
      connections: [
        connection({ connId: 'c1', nodeId: 'n1', tokenId: 't1', userId: 1, username: 'admin', nickname: '管', userAgent: CHROME_UA }),
        connection({ connId: 'c2', nodeId: 'n1', tokenId: 't2', userId: 2, username: 'demo', nickname: null, userAgent: null }),
      ],
      messages: [
        message({ id: 'm1', direction: 'outbound', topic: 'chat', userId: 1, connId: 'c1' }),
        message({ id: 'm2', direction: 'outbound', topic: 'chat', userId: 1, connId: 'c1' }),
        message({ id: 'm3', direction: 'inbound', topic: 'chat', userId: 2, connId: 'c2' }),
        message({ id: 'm4', type: 'pong', topic: null, direction: 'outbound', userId: 1, connId: 'c1' }),
      ],
    }), NOW);
    expect(topo.nodes.map((n) => n.id)).toEqual(['bus', 'node:n1', 'user:1', 'user:2', 'topic:chat']);
    expect(topo.edges).toEqual([
      { id: 'fanout:n1', source: 'bus', target: 'node:n1', label: 'wsStats / 推送', kind: 'fanout' },
      { id: 'attach:n1:1', source: 'node:n1', target: 'user:1', label: '1 连接', kind: 'attach' },
      { id: 'attach:n1:2', source: 'node:n1', target: 'user:2', label: '1 连接', kind: 'attach' },
      { id: 'deliver:chat:1', source: 'topic:chat', target: 'user:1', label: '2 条', kind: 'deliver' },
    ]);
    const u1 = topo.nodes.find((n) => n.id === 'user:1');
    expect(u1).toMatchObject({ label: '管', connections: 1, kinds: ['web'], idle: false });
    expect(topo).toMatchObject({ truncatedUsers: 0, truncatedTopics: 0, userCount: 2, topicCount: 1 });
  });
});

describe('inferWsReconnects', () => {
  it('同 token 窗口内配对为重连并按断开时间倒序；超窗与同连接排除', () => {
    const out = inferWsReconnects(
      [
        connection({ connId: 'c-new', tokenId: 't1', userId: 1, nodeId: 'n1', connectedAt: NOW - 10_000 }),
        connection({ connId: 'c-other', tokenId: 't2', userId: 2, nodeId: 'n1', connectedAt: NOW - 5_000 }),
      ],
      [
        disconnect({ connId: 'c-old', tokenId: 't1', userId: 1, nodeId: 'n2', reason: 'close', at: NOW - 15_000 }),
        disconnect({ connId: 'c-stale', tokenId: 't2', userId: 2, nodeId: 'n1', reason: 'close', at: NOW - 600_000 }),
      ],
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      userId: 1, tokenId: 't1', prevConnId: 'c-old', newConnId: 'c-new',
      crossNode: true, gapMs: 5_000,
    });
  });
});

describe('statWsClients', () => {
  it('按端形态聚合连接与去重用户，浏览器 / 系统取 Top', () => {
    const out = statWsClients([
      connection({ connId: 'c1', userId: 1, userAgent: CHROME_UA }),
      connection({ connId: 'c2', userId: 1, userAgent: CHROME_UA }),
      connection({ connId: 'c3', userId: 2, userAgent: null }),
    ]);
    expect(out.byKind).toEqual([
      { kind: 'web', connections: 2, users: 1 },
      { kind: 'unknown', connections: 1, users: 1 },
    ]);
    expect(out.topBrowsers[0]).toEqual({ name: 'Chrome 120.0.0.0', connections: 2 });
    expect(out.topOSs[0]).toEqual({ name: 'Windows', connections: 2 });
  });
});
