import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Context } from 'hono';
import { WSContext, type UpgradeWebSocket, type WSEvents } from 'hono/ws';

const identity = vi.hoisted(() => ({ memberIds: [1, 2] }));
vi.mock('../../lib/ws-auth', () => ({ authenticateAdminWs: async () => ({ payload: { userId: 1, jti: 'ws-test' }, nickname: '测试用户' }) }));
vi.mock('../../lib/request-helpers', () => ({ getClientIp: () => '127.0.0.1' }));
vi.mock('../../lib/chat-member-cache', () => ({ getConversationMemberIds: async () => identity.memberIds }));
vi.mock('../../lib/rtc-manager', () => ({ getCallConversation: () => null, joinRoom: () => null, leaveAllRooms: () => [], leaveRoom: vi.fn() }));

let events: WSEvents;
let manager: typeof import('../../lib/ws-manager');
let socket: WSContext;
let send: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.resetModules();
  identity.memberIds = [1, 2];
  manager = await import('../../lib/ws-manager');
  const { createWsRoute } = await import('./ws');
  const upgrade = ((createEvents: (c: Context) => WSEvents | Promise<WSEvents>) => async (c: Context) => {
    events = await createEvents(c);
    return c.text('upgraded');
  }) as UpgradeWebSocket;
  await createWsRoute(upgrade).request('/');
  send = vi.fn();
  socket = new WSContext({ readyState: 1, send, close: vi.fn() });
  events.onOpen?.(new Event('open'), socket);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

const receive = async (data: string) => events.onMessage?.({ data } as MessageEvent, socket);

describe('WS 入站协议采样', () => {
  it('ping / pong 保活成功，畸形JSON、未知类型与非法业务payload如实标记拒绝', async () => {
    await receive('{broken-json');
    await receive('{}');
    await receive(JSON.stringify({ type: 'unregistered' }));
    await receive(JSON.stringify({ type: 'chat:typing', payload: { conversationId: -1 } }));
    await receive(JSON.stringify({ type: 'ping' }));
    const snap = manager.getWsSnapshot();
    expect(snap).toMatchObject({ totalRecv: 5, totalSent: 1 });
    expect(snap.messages).toHaveLength(4);
    expect(snap.messages.every((message) => !message.success)).toBe(true);
    expect(snap.exceptionMessages).toHaveLength(4);
    expect(snap.controlMessages.map((message) => [message.type, message.success])).toEqual([['pong', true], ['ping', true]]);
    expect(snap.heartbeats[0]).toMatchObject({ pingCount: 1, pongCount: 1, failedCount: 0 });
  });

  it('限速丢帧仍记recv、保活和心跳失败，不发送多余pong', async () => {
    for (let i = 0; i < 121; i += 1) await receive(JSON.stringify({ type: 'ping' }));
    const snap = manager.getWsSnapshot();
    expect(snap).toMatchObject({ totalRecv: 121, totalSent: 120 });
    expect(snap.messages).toEqual([]);
    expect(snap.exceptionMessages).toHaveLength(1);
    expect(snap.exceptionMessages[0]).toMatchObject({ type: 'ping', success: false });
    expect(snap.heartbeats[0]).toMatchObject({ pingCount: 121, pongCount: 120, failedCount: 1 });
  });

  it('pong写出失败只算异常，不冒充成功发送；协议通过不等于业务成员校验通过', async () => {
    send.mockImplementationOnce(() => { throw new Error('socket write failed'); });
    await receive(JSON.stringify({ type: 'ping' }));
    identity.memberIds = [];
    await receive(JSON.stringify({ type: 'chat:typing', payload: { conversationId: 10 } }));
    const snap = manager.getWsSnapshot();
    expect(snap).toMatchObject({ totalRecv: 2, totalSent: 0 });
    expect(snap.exceptionMessages).toHaveLength(1);
    expect(snap.exceptionMessages[0]).toMatchObject({ type: 'pong', success: false });
    expect(snap.heartbeats[0]).toMatchObject({ pingCount: 1, pongCount: 0, failedCount: 1 });
    expect(snap.messages[0]).toMatchObject({ type: 'chat:typing', success: true });
  });
});
