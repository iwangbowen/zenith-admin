import { inAppMessageContract, notificationEventKeysInGroup, type NotificationEventGroup } from '@zenith/shared/messaging';
import type { InAppMessage } from '@zenith/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { mockInAppMessages, getNextInAppMessageId } from '@/mocks/data/in-app-messages';
import { mockInAppTemplates } from '@/mocks/data/in-app-templates';
import { mockUsers } from '@/mocks/data/users';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';
import { removeByIds, requireItem } from '@/mocks/utils/crud';
import { mockResource } from '@/mocks/utils/resource';
import { currentMockSession } from '@/mocks/utils/auth';

/** 按关键词 / 类型 / 已读状态过滤（我的收件箱与管理员视角共用） */
function filterMessages(list: InAppMessage[], query: { keyword?: string; type?: InAppMessage['type']; isRead?: boolean; eventGroup?: NotificationEventGroup }) {
  const keys = query.eventGroup ? new Set<string>(notificationEventKeysInGroup(query.eventGroup)) : null;
  return list.filter((m) => {
    if (keys && (!m.eventKey || !keys.has(m.eventKey))) return false;
    if (query.keyword && !includesKeyword(query.keyword, m.title, m.content)) return false;
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
      if (query.source && m.source !== query.source) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  mock(inAppMessageContract.adminMarkRead, ({ params, ok }) => {
    const m = requireItem(mockInAppMessages, params.id, '站内信不存在', { status: 404 });
    markRead(m, mockDateTime());
    return ok(null, '已标记已读');
  }),

  mock(inAppMessageContract.adminMarkAllRead, ({ ok }) => {
    const now = mockDateTime();
    const count = mockInAppMessages.filter((m) => markRead(m, now)).length;
    return ok(null, `已标记 ${count} 条为已读`);
  }),

  mock(inAppMessageContract.adminRemove, ({ params, ok }) => {
    requireItem(mockInAppMessages, params.id, '站内信不存在', { status: 404 });
    removeByIds(mockInAppMessages, [params.id]);
    return ok(null, '删除成功');
  }),

  mock(inAppMessageContract.list, ({ request, query, ok, paginate }) => ok(paginate(filterMessages(mockInAppMessages.filter(message => message.userId === currentMockSession(request)?.user.id), query)))),

  mock(inAppMessageContract.unreadCount, ({ request, query, ok }) => ok({ count: filterMessages(mockInAppMessages.filter(message => message.userId === currentMockSession(request)?.user.id), { ...query, isRead: false }).length })),
  ...mockResource(inAppMessageContract, {
    store: mockInAppMessages,
    notFound: '站内信不存在',
    messages: { removeBatch: (count) => `已删除 ${count} 条记录` },
    exclude: ['list'],
  }),

  mock(inAppMessageContract.markRead, ({ params, ok }) => {
    const m = requireItem(mockInAppMessages, params.id, '站内信不存在', { status: 404 });
    markRead(m, mockDateTime());
    return ok(null, '已标记已读');
  }),

  mock(inAppMessageContract.markAllRead, ({ request, body, ok }) => {
    const now = mockDateTime();
    const count = filterMessages(mockInAppMessages.filter(message => message.userId === currentMockSession(request)?.user.id), body).filter(message => markRead(message, now)).length;
    return ok({ count }, `已标记 ${count} 条为已读`);
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
        eventKey: null,
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
];
