/**
 * ws-monitor 共享纯逻辑单测：活跃判定、原因分布、Topic 方向拆分、健康派生。
 */
import { describe, expect, it } from 'vitest';
import {
  WS_ACTIVE_THRESHOLD_MS,
  describeWsClient,
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
