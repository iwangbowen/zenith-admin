import { eq, and, desc, exists, inArray, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { inAppMessages, inAppTemplates, users, type InAppMessageRow } from '../../db/schema';
import { config } from '../../config';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { formatDateTime } from '../../lib/datetime';
import { exactTenantCondition, getEffectiveTenantId, tenantScope } from '../../lib/tenant';
import { getDataScopeCondition } from '../../lib/data-scope';
import { requireFirstRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { currentUser } from '../../lib/context';
import { renderTemplate } from '../../lib/sms-sender';
import { scheduleSendPerUser, scheduleSendToUsers } from '../../lib/ws-manager';
import type { SendInAppInput, inAppMessageContract } from '@zenith/shared/messaging';
import { notificationEventKeysInGroup } from '@zenith/shared/messaging';
import type { QueryOutputOf } from '@zenith/shared/core';
import type * as z from 'zod';

type InAppMessageListQuery = QueryOutputOf<typeof inAppMessageContract.list>;
type InAppMessageAdminListQuery = QueryOutputOf<typeof inAppMessageContract.adminList>;
type InAppMessageListFilter = Omit<InAppMessageListQuery, 'page' | 'pageSize'>;

/** 收件箱 / 管理端列表共用的筛选条件：租户范围、标题关键字、类型、已读状态 */
function buildInboxFilterWhere(q: InAppMessageListFilter) {
  return buildWhere(
    tenantScope(inAppMessages),
    keywordCondition(q.keyword, [inAppMessages.title], 'ilike'),
    q.type ? eq(inAppMessages.type, q.type) : undefined,
    typeof q.isRead === 'boolean' ? eq(inAppMessages.isRead, q.isRead) : undefined,
    q.eventGroup ? inArray(inAppMessages.eventKey, notificationEventKeysInGroup(q.eventGroup)) : undefined,
  );
}

function buildInboxWhere(q: InAppMessageListFilter, recipientId: number) {
  return buildWhere(eq(inAppMessages.userId, recipientId), buildInboxFilterWhere(q));
}

/** 历史手工站内信的收件人必须与记录同租户，才能显示或参与管理操作。 */
function managedRecipientCondition() {
  if (!config.multiTenantMode) return undefined;
  return or(ne(inAppMessages.source, 'manual'), exists(db.select({ id: users.id }).from(users).where(and(
    eq(users.id, inAppMessages.userId),
    sql`${users.tenantId} IS NOT DISTINCT FROM ${inAppMessages.tenantId}`,
  ))));
}

/** 站内信联表基础查询（消息 + 模板名 + 发送人用户名） */
function selectMessageWithJoins() {
  return db.select({
    msg: inAppMessages,
    templateName: inAppTemplates.name,
    senderName: users.username,
  })
    .from(inAppMessages)
    .leftJoin(inAppTemplates, eq(inAppMessages.templateId, inAppTemplates.id))
    .leftJoin(users, eq(inAppMessages.senderId, users.id));
}

interface JoinedMessageRow {
  msg: typeof inAppMessages.$inferSelect;
  templateName: string | null;
  senderName: string | null;
}

/** 联表行 → 站内信 DTO；username 为收件人展示名（仅管理员列表视角提供） */
function mapInAppMessageRow(r: JoinedMessageRow, username: string | null = null) {
  return {
    id: r.msg.id,
    templateId: r.msg.templateId,
    templateName: r.templateName ?? null,
    senderId: r.msg.senderId,
    senderName: r.senderName ?? null,
    userId: r.msg.userId,
    username,
    source: r.msg.source,
    eventKey: r.msg.eventKey,
    title: r.msg.title,
    content: r.msg.content,
    type: r.msg.type,
    isRead: r.msg.isRead,
    link: r.msg.link ?? null,
    readAt: r.msg.readAt ? formatDateTime(r.msg.readAt) : null,
    createdAt: formatDateTime(r.msg.createdAt),
  };
}

/** 按 id（可选限定归属用户）+ 租户范围加载站内信，不存在时抛 404 */
async function ensureInAppMessageExists(id: number, ownedBy?: number) {
  return requireFirstRow(
    db.select().from(inAppMessages)
      .where(buildWhere(
        eq(inAppMessages.id, id),
        ownedBy === undefined ? managedRecipientCondition() : eq(inAppMessages.userId, ownedBy),
        tenantScope(inAppMessages),
      ))
      .limit(1),
    '消息不存在',
  );
}

/** 当前用户的站内信收件箱 */
export async function listMyInAppMessages(q: InAppMessageListQuery) {
  const me = currentUser();
  const recipientId = me.userId;
  const where = buildInboxWhere(q, recipientId);
  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(inAppMessages, where),
    rows: () => withPagination(
      selectMessageWithJoins()
        .where(where)
        .orderBy(desc(inAppMessages.id))
        .$dynamic(),
      q.page,
      q.pageSize,
    ),
    map: (r) => mapInAppMessageRow(r),
  });
}

