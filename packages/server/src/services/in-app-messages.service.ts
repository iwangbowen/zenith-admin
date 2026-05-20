import { eq, and, ilike, desc, inArray, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { inAppMessages, inAppTemplates, users } from '../db/schema';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { formatDateTime } from '../lib/datetime';
import { tenantScope, currentCreateTenantId } from '../lib/tenant';
import { currentUser } from '../lib/context';
import { renderTemplate } from '../lib/sms-sender';
import { ensureInAppTemplateExists } from './in-app-templates.service';
import type { InAppMessageType, SendInAppInput } from '@zenith/shared';

export interface ListInAppMessagesQuery {
  keyword?: string;
  type?: InAppMessageType;
  isRead?: boolean;
  recipientId?: number; // 默认为当前用户
  page: number;
  pageSize: number;
}

function buildWhere(q: ListInAppMessagesQuery, recipientId: number) {
  const conditions: SQL[] = [eq(inAppMessages.userId, recipientId)];
  const tenant = tenantScope(inAppMessages);
  if (tenant) conditions.push(tenant);
  if (q.keyword) conditions.push(ilike(inAppMessages.title, `%${escapeLike(q.keyword)}%`));
  if (q.type) conditions.push(eq(inAppMessages.type, q.type));
  if (typeof q.isRead === 'boolean') conditions.push(eq(inAppMessages.isRead, q.isRead));
  return mergeWhere(and(...conditions));
}

/** 当前用户的站内信收件箱 */
export async function listMyInAppMessages(q: ListInAppMessagesQuery) {
  const me = currentUser();
  const recipientId = q.recipientId ?? me.userId;
  const where = buildWhere(q, recipientId);
  const rows = await withPagination(
    db.select({
      msg: inAppMessages,
      templateName: inAppTemplates.name,
      senderName: users.username,
    })
      .from(inAppMessages)
      .leftJoin(inAppTemplates, eq(inAppMessages.templateId, inAppTemplates.id))
      .leftJoin(users, eq(inAppMessages.senderId, users.id))
      .where(where)
      .orderBy(desc(inAppMessages.id))
      .$dynamic(),
    q.page,
    q.pageSize,
  );
  const total = await db.$count(inAppMessages, where);
  return {
    list: rows.map((r) => ({
      id: r.msg.id,
      templateId: r.msg.templateId,
      templateName: r.templateName ?? null,
      senderId: r.msg.senderId,
      senderName: r.senderName ?? null,
      userId: r.msg.userId,
      username: null,
      source: r.msg.source,
      title: r.msg.title,
      content: r.msg.content,
      type: r.msg.type,
      isRead: r.msg.isRead,
      readAt: r.msg.readAt ? formatDateTime(r.msg.readAt) : null,
      createdAt: formatDateTime(r.msg.createdAt),
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function unreadCount(userId?: number) {
  const me = currentUser();
  const targetId = userId ?? me.userId;
  const where = mergeWhere(and(
    eq(inAppMessages.userId, targetId),
    eq(inAppMessages.isRead, false),
    tenantScope(inAppMessages),
  ));
  const total = await db.$count(inAppMessages, where);
  return { count: total };
}

export async function markAsRead(id: number) {
  const me = currentUser();
  const [row] = await db.select().from(inAppMessages)
    .where(and(eq(inAppMessages.id, id), eq(inAppMessages.userId, me.userId), tenantScope(inAppMessages))).limit(1);
  if (!row) throw new HTTPException(404, { message: '消息不存在' });
  if (row.isRead) return { count: 0 };
  await db.update(inAppMessages).set({ isRead: true, readAt: new Date() }).where(eq(inAppMessages.id, id));
  return { count: 1 };
}

export async function markAllAsRead() {
  const me = currentUser();
  const where = mergeWhere(and(
    eq(inAppMessages.userId, me.userId),
    eq(inAppMessages.isRead, false),
    tenantScope(inAppMessages),
  ));
  const result = await db.update(inAppMessages)
    .set({ isRead: true, readAt: new Date() })
    .where(where ?? sql`true`)
    .returning({ id: inAppMessages.id });
  return { count: result.length };
}

export async function deleteInAppMessage(id: number) {
  const me = currentUser();
  const [row] = await db.select().from(inAppMessages)
    .where(and(eq(inAppMessages.id, id), eq(inAppMessages.userId, me.userId), tenantScope(inAppMessages))).limit(1);
  if (!row) throw new HTTPException(404, { message: '消息不存在' });
  await db.delete(inAppMessages).where(eq(inAppMessages.id, id));
}

/** 发送站内信（向多名用户批量发送） */
export async function sendInApp(input: SendInAppInput) {
  let title = input.title ?? '';
  let content = input.content ?? '';
  let type: InAppMessageType = input.type;
  let templateId: number | null = null;

  if (input.templateId) {
    const tpl = await ensureInAppTemplateExists(input.templateId);
    if (tpl.status !== 'enabled') {
      throw new HTTPException(400, { message: '模板已禁用' });
    }
    templateId = tpl.id;
    type = tpl.type;
    const vars = input.variables ?? {};
    title = renderTemplate(tpl.title, vars);
    content = renderTemplate(tpl.content, vars);
  }
  if (!title || !content) {
    throw new HTTPException(400, { message: '标题与内容不能为空' });
  }

  // 校验收件人存在
  const recipients = await db.select({ id: users.id }).from(users).where(inArray(users.id, input.userIds));
  if (recipients.length === 0) {
    throw new HTTPException(400, { message: '收件人不存在' });
  }

  const me = currentUser();
  const tenantId = currentCreateTenantId();
  const rows = recipients.map((r) => ({
    templateId,
    senderId: me.userId,
    userId: r.id,
    title,
    content,
    type,
    isRead: false,
    tenantId,
  }));
  await db.insert(inAppMessages).values(rows);
  return { sentCount: rows.length };
}
