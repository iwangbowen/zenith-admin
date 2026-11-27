import { inAppMessageContract, notificationEventKeysInGroup, type NotificationEventGroup } from '@zenith/shared/messaging';
import type { InAppMessage } from '@zenith/shared/messaging';
import { flattenTree } from '@zenith/shared/core';
import { mock, MockHttpError } from '@/mocks/utils/contract';
import { forbidden, notFound, unauthorized } from '@/mocks/utils/handlers';
import { mockInAppMessages, getNextInAppMessageId } from '@/mocks/data/in-app-messages';
import { mockInAppTemplates } from '@/mocks/data/in-app-templates';
import { mockUsers } from '@/mocks/data/users';
import { mockDepartments } from '@/mocks/data/departments';
import { mockUserDataScopes, mockUserDeptScopes, mockUserPermissionCodes } from '@/mocks/data/access';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';
import { removeByIds, requireItem } from '@/mocks/utils/crud';
import { mockResource } from '@/mocks/utils/resource';
import { currentMockSession, isMockPlatformAdmin, mockUserAccess } from '@/mocks/utils/auth';
import { config } from '@/config';

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

function manualRecipients(request: Request) {
  const session = currentMockSession(request);
  if (!session) throw new MockHttpError(unauthorized('请先登录', { status: 401 }));
  const sender = session.user;
  const platform = isMockPlatformAdmin(sender);
  const permission = 'system:in-app-message:send';
  const access = mockUserAccess(sender);
  if (!platform && !access.permissions.includes(permission)) {
    throw new MockHttpError(forbidden('权限不足', { status: 403 }));
  }

  const tenantId = platform ? session.viewingTenantId ?? null : sender.tenantId ?? null;
  const sources = [
    ...access.roles.filter(role => role.permissionCodes?.includes(permission)),
    ...access.grants.filter(grant => grant.permissionCode === permission),
    { dataScope: mockUserDataScopes[sender.id], deptScopeIds: mockUserDeptScopes[sender.id] },
  ];
  const scopes = new Set(sources.map(source => source.dataScope).filter(Boolean));
  const departments = flattenTree(mockDepartments);
  const deptIds = new Set(sources.filter(source => source.dataScope === 'custom').flatMap(source => source.deptScopeIds ?? []));
  if (sender.departmentId != null && (scopes.has('dept') || scopes.has('dept_only'))) deptIds.add(sender.departmentId);
  if (scopes.has('dept') && sender.departmentId != null) {
    const descendants = new Set([sender.departmentId]);
    for (const id of descendants) {
      for (const department of departments) if (department.parentId === id) descendants.add(department.id);
    }
    for (const id of descendants) deptIds.add(id);
  }
  const includeSelf = !scopes.size || scopes.has('self') || mockUserPermissionCodes[sender.id]?.includes(permission)
    || (!sender.departmentId && (scopes.has('dept') || scopes.has('dept_only'))) || (scopes.has('custom') && !deptIds.size);
  const recipients = mockUsers.filter(user => user.status === 'enabled'
    && (!config.multiTenantMode || (user.tenantId ?? null) === tenantId)
    && (platform || scopes.has('all') || (includeSelf && user.id === sender.id)
      || (user.departmentId != null && deptIds.has(user.departmentId))));
  return { sender, recipients };
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
  mock(inAppMessageContract.recipients, ({ request, ok }) => ok(manualRecipients(request).recipients.map(({ id, nickname, username }) => ({
    id, label: nickname ? `${nickname} (${username})` : username,
  })))),
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

  mock(inAppMessageContract.send, ({ request, body, ok }) => {
    const { sender, recipients } = manualRecipients(request);
    const ids = new Set(body.userIds);
    const selected = recipients.filter(user => ids.has(user.id));
    if (selected.length !== ids.size) return notFound('部分收件人不存在或超出发送范围', { status: 404 });
    const tpl = body.templateId ? mockInAppTemplates.find((t) => t.id === body.templateId) : null;
    const now = mockDateTime();
    for (const user of selected) {
      const msg: InAppMessage = {
        id: getNextInAppMessageId(),
        templateId: tpl?.id ?? null,
        templateName: tpl?.name ?? null,
        userId: user.id,
        username: user.nickname || user.username,
        title: body.title ?? tpl?.title ?? '通知',
        content: body.content ?? tpl?.content ?? '',
        type: tpl?.type ?? body.type,
        isRead: false,
        readAt: null,
        source: 'manual',
        eventKey: null,
        senderId: sender.id,
        senderName: sender.username,
        link: null,
        createdAt: now,
      };
      mockInAppMessages.unshift(msg);
    }
    return ok({ sentCount: selected.length }, `已发送 ${selected.length} 条站内信`);
  }),
];
