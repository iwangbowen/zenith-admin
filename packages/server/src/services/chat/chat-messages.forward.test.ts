/**
 * 转发消息的批量写入契约。
 *
 * 每个目标会话一次前置校验、批量插入、会话触碰与成员查询，会话间有界并行。
 * 这里锁定：insert 次数 = 会话数、会话内顺序 = 源消息时间序、WS 仍逐条推送、单会话失败不阻断其它会话。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';

const mocks = vi.hoisted(() => {
  const select = vi.fn();
  const insert = vi.fn();
  const update = vi.fn();
  const query = {
    chatMessages: { findMany: vi.fn() },
    users: { findMany: vi.fn(), findFirst: vi.fn() },
    chatConversations: { findFirst: vi.fn() },
    chatConversationMembers: { findFirst: vi.fn() },
  };
  const scheduleSendToUsers = vi.fn();
  return { select, insert, update, query, scheduleSendToUsers };
});

vi.mock('../../db', () => ({ db: { select: mocks.select, insert: mocks.insert, update: mocks.update, query: mocks.query } }));
vi.mock('../../lib/ws-manager', () => ({ scheduleSendToUsers: mocks.scheduleSendToUsers, sendToUser: vi.fn() }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 1, username: 'me', roles: [], tenantId: null }) }));

import { forwardMessages } from './chat-messages.service';

const T0 = new Date('2026-09-14T10:00:00Z');
const at = (sec: number) => new Date(T0.getTime() + sec * 1000);

function sourceMessage(id: number, sec: number, overrides: Record<string, unknown> = {}) {
  return {
    id, conversationId: 10, senderId: 2, type: 'text', content: `消息 ${id}`, replyToId: null, extra: null,
    isRecalled: false, isEdited: false, createdAt: at(sec), updatedAt: at(sec), ...overrides,
  };
}

/** select().from().where() 依次返回：目标会话成员资格 → 源会话成员资格 → 各会话成员 id 列表 */
function stubSelects(...results: unknown[][]) {
  const queue = [...results];
  mocks.select.mockImplementation(() => {
    const chain: Record<string, unknown> = {};
    chain.from = vi.fn(() => chain);
    chain.where = vi.fn(async () => queue.shift() ?? []);
    return chain;
  });
}

let nextId = 100;
function stubInsertReturning() {
  const valuesSpy = vi.fn();
  mocks.insert.mockImplementation(() => ({
    values: (rows: Array<Record<string, unknown>>) => {
      valuesSpy(rows);
      const list = Array.isArray(rows) ? rows : [rows];
      return {
        returning: async () => list.map((row) => ({
          replyToId: null, extra: null, isRecalled: false, isEdited: false, createdAt: at(999), updatedAt: at(999),
          ...row, id: nextId++,
        })),
      };
    },
  }));
  return valuesSpy;
}

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 100;
  mocks.update.mockImplementation(() => ({ set: () => ({ where: async () => undefined }) }));
  mocks.query.users.findFirst.mockResolvedValue({ id: 1, nickname: '我', avatar: null });
  mocks.query.users.findMany.mockResolvedValue([{ id: 2, nickname: '张三', avatar: null }]);
  mocks.query.chatConversations.findFirst.mockResolvedValue({ id: 10, type: 'group', name: '研发群', muteAll: false, members: [] });
  mocks.query.chatConversationMembers.findFirst.mockResolvedValue({ conversationId: 20, userId: 1, role: 'member', mutedUntil: null });
  // 时间乱序 + 一条系统消息：转发时按时间升序、系统消息跳过
  mocks.query.chatMessages.findMany.mockResolvedValue([
    sourceMessage(3, 30),
    sourceMessage(1, 10),
    sourceMessage(9, 20, { type: 'system', content: '张三加入了群聊' }),
    sourceMessage(2, 15, { type: 'image', content: '', extra: { asset: { fileId: 5, name: 'a.png' } } }),
  ]);
});

