import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WSContext } from 'hono/ws';

type WsManager = typeof import('./ws-manager');

function fakeWs() {
  const send = vi.fn();
  return { ws: { send, close: vi.fn() } as unknown as WSContext, send };
}

function framesOf(send: ReturnType<typeof vi.fn>, type: string) {
  return send.mock.calls
    .map(([raw]) => JSON.parse(raw as string) as { type: string; payload: unknown })
    .filter((m) => m.type === type)
    .map((m) => m.payload);
}

let m: WsManager;

beforeEach(async () => {
  vi.useFakeTimers();
  // 模块级连接表在用例间隔离
  vi.resetModules();
  m = await import('./ws-manager');
});
afterEach(() => vi.useRealTimers());

describe('presence 合并广播', () => {
  it('窗口内多次上线合并为一条批量 chat:presence，并按 flush 时刻的真实状态输出', () => {
    const a = fakeWs();
    const b = fakeWs();
    const c = fakeWs();
    m.registerConnection(1, 'ta', a.ws);
    m.registerConnection(2, 'tb', b.ws);
    m.registerConnection(3, 'tc', c.ws);
    expect(a.send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);

    for (const conn of [a, b, c]) {
      const frames = framesOf(conn.send, 'chat:presence');
      expect(frames).toHaveLength(1);
      expect(frames[0]).toEqual([
        { userId: 1, online: true, lastSeen: null },
        { userId: 2, online: true, lastSeen: null },
        { userId: 3, online: true, lastSeen: null },
      ]);
    }
  });

  it('窗口内先上线再下线只产生一条离线记录并带 lastSeen', () => {
    const observer = fakeWs();
    m.registerConnection(1, 'obs', observer.ws);
    vi.advanceTimersByTime(1_000);
    observer.send.mockClear();

    const flapper = fakeWs();
    m.registerConnection(2, 'flap', flapper.ws);
    m.removeConnection(2, 'flap', 'close', flapper.ws);
    vi.advanceTimersByTime(1_000);

    const frames = framesOf(observer.send, 'chat:presence');
    expect(frames).toHaveLength(1);
    expect(frames[0]).toEqual([
      { userId: 2, online: false, lastSeen: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/) },
    ]);
  });

  it('窗口内先下线再重连输出在线，不会把用户误报为离线', () => {
    const observer = fakeWs();
    const first = fakeWs();
    m.registerConnection(1, 'obs', observer.ws);
    m.registerConnection(2, 't2', first.ws);
    vi.advanceTimersByTime(1_000);
    observer.send.mockClear();

    m.removeConnection(2, 't2', 'close', first.ws);
    const second = fakeWs();
    m.registerConnection(2, 't2', second.ws);
    vi.advanceTimersByTime(1_000);

    expect(framesOf(observer.send, 'chat:presence')).toEqual([[{ userId: 2, online: true, lastSeen: null }]]);
    expect(m.getUserPresence(2)).toEqual({ userId: 2, online: true, lastSeen: null });
  });

  it('没有任何连接时不做无谓的序列化与广播', () => {
    const a = fakeWs();
    m.registerConnection(1, 'ta', a.ws);
    m.removeConnection(1, 'ta', 'close', a.ws);
    vi.advanceTimersByTime(1_000);
    expect(a.send).not.toHaveBeenCalled();
  });
});

describe('同一 token 重连接管', () => {
  it('旧 socket 迟到的 close 不会删掉新连接或把用户标为离线', () => {
    const stale = fakeWs();
    const fresh = fakeWs();
    m.registerConnection(1, 'jti-1', stale.ws);
    m.registerConnection(1, 'jti-1', fresh.ws);

    expect(m.isSupersededConnection('jti-1', stale.ws)).toBe(true);
    expect(m.isSupersededConnection('jti-1', fresh.ws)).toBe(false);

    m.removeConnection(1, 'jti-1', 'close', stale.ws);
    expect(m.isUserOnline(1)).toBe(true);
    m.sendToUser(1, { type: 'announcement:read-all', payload: {} });
    expect(fresh.send).toHaveBeenCalledTimes(1);
    expect(stale.send).not.toHaveBeenCalled();

    // 被接管的旧连接按 replaced 计入断开统计，连接 / 断开计数保持平衡
    const snap = m.getWsSnapshot();
    expect(snap.currentConnections).toBe(1);
    expect(snap.totalConnects).toBe(2);
    expect(snap.totalDisconnects).toBe(1);
    expect(snap.recentDisconnects[0]).toMatchObject({ tokenId: 'jti-1', userId: 1, reason: 'replaced' });

    m.removeConnection(1, 'jti-1', 'close', fresh.ws);
    expect(m.isUserOnline(1)).toBe(false);
    expect(m.getWsSnapshot().totalDisconnects).toBe(2);
  });

  it('未传 ws 的调用（强制下线等）保持原有语义', () => {
    const a = fakeWs();
    m.registerConnection(1, 'jti-1', a.ws);
    m.removeConnection(1, 'jti-1', 'force-logout');
    expect(m.isUserOnline(1)).toBe(false);
    expect(m.getWsSnapshot().currentConnections).toBe(0);
  });

  it('closeTokenConnection 之后 socket 自身的 close 事件是幂等的', () => {
    const a = fakeWs();
    m.registerConnection(1, 'jti-1', a.ws);
    m.closeTokenConnection('jti-1', 'force-logout');
    m.removeConnection(1, 'jti-1', 'close', a.ws);
    const snap = m.getWsSnapshot();
    expect(snap.totalDisconnects).toBe(1);
    expect(snap.recentDisconnects).toHaveLength(1);
    expect(snap.recentDisconnects[0].reason).toBe('force-logout');
  });
});

describe('scheduleBroadcast', () => {
  it('延后到下一个 I/O tick 才推送给全部连接', () => {
    const a = fakeWs();
    const b = fakeWs();
    m.registerConnection(1, 'ta', a.ws);
    m.registerConnection(2, 'tb', b.ws);

    m.scheduleBroadcast({ type: 'announcement:read-all', payload: {} });
    expect(a.send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);
    expect(framesOf(a.send, 'announcement:read-all')).toHaveLength(1);
    expect(framesOf(b.send, 'announcement:read-all')).toHaveLength(1);
  });
});
