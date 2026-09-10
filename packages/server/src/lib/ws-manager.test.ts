import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WSContext } from 'hono/ws';

type WsManager = typeof import('./ws-manager');

function fakeWs() {
  const send = vi.fn();
  const close = vi.fn();
  return { ws: { send, close } as unknown as WSContext, send, close };
}

function framesOf(send: ReturnType<typeof vi.fn>, type: string) {
  return send.mock.calls
    .map(([raw]) => JSON.parse(raw as string) as { type: string; payload: unknown })
    .filter((m) => m.type === type)
    .map((m) => m.payload);
}

const PING: import('@zenith/shared/platform').WsMessage = { type: 'announcement:read-all', payload: {} };

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
    m.removeConnection(flapper.ws);
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

    m.removeConnection(first.ws);
    const second = fakeWs();
    m.registerConnection(2, 't2', second.ws);
    vi.advanceTimersByTime(1_000);

    expect(framesOf(observer.send, 'chat:presence')).toEqual([[{ userId: 2, online: true, lastSeen: null }]]);
    expect(m.getUserPresence(2)).toEqual({ userId: 2, online: true, lastSeen: null });
  });

  it('没有任何连接时不做无谓的序列化与广播', () => {
    const a = fakeWs();
    m.registerConnection(1, 'ta', a.ws);
    m.removeConnection(a.ws);
    vi.advanceTimersByTime(1_000);
    expect(a.send).not.toHaveBeenCalled();
  });
});

describe('同一 token 多条连接', () => {
  it('多标签页各自登记，按用户 / 按 token / 全量推送都到达每一条连接', () => {
    const tabA = fakeWs();
    const tabB = fakeWs();
    const other = fakeWs();
    m.registerConnection(1, 'jti-1', tabA.ws);
    m.registerConnection(1, 'jti-1', tabB.ws);
    m.registerConnection(2, 'jti-2', other.ws);

    m.sendToUser(1, PING);
    expect(tabA.send).toHaveBeenCalledTimes(1);
    expect(tabB.send).toHaveBeenCalledTimes(1);
    expect(other.send).not.toHaveBeenCalled();

    m.sendToToken('jti-1', PING);
    expect(tabA.send).toHaveBeenCalledTimes(2);
    expect(tabB.send).toHaveBeenCalledTimes(2);

    m.broadcast(PING);
    expect(tabA.send).toHaveBeenCalledTimes(3);
    expect(tabB.send).toHaveBeenCalledTimes(3);
    expect(other.send).toHaveBeenCalledTimes(1);

    const snap = m.getWsSnapshot();
    expect(snap.currentConnections).toBe(3);
    expect(snap.currentUsers).toBe(2);
    expect(new Set(snap.connections.map((c) => c.connId)).size).toBe(3);
  });

  it('关闭其中一个标签页不影响另一条连接，也不会把用户标为离线', () => {
    const tabA = fakeWs();
    const tabB = fakeWs();
    m.registerConnection(1, 'jti-1', tabA.ws);
    m.registerConnection(1, 'jti-1', tabB.ws);

    m.removeConnection(tabA.ws);
    expect(m.isUserOnline(1)).toBe(true);
    m.sendToUser(1, PING);
    expect(tabB.send).toHaveBeenCalledTimes(1);
    expect(tabA.send).not.toHaveBeenCalled();

    m.removeConnection(tabB.ws);
    expect(m.isUserOnline(1)).toBe(false);
    const snap = m.getWsSnapshot();
    expect(snap.totalConnects).toBe(2);
    expect(snap.totalDisconnects).toBe(2);
    expect(snap.currentConnections).toBe(0);
  });

  it('断网重连：新旧连接并存期间旧 socket 迟到的 close 不影响新连接', () => {
    const stale = fakeWs();
    const fresh = fakeWs();
    m.registerConnection(1, 'jti-1', stale.ws);
    m.registerConnection(1, 'jti-1', fresh.ws);

    m.removeConnection(stale.ws);
    expect(m.isUserOnline(1)).toBe(true);
    m.sendToUser(1, PING);
    expect(fresh.send).toHaveBeenCalledTimes(1);
    expect(stale.send).not.toHaveBeenCalled();
  });

  it('closeTokenConnection 关闭该 token 全部连接，其后 socket 自身的 close 事件是幂等的', () => {
    const tabA = fakeWs();
    const tabB = fakeWs();
    const otherSession = fakeWs();
    m.registerConnection(1, 'jti-1', tabA.ws);
    m.registerConnection(1, 'jti-1', tabB.ws);
    m.registerConnection(1, 'jti-2', otherSession.ws);

    m.closeTokenConnection('jti-1', 'force-logout');
    expect(tabA.close).toHaveBeenCalledWith(1000, 'force-logout');
    expect(tabB.close).toHaveBeenCalledWith(1000, 'force-logout');
    expect(otherSession.close).not.toHaveBeenCalled();
    // 另一登录会话仍在线
    expect(m.isUserOnline(1)).toBe(true);

    m.removeConnection(tabA.ws);
    m.removeConnection(tabB.ws);
    const snap = m.getWsSnapshot();
    expect(snap.currentConnections).toBe(1);
    expect(snap.totalDisconnects).toBe(2);
    expect(snap.recentDisconnects.map((d) => d.reason)).toEqual(['force-logout', 'force-logout']);
  });

  it('closeUserConnections 关闭用户全部会话的全部连接', () => {
    const a = fakeWs();
    const b = fakeWs();
    m.registerConnection(1, 'jti-1', a.ws);
    m.registerConnection(1, 'jti-2', b.ws);
    m.closeUserConnections(1, 'disabled');
    expect(a.close).toHaveBeenCalledWith(1000, 'disabled');
    expect(b.close).toHaveBeenCalledWith(1000, 'disabled');
    expect(m.isUserOnline(1)).toBe(false);
    expect(m.getWsSnapshot().currentConnections).toBe(0);
  });
});