/** 当前用户的站内信详情 */
export async function getMyInAppMessage(id: number) {
  const me = currentUser();
  const row = await requireFirstRow(
    selectMessageWithJoins()
      .where(and(eq(inAppMessages.id, id), eq(inAppMessages.userId, me.userId), tenantScope(inAppMessages)))
      .limit(1),
    '消息不存在',
  );
  return mapInAppMessageRow(row);
}

export async function getInAppMessageBeforeAudit(id: number) {
  const row = await requireFirstRow(
    selectMessageWithJoins()
      .where(and(eq(inAppMessages.id, id), tenantScope(inAppMessages), managedRecipientCondition()))
      .limit(1),
    '消息不存在',
  );
  // 审计快照不含 username 字段，保持原有形状
  const { username: _username, ...dto } = mapInAppMessageRow(row);
  return dto;
}

/** 管理员视角：列出全租户的站内信（不限收件人） */
export async function listAllInAppMessages(q: InAppMessageAdminListQuery) {
  const where = buildWhere(
    buildInboxFilterWhere(q),
    managedRecipientCondition(),
    q.recipientId ? eq(inAppMessages.userId, q.recipientId) : undefined,
    q.senderId ? eq(inAppMessages.senderId, q.senderId) : undefined,
    q.source ? eq(inAppMessages.source, q.source) : undefined,
  );

  const sender = alias(users, 'sender');
  const recipient = alias(users, 'recipient');

  return buildListResult({
    page: q.page,
    pageSize: q.pageSize,
    count: () => db.$count(inAppMessages, where),
    rows: () => withPagination(
      db.select({
        msg: inAppMessages,
        templateName: inAppTemplates.name,
        senderName: sender.username,
        recipientName: recipient.username,
        recipientNickname: recipient.nickname,
      })
        .from(inAppMessages)
        .leftJoin(inAppTemplates, eq(inAppMessages.templateId, inAppTemplates.id))
        .leftJoin(sender, eq(inAppMessages.senderId, sender.id))
        .leftJoin(recipient, eq(inAppMessages.userId, recipient.id))
        .where(where)
        .orderBy(desc(inAppMessages.id))
        .$dynamic(),
      q.page,
      q.pageSize,
    ),
    map: (r) => mapInAppMessageRow(r, r.recipientNickname || r.recipientName || null),
  });
}

/** 管理员删除任意站内信 */
export async function adminDeleteInAppMessage(id: number) {
  const row = await ensureInAppMessageExists(id);
  await db.delete(inAppMessages).where(eq(inAppMessages.id, id));
  scheduleSendToUsers([{ userId: row.userId }], { type: 'in-app-message:deleted', payload: { id } });
}

