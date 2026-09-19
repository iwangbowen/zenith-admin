/**
 * ws-monitor 共享纯逻辑单测：活跃判定、原因分布、Topic 方向拆分、健康派生。
 */
import { describe, expect, it } from 'vitest';
import {
  WS_ACTIVE_THRESHOLD_MS,
  groupWsDisconnectReasons,
  isWsConnectionActive,
  statWsTopicDirections,
  summarizeWsHealth,
} from './ws-monitor';
import type { MonitorWsConnection, MonitorWsDisconnect, MonitorWsMessage } from './contracts/monitor';

const NOW = 1_700_000_000_000;

const connection = (overrides: Partial<MonitorWsConnection> = {}): MonitorWsConnection => ({
  connId: 'c1',
  nodeId: 'n1',
  tokenId: 't1',
  userId: 1,
  username: 'admin',
  nickname: null,
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
      { topic: 'ping', inbound: 1, outbound: 0, failed: 0, bytes: 8 },
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
