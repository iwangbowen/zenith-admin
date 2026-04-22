import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { desc, eq, like, and, or, sql, gte, lte, inArray } from 'drizzle-orm';
import { db } from '../db';
import { notices, noticeReads, noticeRecipients, users, userRoles, roles, departments } from '../db/schema';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';
import { broadcast, sendToUser } from '../lib/ws-manager';
import type { JwtPayload } from '../middleware/auth';
import { noticeRecipientSchema } from '@zenith/shared';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { apiResponse, ErrorResponse, MessageResponse, PaginationQuery, paginatedResponse, jsonContent, validationHook, commonErrorResponses } from '../lib/openapi-schemas';

type Env = { Variables: { user: JwtPayload } };
const noticesRouter = new OpenAPIHono<Env>({ defaultHook: validationHook });
noticesRouter.use('*', authMiddleware);

const NoticeDTO = z.looseObject({}).openapi('Notice');
const NoticeReadStatsDTO = z.looseObject({}).openapi('NoticeReadStats');

const createNoticeSchema = z.object({
  title: z.string().min(1).max(128),
  content: z.string().min(1).max(4096),
  type: z.string().min(1).max(32).default('notice'),
  publishStatus: z.enum(['draft', 'published', 'recalled']).default('draft'),
  priority: z.string().min(1).max(32).default('medium'),
  targetType: z.enum(['all', 'specific']).default('all'),
  recipients: z.array(noticeRecipientSchema).optional().default([]),
  publishTime: z.string().datetime({ offset: true }).optional().nullable(),
});
const updateNoticeSchema = createNoticeSchema.partial();

function toNotice(row: typeof notices.$inferSelect) {
  return {
    ...row,
    targetType: row.targetType as 'all' | 'specific',
    publishTime: row.publishTime ? row.publishTime.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function buildAccessFilter(userId: number) {
  return or(
    eq(notices.targetType, 'all'),
    sql`EXISTS (
      SELECT 1 FROM notice_recipients nr
      WHERE nr.notice_id = ${notices.id}
      AND (
        (nr.recipient_type = 'user' AND nr.recipient_id = ${userId})
        OR (nr.recipient_type = 'role' AND nr.recipient_id IN (
          SELECT role_id FROM user_roles WHERE user_id = ${userId}
        ))
        OR (nr.recipient_type = 'dept' AND nr.recipient_id = (
          SELECT department_id FROM users WHERE id = ${userId}
        ))
      )
    )`,
  );
}

async function saveRecipients(noticeId: number, recipientList: Array<{ recipientType: string; recipientId: number }>) {
  await db.delete(noticeRecipients).where(eq(noticeRecipients.noticeId, noticeId));
  if (recipientList.length > 0) {
    await db.insert(noticeRecipients).values(
      recipientList.map((r) => ({ noticeId, recipientType: r.recipientType, recipientId: r.recipientId })),
    ).onConflictDoNothing();
  }
}

async function broadcastNotice(notice: ReturnType<typeof toNotice>, noticeId: number) {
  if (notice.targetType === 'all') {
    broadcast({ type: 'notice:new', payload: notice });
    return;
  }
  const recipientRows = await db.select().from(noticeRecipients).where(eq(noticeRecipients.noticeId, noticeId));
  const userIdSet = new Set<number>();
  recipientRows.filter((r) => r.recipientType === 'user').forEach((r) => userIdSet.add(r.recipientId));
  const roleIds = recipientRows.filter((r) => r.recipientType === 'role').map((r) => r.recipientId);
  if (roleIds.length > 0) {
    const roleUsers = await db.select({ userId: userRoles.userId }).from(userRoles).where(inArray(userRoles.roleId, roleIds));
    roleUsers.forEach((r) => userIdSet.add(r.userId));
  }
  const deptIds = recipientRows.filter((r) => r.recipientType === 'dept').map((r) => r.recipientId);
  if (deptIds.length > 0) {
    const deptUsers = await db.select({ id: users.id }).from(users).where(inArray(users.departmentId, deptIds));
    deptUsers.forEach((u) => userIdSet.add(u.id));
  }
  for (const uid of userIdSet) sendToUser(uid, { type: 'notice:new', payload: notice });
}

// GET /published
const publishedRoute = createRoute({
  method: 'get',
  path: '/published',
  tags: ['Notices'],
  summary: '最近 20 条已发布通知',
  security: [{ BearerAuth: [] }],
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(z.array(NoticeDTO))), description: 'ok' },
  },
});
noticesRouter.openapi(publishedRoute, async (c) => {
  const user = c.get('user');
  const tc = tenantCondition(notices, user);
  const accessFilter = buildAccessFilter(user.userId);
  const publishedWhere = and(eq(notices.publishStatus, 'published'), accessFilter, ...(tc ? [tc] : []));
  const rows = await db.select().from(notices).where(publishedWhere).orderBy(desc(notices.publishTime)).limit(20);
  const readRows = await db.select({ noticeId: noticeReads.noticeId }).from(noticeReads).where(eq(noticeReads.userId, user.userId));
  const readSet = new Set(readRows.map((r) => r.noticeId));
  const data = rows.map((row) => ({ ...toNotice(row), isRead: readSet.has(row.id) }));
  return c.json({ code: 0 as const, message: 'ok', data }, 200);
});