describe('scheduleBroadcast', () => {
  it('延后到下一个 I/O tick 才推送给全部连接', () => {
    const a = fakeWs();
    const b = fakeWs();
    m.registerConnection(1, 'ta', a.ws);
    m.registerConnection(2, 'tb', b.ws);

    m.scheduleBroadcast(PING);
    expect(a.send).not.toHaveBeenCalled();

    vi.advanceTimersByTime(0);
    expect(framesOf(a.send, PING.type)).toHaveLength(1);
    expect(framesOf(b.send, PING.type)).toHaveLength(1);
  });
});

describe('跨进程 fan-out', () => {
  type PublishedEnvelope = { v: number; from: string; kind: string } & Record<string, unknown>;

  async function publishedEnvelopes(): Promise<PublishedEnvelope[]> {
    const redis = (await import('./redis')).default as unknown as { publish: ReturnType<typeof vi.fn> };
    return redis.publish.mock.calls.map(([, raw]) => JSON.parse(raw as string) as PublishedEnvelope);
  }

  it('每个公开的发送 / 关闭函数都在本地投递之外恰好发布一封信封', async () => {
    const a = fakeWs();
    m.registerConnection(1, 'jti-1', a.ws);

    m.sendToUser(1, PING);
    m.sendToToken('jti-1', PING);
    m.broadcast(PING);
    m.closeTokenConnection('jti-1');
    m.closeUserConnections(1, 'disabled');
    m.scheduleSendToUsers([{ userId: 1 }, { userId: 2 }, { userId: 1 }], PING);
    vi.advanceTimersByTime(0);

    expect(framesOf(a.send, PING.type)).toHaveLength(3);
    const envelopes = await publishedEnvelopes();
    expect(envelopes.map((e) => e.kind)).toEqual(['user', 'token', 'broadcast', 'closeToken', 'closeUser', 'users']);
    expect(envelopes[3]).toMatchObject({ target: 'jti-1', reason: 'force-logout' });
    expect(envelopes[4]).toMatchObject({ target: 1, reason: 'disabled' });
    // 批量成员去重后一封信封
    expect(envelopes[5]).toMatchObject({ targets: [1, 2] });
    expect(new Set(envelopes.map((e) => e.from)).size).toBe(1);
  });

  it('本进程没有连接时 presence 变更仍以本地增量发布给其他进程', async () => {
    const a = fakeWs();
    m.registerConnection(1, 'ta', a.ws);
    m.removeConnection(a.ws);
    vi.advanceTimersByTime(1_000);
    expect(a.send).not.toHaveBeenCalled();
    const envelopes = await publishedEnvelopes();
    const presence = envelopes.find((e) => e.kind === 'presence');
    expect(presence).toMatchObject({ changes: [{ userId: 1, online: false, lastSeen: expect.any(Number) }] });
  });

  it('两个进程：worker 侧发出的推送经订阅到达 api 侧持有的 socket，api 自己的信封不重复投递', async () => {
    // 进程 A（api）：持有 socket 并订阅
    const fanoutA = await import('./ws-fanout');
    await fanoutA.startWsFanoutSubscriber();
    const socketOnA = fakeWs();
    m.registerConnection(42, 'jti-42', socketOnA.ws);

    // 进程 B（worker）：隔离加载第二份模块图，进程标识不同，没有任何 socket
    vi.resetModules();
    vi.doMock('./process-identity', () => ({ PROCESS_HOSTNAME: 'worker-host', PROCESS_PID: 2, PROCESS_ID: 'worker-host:2' }));
    const b = await import('./ws-manager');
    vi.doUnmock('./process-identity');

    b.sendToUser(42, PING);
    b.closeUserConnections(42, 'disabled');
    await vi.waitFor(() => expect(socketOnA.close).toHaveBeenCalledWith(1000, 'disabled'));
    expect(framesOf(socketOnA.send, PING.type)).toHaveLength(1);

    // A 自己发出的信封：本地已投递，订阅端按 from 跳过，不会出现第二帧
    const another = fakeWs();
    m.registerConnection(43, 'jti-43', another.ws);
    m.sendToUser(43, PING);
    await vi.waitFor(() => expect(fanoutA.getWsFanoutCounters().published).toBeGreaterThan(0));
    expect(framesOf(another.send, PING.type)).toHaveLength(1);
    await fanoutA.stopWsFanoutSubscriber();
  });
});