describe('forwardMessages —— 逐条转发', () => {
  it('每个目标会话一次 insert，行序即源消息时间序，WS 仍逐条推送', async () => {
    stubSelects(
      [{ conversationId: 20 }, { conversationId: 30 }],
      [{ conversationId: 10 }],
      [{ userId: 1 }, { userId: 5 }],
      [{ userId: 1 }, { userId: 6 }],
    );
    const values = stubInsertReturning();

    await forwardMessages({ messageIds: [1, 2, 3, 9], targetConversationIds: [20, 30], mode: 'items' });

    expect(mocks.insert).toHaveBeenCalledTimes(2);
    for (const [rows] of values.mock.calls as Array<[Array<Record<string, unknown>>]>) {
      expect(rows.map((r) => r.content)).toEqual(['消息 1', '', '消息 3']);
      expect(rows.map((r) => r.type)).toEqual(['text', 'image', 'text']);
      expect(rows[1].extra).toEqual({ asset: { fileId: 5, name: 'a.png' } });
      expect(rows.every((r) => r.senderId === 1)).toBe(true);
    }
    expect(new Set(values.mock.calls.map(([rows]) => (rows as Array<{ conversationId: number }>)[0].conversationId))).toEqual(new Set([20, 30]));
    // 会话触碰与成员列表各一次 / 会话；发送者展示信息只查一次
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(mocks.query.users.findFirst).toHaveBeenCalledTimes(1);
    // 协议不变：每条消息一个 chat:message，载荷 id 随插入顺序递增
    expect(mocks.scheduleSendToUsers).toHaveBeenCalledTimes(6);
    const byConv = new Map<number, number[]>();
    for (const [, msg] of mocks.scheduleSendToUsers.mock.calls as Array<[unknown, { type: string; payload: { id: number; conversationId: number } }]>) {
      expect(msg.type).toBe('chat:message');
      byConv.set(msg.payload.conversationId, [...(byConv.get(msg.payload.conversationId) ?? []), msg.payload.id]);
    }
    for (const ids of byConv.values()) expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('某个目标会话被禁言：该会话不写入、错误上抛，其它会话仍完成', async () => {
    stubSelects([{ conversationId: 20 }, { conversationId: 30 }], [{ conversationId: 10 }], [{ userId: 1 }]);
    mocks.query.chatMessages.findMany.mockResolvedValue([sourceMessage(1, 10)]);
    const values = stubInsertReturning();
    // 会话间并行启动顺序即数组顺序：第一次成员查询对应会话 20，第二次对应会话 30（个人禁言中）。
    // 禁言截止必须相对真实当前时间（服务用 new Date() 比较），写成固定时刻会在过期后静默变绿 / 变红
    mocks.query.chatConversationMembers.findFirst
      .mockResolvedValueOnce({ role: 'member', mutedUntil: null })
      .mockResolvedValueOnce({ role: 'member', mutedUntil: new Date(Date.now() + 3_600_000) });

    await expect(forwardMessages({ messageIds: [1], targetConversationIds: [20, 30], mode: 'items' })).rejects.toThrow(HTTPException);
    expect(values).toHaveBeenCalledTimes(1);
    expect((values.mock.calls[0][0] as Array<{ conversationId: number }>)[0].conversationId).toBe(20);
  });
});

describe('forwardMessages —— 合并转发', () => {
  it('每个目标会话一条 forward 聚合消息，预览取前三条，来源会话名随载荷', async () => {
    stubSelects([{ conversationId: 20 }], [{ conversationId: 10 }], [{ userId: 1 }]);
    const values = stubInsertReturning();

    await forwardMessages({ messageIds: [1, 2, 3, 9], targetConversationIds: [20], mode: 'merge' });

    expect(values).toHaveBeenCalledTimes(1);
    const [rows] = values.mock.calls[0] as [Array<Record<string, unknown>>];
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('forward');
    const extra = rows[0].extra as { forwardedMessages: Array<{ content: string; type: string }>; forwardSourceConvName: string };
    expect(extra.forwardSourceConvName).toBe('研发群');
    expect(extra.forwardedMessages.map((m) => m.type)).toEqual(['text', 'image', 'text']);
    expect(String(rows[0].content).split('\n')).toEqual(['张三：消息 1', '张三：[图片]', '张三：消息 3']);
    expect(mocks.scheduleSendToUsers).toHaveBeenCalledTimes(1);
  });

  it('源消息所在会话不是当前用户成员时拒绝转发', async () => {
    stubSelects([{ conversationId: 20 }], []);
    mocks.query.chatMessages.findMany.mockResolvedValue([sourceMessage(1, 10)]);
    const values = stubInsertReturning();

    await expect(forwardMessages({ messageIds: [1], targetConversationIds: [20], mode: 'items' }))
      .rejects.toThrow('无权转发所选消息');
    expect(values).not.toHaveBeenCalled();
  });
});