// POST /{id}/read
const readRoute = createRoute({
  method: 'post',
  path: '/{id}/read',
  tags: ['Notices'],
  summary: '标记已读',
  security: [{ BearerAuth: [] }],
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: 'ok' },
  },
});
noticesRouter.openapi(readRoute, async (c) => {
  const user = c.get('user');
  const { id } = c.req.valid('param');
  await db.insert(noticeReads).values({ noticeId: id, userId: user.userId }).onConflictDoNothing();
  return c.json({ code: 0 as const, message: 'ok', data: null }, 200);
});

// POST /read-all
const readAllRoute = createRoute({
  method: 'post',
  path: '/read-all',
  tags: ['Notices'],
  summary: '全部标记已读',
  security: [{ BearerAuth: [] }],
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: 'ok' },
  },
});
noticesRouter.openapi(readAllRoute, async (c) => {
  const user = c.get('user');
  const accessFilter = buildAccessFilter(user.userId);
  const allPublished = await db.select({ id: notices.id }).from(notices).where(and(eq(notices.publishStatus, 'published'), accessFilter));
  if (allPublished.length === 0) return c.json({ code: 0 as const, message: 'ok', data: null }, 200);
  const readRows = await db.select({ noticeId: noticeReads.noticeId }).from(noticeReads).where(eq(noticeReads.userId, user.userId));
  const readSet = new Set(readRows.map((r) => r.noticeId));
  const unreadIds = allPublished.filter((n) => !readSet.has(n.id)).map((n) => n.id);
  if (unreadIds.length > 0) {
    await db.insert(noticeReads).values(unreadIds.map((noticeId) => ({ noticeId, userId: user.userId }))).onConflictDoNothing();
  }
  return c.json({ code: 0 as const, message: 'ok', data: null }, 200);
});

