/**
 * Web 终端 WebSocket 会话归属回归测试。
 *
 * 锁定的不变式：
 *  1. 会话标识由服务端生成——客户端带一个自选 ID 连接不会创建会话，只会被拒；
 *  2. handler 只操作「本连接在 onOpen 中取得的会话引用」，不按 ID 反查注册表。
 *
 * 防止同名 ID 覆盖造成 PTY 泄漏或输入串线，以及被拒连接通过 onClose / terminal:close 销毁他人会话。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const maintenance = vi.hoisted(() => ({ allowed: true }));
vi.mock('../../lib/maintenance-realtime', () => ({ maintenanceRealtimeAllowed: async () => maintenance.allowed }));

vi.mock('node-pty', () => ({ spawn: vi.fn() }));
vi.mock('ssh2', () => ({ Client: vi.fn() }));
vi.mock('node:inspector', () => ({ url: () => undefined }));
vi.mock('../../lib/ws-auth', () => ({
  // 测试替身：以 query.token = user-<id> 模拟已通过子协议鉴权的主体
  authenticateAdminWs: vi.fn(async (c: { req: { query: (k: string) => string | undefined } }) => {
    const token = c.req.query('token');
    if (!token) return null;
    const userId = Number(token.replace('user-', ''));
    return { payload: { userId, username: `u${userId}`, roles: [], tenantId: null }, nickname: `u${userId}` };
  }),
}));
vi.mock('../../lib/session-manager', () => ({ isTokenBlacklisted: vi.fn(async () => false) }));
vi.mock('../../lib/permissions', () => ({
  isSuperAdmin: () => false,
  getUserPermissions: vi.fn(async () => ['system:terminal:execute']),
}));
vi.mock('../../lib/request-helpers', () => ({ getClientIp: () => '127.0.0.1' }));
vi.mock('../../services/ops/terminal-files.service', () => ({ listShells: vi.fn() }));
vi.mock('../../services/ops/ssh-profiles.service', () => ({ getSshConnectParams: vi.fn() }));
vi.mock('../../services/ops/terminal-sessions.service', () => ({
  acquireSessionForMonitor: vi.fn(() => null),
  checkSessionQuota: vi.fn(() => null),
  newTerminalSessionId: vi.fn(() => 'server-generated-id'),
  persistNewTerminalSession: vi.fn(),
  recordTerminalSessionFailure: vi.fn(),
}));

import type { UpgradeWebSocket } from 'hono/ws';
import {
  acquireOwnedSession,
  registerSession,
  endSession,
  type ClientConn,
  type TerminalProcess,
  type TerminalSession,
} from '../../lib/terminal-session-registry';
import { createWsTerminalRoute } from './ws-terminal';

interface FakeWs extends ClientConn {
  readonly sent: string[];
  readonly closed: { code?: number }[];
}

interface WsHandlers {
  onOpen?: (evt: unknown, ws: FakeWs) => Promise<void> | void;
  onMessage?: (evt: { data: unknown }, ws: FakeWs) => void;
  onClose?: (evt?: unknown, ws?: FakeWs) => void;
}

function makeWs(): FakeWs {
  const sent: string[] = [];
  const closed: { code?: number }[] = [];
  return {
    sent,
    closed,
    send: (data: string) => { sent.push(data); },
    close: (code?: number) => { closed.push({ code }); },
  };
}

/** 捕获 upgradeWebSocket 收到的 handler 工厂，从而在测试中直接驱动生命周期回调。 */
let handlerFactory: ((c: unknown) => Promise<WsHandlers>) | null = null;
const fakeUpgrade = ((factory: (c: unknown) => Promise<WsHandlers>) => {
  handlerFactory = factory;
  return () => undefined;
}) as unknown as UpgradeWebSocket;

async function connect(query: Record<string, string>): Promise<{ handlers: WsHandlers; ws: FakeWs }> {
  createWsTerminalRoute(fakeUpgrade);
  const ctx = { req: { query: (key: string) => query[key] } };
  const handlers = await handlerFactory!(ctx);
  const ws = makeWs();
  await handlers.onOpen?.(undefined, ws);
  return { handlers, ws };
}

const VICTIM_SESSION_ID = 'victim-session-id';

function makeVictimSession(victimWs: FakeWs): { session: TerminalSession; process: TerminalProcess } {
  const proc: TerminalProcess = { write: vi.fn(), resize: vi.fn(), kill: vi.fn() };
  const session = registerSession({
    sessionId: VICTIM_SESSION_ID,
    process: proc,
    currentWs: victimWs,
    userId: 1,
    username: 'victim',
    tenantId: null,
    kind: 'local',
    label: 'bash',
    clientIp: '127.0.0.1',
  });
  if (!session) throw new Error('failed to register victim session');
  return { session, process: proc };
}