/** 单条标记已读：已读则不落库不推送；否则写 readAt 并向收件人推送 read 事件 */
async function markMessageRead(row: Pick<InAppMessageRow, 'id' | 'userId' | 'isRead'>) {
  if (row.isRead) return { count: 0 };
  await db.update(inAppMessages).set({ isRead: true, readAt: new Date() }).where(eq(inAppMessages.id, row.id));
  scheduleSendToUsers([{ userId: row.userId }], { type: 'in-app-message:read', payload: { id: row.id } });
  return { count: 1 };
}

/** 管理员标记任意站内信为已读 */
export async function adminMarkAsRead(id: number) {
  return markMessageRead(await ensureInAppMessageExists(id));
}

/** 管理员视角：将当前租户所有未读站内信标记为已读。 */
/** 把满足条件的未读站内信批量置为已读（自动附加租户范围），返回受影响的 id 与收件人 */
async function markUnreadMessagesRead(...conditions: (SQL | undefined)[]) {
  const where = buildWhere(eq(inAppMessages.isRead, false), tenantScope(inAppMessages), ...conditions);
  return db.update(inAppMessages)
    .set({ isRead: true, readAt: new Date() })
    .where(where)
    .returning({ id: inAppMessages.id, userId: inAppMessages.userId });
}

export async function adminMarkAllAsRead() {
  const result = await markUnreadMessagesRead(managedRecipientCondition());
  const userIds = [...new Set(result.map((row) => row.userId))];
  if (userIds.length > 0) {
    scheduleSendToUsers(userIds.map((userId) => ({ userId })), { type: 'in-app-message:read-all', payload: {} });
  }
  return { count: result.length };
}

export async function unreadCount(query: QueryOutputOf<typeof inAppMessageContract.unreadCount> = {}) {
  const me = currentUser();
  const where = buildInboxWhere({ ...query, isRead: false }, me.userId);
  const total = await db.$count(inAppMessages, where);
  return { count: total };
}

export async function markAsRead(id: number) {
  const me = currentUser();
  return markMessageRead(await ensureInAppMessageExists(id, me.userId));
}

export async function markAllAsRead(input: z.output<typeof inAppMessageContract.markAllRead.body> = {}) {
  const me = currentUser();
  const result = await markUnreadMessagesRead(buildInboxWhere(input, me.userId));
  if (result.length > 0) {
    scheduleSendToUsers([{ userId: me.userId }], { type: 'in-app-message:read-all', payload: input });
  }
  return { count: result.length };
}

/** 批量标记我的站内信为已读（仅处理属于当前用户且未读的） */
export async function batchMarkAsRead(ids: number[]) {
  if (ids.length === 0) return { count: 0 };
  const me = currentUser();
  const result = await markUnreadMessagesRead(inArray(inAppMessages.id, ids), eq(inAppMessages.userId, me.userId));
  for (const row of result) {
    scheduleSendToUsers([{ userId: me.userId }], { type: 'in-app-message:read', payload: { id: row.id } });
  }
  return { count: result.length };
}

export async function deleteInAppMessage(id: number) {
  const me = currentUser();
  const row = await ensureInAppMessageExists(id, me.userId);
  await db.delete(inAppMessages).where(eq(inAppMessages.id, id));
  scheduleSendToUsers([{ userId: row.userId }], { type: 'in-app-message:deleted', payload: { id } });
}

/** 批量删除我的站内信（仅删除属于当前用户的） */
export async function batchDeleteInAppMessages(ids: number[]) {
  if (ids.length === 0) return { count: 0 };
  const me = currentUser();
  const where = buildWhere(and(
    inArray(inAppMessages.id, ids),
    eq(inAppMessages.userId, me.userId),
    tenantScope(inAppMessages),
  ));
  const result = await db.delete(inAppMessages)
    .where(where ?? sql`false`)
    .returning({ id: inAppMessages.id });
  for (const row of result) {
    scheduleSendToUsers([{ userId: me.userId }], { type: 'in-app-message:deleted', payload: { id: row.id } });
  }
  return { count: result.length };
}