// GET /inbox
const inboxRoute = createRoute({
  method: 'get',
  path: '/inbox',
  tags: ['Notices'],
  summary: '收件箱',
  security: [{ BearerAuth: [] }],
  request: { query: PaginationQuery.extend({ isRead: z.string().optional() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(paginatedResponse(NoticeDTO)), description: 'ok' },
  },
});
noticesRouter.openapi(inboxRoute, async (c) => {
  const user = c.get('user');
  const { page = 1, pageSize = 10, isRead } = c.req.valid('query');
  const tc = tenantCondition(notices, user);
  const accessFilter = buildAccessFilter(user.userId);
  const publishedWhere = and(eq(notices.publishStatus, 'published'), accessFilter, ...(tc ? [tc] : []));
  const [readRows, allRows] = await Promise.all([
    db.select({ noticeId: noticeReads.noticeId }).from(noticeReads).where(eq(noticeReads.userId, user.userId)),
    db.select().from(notices).where(publishedWhere).orderBy(desc(notices.publishTime)),
  ]);
  const readSet = new Set(readRows.map((r) => r.noticeId));
  let list = allRows.map((row) => ({ ...toNotice(row), isRead: readSet.has(row.id) }));
  if (isRead === 'true') list = list.filter((n) => n.isRead);
  else if (isRead === 'false') list = list.filter((n) => !n.isRead);
  const total = list.length;
  const paged = list.slice((page - 1) * pageSize, page * pageSize);
  return c.json({ code: 0 as const, message: 'ok', data: { list: paged, total, page, pageSize } }, 200);
});

// GET /
const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Notices'],
  summary: '通知列表（管理）',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:notice:list' })] as const,
  request: { query: PaginationQuery.extend({ title: z.string().optional(), type: z.string().optional(), publishStatus: z.string().optional(), startTime: z.string().optional(), endTime: z.string().optional() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(paginatedResponse(NoticeDTO)), description: 'ok' },
  },
});
noticesRouter.openapi(listRoute, async (c) => {
  const { page = 1, pageSize = 10, title, type, publishStatus, startTime, endTime } = c.req.valid('query');
  const conditions = [];
  if (title) conditions.push(like(notices.title, `%${title}%`));
  if (type) conditions.push(eq(notices.type, type));
  if (publishStatus) conditions.push(eq(notices.publishStatus, publishStatus));
  if (startTime) conditions.push(gte(notices.createdAt, new Date(startTime)));
  if (endTime) conditions.push(lte(notices.createdAt, new Date(endTime)));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const user = c.get('user');
  const tc = tenantCondition(notices, user);
  const finalWhere = where && tc ? and(where, tc) : (tc ?? where);
  const [{ count }] = await db.select({ count: sql<number>`cast(count(*) as integer)` }).from(notices).where(finalWhere);
  const rows = await db.select().from(notices).where(finalWhere).orderBy(desc(notices.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  const noticeIds = rows.map((r) => r.id);
  const readCountRows = noticeIds.length > 0
    ? await db.select({ noticeId: noticeReads.noticeId, cnt: sql<number>`cast(count(*) as integer)` }).from(noticeReads).where(inArray(noticeReads.noticeId, noticeIds)).groupBy(noticeReads.noticeId)
    : [];
  const readCountMap = new Map(readCountRows.map((r) => [r.noticeId, r.cnt]));
  return c.json({
    code: 0 as const,
    message: 'ok',
    data: { list: rows.map((r) => ({ ...toNotice(r), readCount: readCountMap.get(r.id) ?? 0 })), total: Number(count), page, pageSize },
  }, 200);
});

// GET /export
const exportRouteDef = createRoute({
  method: 'get',
  path: '/export',
  tags: ['Notices'],
  summary: '导出',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:notice:list' })] as const,
  responses: {
    ...commonErrorResponses,
    200: { content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.string() } }, description: 'Excel' },
  },
});
noticesRouter.openapi(exportRouteDef, async (c) => {
  const rows = await db.select().from(notices).where(tenantCondition(notices, c.get('user'))).orderBy(desc(notices.id));
  const buffer = await exportToExcel(
    [
      { header: 'ID', key: 'id', width: 8 },
      { header: '标题', key: 'title', width: 24 },
      { header: '类型', key: 'type', width: 12 },
      { header: '优先级', key: 'priority', width: 10 },
      { header: '发布状态', key: 'publishStatus', width: 12 },
      { header: '创建人', key: 'createByName', width: 14 },
      { header: '创建时间', key: 'createdAt', width: 22 },
    ],
    rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    '通知公告',
  );
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=notices.xlsx');
  return c.body(buffer) as never;
});

// DELETE /batch
const batchDeleteRoute = createRoute({
  method: 'delete',
  path: '/batch',
  tags: ['Notices'],
  summary: '批量删除',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:notice:delete', audit: { description: '批量删除通知公告', module: '通知公告' } })] as const,
  request: { body: { content: jsonContent(z.object({ ids: z.array(z.number().int()) })), required: true } },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: '删除成功' },
    400: { content: jsonContent(ErrorResponse), description: '参数错误' },
  },
});
noticesRouter.openapi(batchDeleteRoute, async (c) => {
  const { ids } = c.req.valid('json');
  if (!Array.isArray(ids) || ids.length === 0) return c.json({ code: 400, message: '请选择要删除的通知', data: null }, 400);
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) return c.json({ code: 400, message: '通知ID格式无效', data: null }, 400);
  await db.delete(notices).where(and(inArray(notices.id, validIds), tenantCondition(notices, c.get('user'))));
  return c.json({ code: 0 as const, message: `已删除 ${validIds.length} 条通知`, data: null }, 200);
});