describe('terminal websocket session ownership', () => {
  beforeEach(() => {
    maintenance.allowed = true;
    endSession(VICTIM_SESSION_ID, 'client_closed');
    handlerFactory = null;
  });

  it('blocks input on an existing terminal after maintenance begins', async () => {
    const { process: proc } = makeVictimSession(makeWs());
    const { handlers, ws } = await connect({ token: 'user-1', sessionId: VICTIM_SESSION_ID, shell: 'bash' });
    maintenance.allowed = false;
    await handlers.onMessage?.({ data: JSON.stringify({ type: 'terminal:input', data: 'echo denied' }) }, ws);
    expect(proc.write).not.toHaveBeenCalled();
    expect(ws.closed).toContainEqual({ code: 1013 });
  });

  it('refuses to register over an existing session id', () => {
    const { session } = makeVictimSession(makeWs());
    const duplicate = registerSession({
      sessionId: VICTIM_SESSION_ID,
      process: { write: vi.fn(), resize: vi.fn(), kill: vi.fn() },
      currentWs: makeWs(),
      userId: 2,
      username: 'intruder',
      tenantId: null,
      kind: 'local',
      label: 'bash',
      clientIp: '127.0.0.1',
    });

    expect(duplicate).toBeNull();
    expect(acquireOwnedSession(VICTIM_SESSION_ID, 1)).toBe(session);
  });

  it('only hands out a session handle to its owner', () => {
    const { session } = makeVictimSession(makeWs());
    expect(acquireOwnedSession(VICTIM_SESSION_ID, 1)).toBe(session);
    expect(acquireOwnedSession(VICTIM_SESSION_ID, 2)).toBeNull();
  });

  it('rejects another user reusing a live session id without touching that session', async () => {
    const victimWs = makeWs();
    const { session } = makeVictimSession(victimWs);

    const { ws } = await connect({ token: 'user-2', sessionId: VICTIM_SESSION_ID, shell: 'bash' });

    expect(ws.closed).toEqual([{ code: 4004 }]);
    // 会话仍属于受害者，PTY 未被顶替
    expect(acquireOwnedSession(VICTIM_SESSION_ID, 1)).toBe(session);
    expect(session.currentWs).toBe(victimWs);
  });

  it('keeps the victim session alive when the rejected connection closes', async () => {
    const victimWs = makeWs();
    const { session } = makeVictimSession(victimWs);

    const { handlers } = await connect({ token: 'user-2', sessionId: VICTIM_SESSION_ID, shell: 'bash' });
    handlers.onClose?.();

    // 被拒连接的 onClose 不得掐断受害者输出，也不得安排销毁
    expect(session.currentWs).toBe(victimWs);
    expect(session.idleTimer).toBeNull();
    expect(acquireOwnedSession(VICTIM_SESSION_ID, 1)).toBe(session);
  });

  it('ignores terminal:close sent from a rejected connection', async () => {
    const { session, process: proc } = makeVictimSession(makeWs());

    const { handlers, ws } = await connect({ token: 'user-2', sessionId: VICTIM_SESSION_ID, shell: 'bash' });
    handlers.onMessage?.({ data: JSON.stringify({ type: 'terminal:close' }) }, ws);

    expect(acquireOwnedSession(VICTIM_SESSION_ID, 1)).toBe(session);
    expect(proc.kill).not.toHaveBeenCalled();
  });

  it('lets the owner reconnect and does not let the stale connection detach it', async () => {
    const { session } = makeVictimSession(makeWs());

    const first = await connect({ token: 'user-1', sessionId: VICTIM_SESSION_ID, shell: 'bash' });
    expect(first.ws.sent.some((m) => m.includes('terminal:reconnected'))).toBe(true);
    expect(session.currentWs).toBe(first.ws);

    // 同一用户的新连接接管会话
    const second = await connect({ token: 'user-1', sessionId: VICTIM_SESSION_ID, shell: 'bash' });
    expect(session.currentWs).toBe(second.ws);

    // 旧连接随后关闭：不得清空已被接管的 currentWs
    first.handlers.onClose?.();
    expect(session.currentWs).toBe(second.ws);
    expect(session.idleTimer).toBeNull();
  });

  it('rejects an unknown session id instead of creating one under it', async () => {
    const { ws } = await connect({ token: 'user-2', sessionId: 'id-i-made-up', shell: 'bash' });
    expect(ws.closed).toEqual([{ code: 4004 }]);
    expect(acquireOwnedSession('id-i-made-up', 2)).toBeNull();
  });
});