async function manualRecipientCondition(senderId: number, executor: DbExecutor) {
  return and(eq(users.status, 'enabled'), await getDataScopeCondition({
    currentUserId: senderId,
    permissions: ['system:in-app-message:send'],
    deptColumn: users.departmentId,
    ownerColumn: users.id,
    executor,
  }));
}

export async function listManualInAppRecipients() {
  const actor = currentUser();
  const tenantId = getEffectiveTenantId(actor);
  const rows = await db.select({ id: users.id, nickname: users.nickname, username: users.username }).from(users)
    .where(buildWhere(
      config.multiTenantMode ? exactTenantCondition(users.tenantId, tenantId) : undefined,
      await manualRecipientCondition(actor.userId, db),
    ))
    .orderBy(users.id);
  return rows.map(({ id, nickname, username }) => ({ id, label: nickname ? `${nickname} (${username})` : username }));
}

type InAppSender = { senderId: number | null; tenantId: number | null };

/** 后台调用者传入已授权业务记录的归属，服务仍校验所有收件人与模板的租户。 */
export function sendJobInApp(input: SendInAppInput, sender: InAppSender) {
  return writeInApp(input, sender);
}

export function sendInApp(input: SendInAppInput) {
  const actor = currentUser();
  return writeInApp(input, { senderId: actor.userId, tenantId: getEffectiveTenantId(actor) },
    (tx) => manualRecipientCondition(actor.userId, tx));
}

async function writeInApp(input: SendInAppInput, { senderId, tenantId }: InAppSender, scope?: (executor: DbExecutor) => Promise<SQL | undefined>) {
  const ids = [...new Set(input.userIds)];
  const { inserted, templateId, title, content, type } = await db.transaction(async (tx) => {
    const template = input.templateId ? await requireFirstRow(tx.select().from(inAppTemplates).where(buildWhere(
      eq(inAppTemplates.id, input.templateId),
      config.multiTenantMode ? exactTenantCondition(inAppTemplates.tenantId, tenantId) : undefined,
    )).limit(1), '站内信模板不存在') : null;
    if (template && template.status !== 'enabled') throw new HTTPException(400, { message: '模板已禁用' });

    const variables = input.variables ?? {};
    const title = input.title || (template ? renderTemplate(template.title, variables) : '');
    const content = input.content || (template ? renderTemplate(template.content, variables) : '');
    const type = template?.type ?? input.type;
    const templateId = template?.id ?? null;
    if (!title || !content) throw new HTTPException(400, { message: '标题与内容不能为空' });

    const recipients = await tx.select({ id: users.id }).from(users).where(buildWhere(
      inArray(users.id, ids),
      config.multiTenantMode ? exactTenantCondition(users.tenantId, tenantId) : undefined,
      await scope?.(tx),
    )).orderBy(users.id).for('share');
    if (!ids.length || recipients.length !== ids.length) {
      throw new HTTPException(404, { message: '部分收件人不存在或超出发送范围' });
    }

    const inserted = await tx.insert(inAppMessages).values(recipients.map(({ id }) => ({
      templateId, senderId, source: 'manual' as const, userId: id, title, content, type, tenantId,
    }))).returning({ id: inAppMessages.id, userId: inAppMessages.userId, createdAt: inAppMessages.createdAt });
    return { inserted, templateId, title, content, type };
  });

  // 提交后才派发。载荷对应已持久化的消息，收件方可直接更新铃铛缓存。
  scheduleSendPerUser(inserted.map((row) => ({
    userId: row.userId,
    message: {
      type: 'in-app-message:new',
      payload: {
        id: row.id,
        templateId,
        templateName: null,
        userId: row.userId,
        username: null,
        title,
        content,
        type,
        isRead: false,
        readAt: null,
        source: 'manual',
        eventKey: null,
        senderId,
        senderName: null,
        link: null,
        createdAt: formatDateTime(row.createdAt),
      },
    },
  })));
  return { sentCount: inserted.length };
}