// GET /{id}/read-stats
const readStatsRoute = createRoute({
  method: 'get',
  path: '/{id}/read-stats',
  tags: ['Notices'],
  summary: '阅读统计',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:notice:list' })] as const,
  request: { params: z.object({ id: z.coerce.number() }), query: PaginationQuery.extend({ tab: z.string().optional() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(NoticeReadStatsDTO)), description: 'ok' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
noticesRouter.openapi(readStatsRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { page = 1, pageSize = 10, tab: rawTab } = c.req.valid('query');
  const tab = rawTab === 'unread' ? 'unread' : 'read';
  const authUser = c.get('user');
  const [notice] = await db.select().from(notices).where(eq(notices.id, id));
  if (!notice) return c.json({ code: 404, message: '通知不存在', data: null }, 404);

  const reads = await db.select({ userId: noticeReads.userId, readAt: noticeReads.readAt }).from(noticeReads).where(eq(noticeReads.noticeId, id));
  const readMap = new Map(reads.map((r) => [r.userId, r.readAt]));

  let targetUserIds: number[];
  if (notice.targetType === 'all') {
    const tc = tenantCondition(users, authUser);
    const allUsers = await db.select({ id: users.id }).from(users).where(and(eq(users.status, 'active'), ...(tc ? [tc] : [])));
    targetUserIds = allUsers.map((u) => u.id);
  } else {
    const recipients = await db.select().from(noticeRecipients).where(eq(noticeRecipients.noticeId, id));
    const userIdSet = new Set<number>();
    recipients.filter((r) => r.recipientType === 'user').forEach((r) => userIdSet.add(r.recipientId));
    const roleIds = recipients.filter((r) => r.recipientType === 'role').map((r) => r.recipientId);
    if (roleIds.length > 0) {
      const roleUsers = await db.select({ userId: userRoles.userId }).from(userRoles).where(inArray(userRoles.roleId, roleIds));
      roleUsers.forEach((r) => userIdSet.add(r.userId));
    }
    const deptIds = recipients.filter((r) => r.recipientType === 'dept').map((r) => r.recipientId);
    if (deptIds.length > 0) {
      const deptUsers = await db.select({ id: users.id }).from(users).where(inArray(users.departmentId, deptIds));
      deptUsers.forEach((u) => userIdSet.add(u.id));
    }
    targetUserIds = [...userIdSet];
  }

  const readCount = targetUserIds.filter((uid) => readMap.has(uid)).length;
  const totalCount = targetUserIds.length;
  const filteredIds = tab === 'read'
    ? targetUserIds.filter((uid) => readMap.has(uid))
    : targetUserIds.filter((uid) => !readMap.has(uid));
  const total = filteredIds.length;
  const pagedIds = filteredIds.slice((page - 1) * pageSize, page * pageSize);

  let list: Array<{ id: number; username: string; nickname: string; avatar: string | null; readAt?: string }> = [];
  if (pagedIds.length > 0) {
    const userRows = await db.select({ id: users.id, username: users.username, nickname: users.nickname, avatar: users.avatar }).from(users).where(inArray(users.id, pagedIds));
    const userMap = new Map(userRows.map((u) => [u.id, u]));
    list = pagedIds
      .map((uid) => userMap.get(uid))
      .filter((u): u is NonNullable<typeof u> => u !== undefined)
      .map((u) => ({
        id: u.id, username: u.username, nickname: u.nickname, avatar: u.avatar,
        ...(tab === 'read' ? { readAt: readMap.get(u.id)?.toISOString() } : {}),
      }));
  }

  return c.json({ code: 0 as const, message: 'ok', data: { readCount, totalCount, list, total, page, pageSize } }, 200);
});

// GET /{id}
const detailRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Notices'],
  summary: '详情',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:notice:list' })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(NoticeDTO)), description: 'ok' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
noticesRouter.openapi(detailRoute, async (c) => {
  const { id } = c.req.valid('param');
  const [row] = await db.select().from(notices).where(and(eq(notices.id, id), tenantCondition(notices, c.get('user'))));
  if (!row) return c.json({ code: 404, message: '通知不存在', data: null }, 404);
  const recipientRows = await db.select().from(noticeRecipients).where(eq(noticeRecipients.noticeId, id));
  const userIds = recipientRows.filter((r) => r.recipientType === 'user').map((r) => r.recipientId);
  const roleIds = recipientRows.filter((r) => r.recipientType === 'role').map((r) => r.recipientId);
  const deptIds = recipientRows.filter((r) => r.recipientType === 'dept').map((r) => r.recipientId);
  const [userRows, roleRows, deptRows] = await Promise.all([
    userIds.length ? db.select({ id: users.id, label: users.nickname }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([]),
    roleIds.length ? db.select({ id: roles.id, label: roles.name }).from(roles).where(inArray(roles.id, roleIds)) : Promise.resolve([]),
    deptIds.length ? db.select({ id: departments.id, label: departments.name }).from(departments).where(inArray(departments.id, deptIds)) : Promise.resolve([]),
  ]);
  const labelMap = new Map([
    ...userRows.map((r) => [`user:${r.id}`, r.label ?? ''] as [string, string]),
    ...roleRows.map((r) => [`role:${r.id}`, r.label] as [string, string]),
    ...deptRows.map((r) => [`dept:${r.id}`, r.label] as [string, string]),
  ]);
  const recipients = recipientRows.map((r) => ({
    recipientType: r.recipientType,
    recipientId: r.recipientId,
    recipientLabel: labelMap.get(`${r.recipientType}:${r.recipientId}`) ?? '',
  }));
  return c.json({ code: 0 as const, message: 'ok', data: { ...toNotice(row), recipients } }, 200);
});

// POST /
const createRouteDef = createRoute({
  method: 'post',
  path: '/',
  tags: ['Notices'],
  summary: '创建通知',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:notice:create', audit: { description: '创建通知公告', module: '通知公告' } })] as const,
  request: { body: { content: jsonContent(createNoticeSchema), required: true } },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(NoticeDTO)), description: '创建成功' },
  },
});
noticesRouter.openapi(createRouteDef, async (c) => {
  const user = c.get('user');
  const data = c.req.valid('json');
  const now = new Date();
  let publishTime: Date | null = null;
  if (data.publishTime) publishTime = new Date(data.publishTime);
  else if (data.publishStatus === 'published') publishTime = now;

  const [row] = await db.insert(notices).values({
    title: data.title,
    content: data.content,
    type: data.type,
    publishStatus: data.publishStatus,
    priority: data.priority,
    targetType: data.targetType ?? 'all',
    publishTime,
    createById: user?.userId ?? null,
    createByName: user?.username ?? null,
    tenantId: getCreateTenantId(user),
  }).returning();

  const recipientList = data.targetType === 'specific' ? (data.recipients ?? []) : [];
  await saveRecipients(row.id, recipientList);

  const notice = toNotice(row);
  if (row.publishStatus === 'published') await broadcastNotice(notice, row.id);
  return c.json({ code: 0 as const, message: '创建成功', data: notice }, 200);
});

// PUT /{id}
const updateRouteDef = createRoute({
  method: 'put',
  path: '/{id}',
  tags: ['Notices'],
  summary: '更新通知',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:notice:update', audit: { description: '更新通知公告', module: '通知公告' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }), body: { content: jsonContent(updateNoticeSchema), required: true } },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(apiResponse(NoticeDTO)), description: '更新成功' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
noticesRouter.openapi(updateRouteDef, async (c) => {
  const { id } = c.req.valid('param');
  const data = c.req.valid('json');
  const now = new Date();
  let publishTime: Date | null | undefined;
  if (data.publishTime !== undefined) {
    publishTime = data.publishTime ? new Date(data.publishTime) : null;
  } else if (data.publishStatus === 'published') {
    const existing = await db.select().from(notices).where(eq(notices.id, id));
    if (existing[0] && !existing[0].publishTime) publishTime = now;
  }
  const updateData: Record<string, unknown> = { ...data, updatedAt: now };
  delete updateData.recipients;
  if (publishTime !== undefined) updateData.publishTime = publishTime;

  const [row] = await db.update(notices).set(updateData).where(and(eq(notices.id, id), tenantCondition(notices, c.get('user')))).returning();
  if (!row) return c.json({ code: 404, message: '通知不存在', data: null }, 404);

  if (data.targetType !== undefined || data.recipients !== undefined) {
    const newTargetType = data.targetType ?? row.targetType;
    const recipientList = newTargetType === 'specific' ? (data.recipients ?? []) : [];
    await saveRecipients(id, recipientList);
  }

  const notice = toNotice(row);
  if (data.publishStatus === 'published') await broadcastNotice(notice, row.id);
  return c.json({ code: 0 as const, message: '更新成功', data: notice }, 200);
});

// DELETE /{id}
const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Notices'],
  summary: '删除通知',
  security: [{ BearerAuth: [] }],
  middleware: [guard({ permission: 'system:notice:delete', audit: { description: '删除通知公告', module: '通知公告' } })] as const,
  request: { params: z.object({ id: z.coerce.number() }) },
  responses: {
    ...commonErrorResponses,
    200: { content: jsonContent(MessageResponse), description: '删除成功' },
    404: { content: jsonContent(ErrorResponse), description: '不存在' },
  },
});
noticesRouter.openapi(deleteRouteDef, async (c) => {
  const { id } = c.req.valid('param');
  const [row] = await db.delete(notices).where(and(eq(notices.id, id), tenantCondition(notices, c.get('user')))).returning();
  if (!row) return c.json({ code: 404, message: '通知不存在', data: null }, 404);
  return c.json({ code: 0 as const, message: '删除成功', data: null }, 200);
});

export default noticesRouter;
