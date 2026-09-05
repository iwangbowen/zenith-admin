import { inAppMessageContract } from '@zenith/shared/messaging';
import type { InAppMessage } from '@zenith/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { removeWhere } from '@/mocks/utils/array';
import { mockInAppMessages, getNextInAppMessageId } from '@/mocks/data/in-app-messages';
import { mockInAppTemplates } from '@/mocks/data/in-app-templates';
import { mockUsers } from '@/mocks/data/users';
import { mockDateTime } from '@/mocks/utils/date';

/** 按关键词 / 类型 / 已读状态过滤（我的收件箱与管理员视角共用） */
function filterMessages(list: InAppMessage[], query: { keyword?: string; type?: InAppMessage['type']; isRead?: boolean }) {
  return list.filter((m) => {
    if (query.keyword && !m.title.includes(query.keyword) && !m.content.includes(query.keyword)) return false;
    if (query.type && m.type !== query.type) return false;
    if (query.isRead !== undefined && m.isRead !== query.isRead) return false;
    return true;
  });
}

function markRead(message: InAppMessage, now: string): boolean {
  if (message.isRead) return false;
  message.isRead = true;
  message.readAt = now;
  return true;
}

export const inAppMessagesHandlers = [
  mock(inAppMessageContract.adminList, ({ query, ok, paginate }) => {
    const filtered = filterMessages(mockInAppMessages, query).filter((m) => {
      if (query.recipientId && m.userId !== query.recipientId) return false;
      if (query.senderId && m.senderId !== query.senderId) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  mock(inAppMessageContract.adminMarkRead, ({ params, ok }) => {
    const m = mockInAppMessages.find((x) => x.id === params.id);
    if (!m) return notFound('站内信不存在', { status: 404 });
    markRead(m, mockDateTime());
    return ok(null, '已标记已读');
  }),

  mock(inAppMessageContract.adminMarkAllRead, ({ ok }) => {
    const now = mockDateTime();
    const count = mockInAppMessages.filter((m) => markRead(m, now)).length;
    return ok(null, `已标记 ${count} 条为已读`);
  }),

  mock(inAppMessageContract.adminRemove, ({ params, ok }) => {
    const idx = mockInAppMessages.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('站内信不存在', { status: 404 });
    mockInAppMessages.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  mock(inAppMessageContract.list, ({ query, ok, paginate }) => ok(paginate(filterMessages(mockInAppMessages, query)))),

  mock(inAppMessageContract.unreadCount, ({ ok }) => ok({ count: mockInAppMessages.filter((m) => !m.isRead).length })),

  mock(inAppMessageContract.detail, ({ params, ok }) => {
    const m = mockInAppMessages.find((x) => x.id === params.id);
    if (!m) return notFound('站内信不存在', { status: 404 });
    return ok(m);
  }),

  mock(inAppMessageContract.markRead, ({ params, ok }) => {
    const m = mockInAppMessages.find((x) => x.id === params.id);
    if (!m) return notFound('站内信不存在', { status: 404 });
    markRead(m, mockDateTime());
    return ok(null, '已标记已读');
  }),

  mock(inAppMessageContract.markAllRead, ({ ok }) => {
    const now = mockDateTime();
    const count = mockInAppMessages.filter((m) => markRead(m, now)).length;
    return ok(null, `已标记 ${count} 条为已读`);
  }),

  mock(inAppMessageContract.markReadBatch, ({ body, ok }) => {
    const ids = new Set(body.ids);
    const now = mockDateTime();
    const count = mockInAppMessages.filter((m) => ids.has(m.id) && markRead(m, now)).length;
    return ok(null, `已标记 ${count} 条为已读`);
  }),

  mock(inAppMessageContract.send, ({ body, ok }) => {
    const tpl = body.templateId ? mockInAppTemplates.find((t) => t.id === body.templateId) : null;
    const now = mockDateTime();
    let sentCount = 0;
    for (const uid of body.userIds) {
      const u = mockUsers.find((x) => x.id === uid);
      const msg: InAppMessage = {
        id: getNextInAppMessageId(),
        templateId: tpl?.id ?? null,
        templateName: tpl?.name ?? null,
        userId: uid,
        username: u?.nickname ?? u?.username ?? null,
        title: body.title ?? tpl?.title ?? '通知',
        content: body.content ?? tpl?.content ?? '',
        type: tpl?.type ?? body.type,
        isRead: false,
        readAt: null,
        source: 'manual',
        senderId: 1,
        senderName: '管理员',
        link: null,
        createdAt: now,
      };
      mockInAppMessages.unshift(msg);
      sentCount += 1;
    }
    return ok({ sentCount }, `已发送 ${sentCount} 条站内信`);
  }),

  mock(inAppMessageContract.removeBatch, ({ body, ok }) => {
    const ids = new Set(body.ids);
    const count = removeWhere(mockInAppMessages, (message) => ids.has(message.id));
    return ok(null, `已删除 ${count} 条记录`);
  }),

  mock(inAppMessageContract.remove, ({ params, ok }) => {
    const idx = mockInAppMessages.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('站内信不存在', { status: 404 });
    mockInAppMessages.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];