describe('跨进程 presence 合并视图', () => {
  /** 加载第二份隔离的 ws-manager（模拟另一进程），进程标识不同；可选让它也订阅 fan-out */
  async function loadPeer(nodeId: string, subscribe = true): Promise<WsManager> {
    vi.resetModules();
    vi.doMock('./process-identity', () => ({ PROCESS_HOSTNAME: nodeId, PROCESS_PID: 1, PROCESS_ID: `${nodeId}:1` }));
    const peer = await import('./ws-manager');
    if (subscribe) await (await import('./ws-fanout')).startWsFanoutSubscriber();
    vi.doUnmock('./process-identity');
    return peer;
  }

  it('另一进程上的连接算在线；它下线后本进程拿到带 lastSeen 的离线状态', async () => {
    await (await import('./ws-fanout')).startWsFanoutSubscriber();
    const observer = fakeWs();
    m.registerConnection(1, 'obs', observer.ws);

    const b = await loadPeer('node-b');
    const remoteUser = fakeWs();
    b.registerConnection(7, 'jti-7', remoteUser.ws);
    vi.advanceTimersByTime(1_000); // B 的合并窗口到期 → 发布本地增量

    expect(m.isUserOnline(7)).toBe(true);
    expect(m.getOnlineUserIds()).toEqual(expect.arrayContaining([1, 7]));
    expect(framesOf(observer.send, 'chat:presence').at(-1)).toEqual([{ userId: 7, online: true, lastSeen: null }]);

    b.removeConnection(remoteUser.ws);
    vi.advanceTimersByTime(1_000);
    expect(m.isUserOnline(7)).toBe(false);
    expect(m.getUserPresence(7)).toEqual({ userId: 7, online: false, lastSeen: expect.stringMatching(/^\d{4}-\d{2}-\d{2} /) });
  });

  it('同一用户在两个进程都在线时，一边断开不会被误报为离线', async () => {
    await (await import('./ws-fanout')).startWsFanoutSubscriber();
    const local = fakeWs();
    m.registerConnection(9, 'jti-a', local.ws);
    vi.advanceTimersByTime(1_000);

    const b = await loadPeer('node-b');
    m.startPresenceSync(); // A 立即发快照，B 据此知道 9 在 A 上
    const remote = fakeWs();
    b.registerConnection(9, 'jti-b', remote.ws);
    vi.advanceTimersByTime(1_000);

    b.removeConnection(remote.ws);
    vi.advanceTimersByTime(1_000);
    expect(m.isUserOnline(9)).toBe(true);
    expect(b.isUserOnline(9)).toBe(true);
    m.stopPresenceSync();
  });

  it('远端进程失联（不再有增量与快照）超过 TTL 后其用户视为离线并保留 lastSeen', async () => {
    await (await import('./ws-fanout')).startWsFanoutSubscriber();
    const b = await loadPeer('node-b', false);
    b.registerConnection(5, 'jti-5', fakeWs().ws);
    vi.advanceTimersByTime(1_000);
    expect(m.isUserOnline(5)).toBe(true);

    m.startPresenceSync(); // 周期任务负责淘汰失联镜像
    vi.advanceTimersByTime(120_000);
    expect(m.isUserOnline(5)).toBe(false);
    expect(m.getUserLastSeen(5)).toEqual(expect.any(Number));
    m.stopPresenceSync();
  });

  it('错过增量的进程可由对方的周期快照自愈；对方有序停机时主动宣告离线', async () => {
    const fanoutA = await import('./ws-fanout'); // 须在加载对端前拿到 A 自己的模块实例（resetModules 会换注册表）
    const b = await loadPeer('node-b', false);
    b.registerConnection(8, 'jti-8', fakeWs().ws);
    vi.advanceTimersByTime(1_000); // 此时 A 尚未订阅，增量丢失
    await fanoutA.startWsFanoutSubscriber();
    expect(m.isUserOnline(8)).toBe(false);

    b.startPresenceSync(); // 立即发一次全量快照
    expect(m.isUserOnline(8)).toBe(true);

    b.stopPresenceSync(); // 宣告本进程用户离线
    expect(m.isUserOnline(8)).toBe(false);
  });
});
