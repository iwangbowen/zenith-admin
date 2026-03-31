import { Hono } from 'hono';
import { desc, eq, like, and, or, sql, gte, lte, inArray } from 'drizzle-orm';
import { db } from '../db';
import { notices, noticeReads, noticeRecipients, users, userRoles, roles, departments } from '../db/schema';
import { createNoticeSchema, updateNoticeSchema } from '@zenith/shared';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { exportToExcel } from '../lib/excel-export';
import { broadcast, sendToUser } from '../lib/ws-manager';
import type { JwtPayload } from '../middleware/auth';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';

type Env = { Variables: { user: JwtPayload } };
const noticesRouter = new Hono<Env>();
noticesRouter.use('*', authMiddleware);

function toNotice(row: typeof notices.$inferSelect) {
  return {
    ...row,
    targetType: row.targetType as 'all' | 'specific',
    publishTime: row.publishTime ? row.publishTime.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 构建当前用户可见的通知访问过滤（target_type='all' 或在 notice_recipients 中） */
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

/** 保存通知收件人（先清除旧记录再插入新记录） */
async function saveRecipients(noticeId: number, recipientList: Array<{ recipientType: string; recipientId: number }>) {
  await db.delete(noticeRecipients).where(eq(noticeRecipients.noticeId, noticeId));
  if (recipientList.length > 0) {
    await db.insert(noticeRecipients).values(
      recipientList.map((r) => ({ noticeId, recipientType: r.recipientType, recipientId: r.recipientId })),
    ).onConflictDoNothing();
  }
}

/** 发布通知时向目标用户推送 WebSocket 消息 */
async function broadcastNotice(notice: ReturnType<typeof toNotice>, noticeId: number) {
  if (notice.targetType === 'all') {
    broadcast({ type: 'notice:new', payload: notice });
    return;
  }
  // specific: 解析所有目标 userId
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

  for (const uid of userIdSet) {
    sendToUser(uid, { type: 'notice:new', payload: notice });
  }
}

// 获取已发布的通知（供铃铛使用，无需分页，返回最近 20 条，含已读标记）
noticesRouter.get('/published', async (c) => {
  const user = c.get('user');
  const tc = tenantCondition(notices, user);
  const accessFilter = buildAccessFilter(user.userId);
  const publishedWhere = and(
    eq(notices.publishStatus, 'published'),
    accessFilter,
    ...(tc ? [tc] : []),
  );
  const rows = await db
    .select()
    .from(notices)
    .where(publishedWhere)
    .orderBy(desc(notices.publishTime))
    .limit(20);

  // 查询当前用户已读的通知 id 集合
  const readRows = await db
    .select({ noticeId: noticeReads.noticeId })
    .from(noticeReads)
    .where(eq(noticeReads.userId, user.userId));
  const readSet = new Set(readRows.map((r) => r.noticeId));

  const data = rows.map((row) => ({
    ...toNotice(row),
    isRead: readSet.has(row.id),
  }));
  return c.json({ code: 0, message: 'ok', data });
});

// 标记通知为已读
noticesRouter.post('/:id/read', async (c) => {
  const user = c.get('user');
  const id = Number(c.req.param('id'));
  // upsert: 若已存在则忽略
  await db
    .insert(noticeReads)
    .values({ noticeId: id, userId: user.userId })
    .onConflictDoNothing();
  return c.json({ code: 0, message: 'ok', data: null });
});

// 全部标记为已读（将所有已发布且未读的通知批量写入 noticeReads）
noticesRouter.post('/read-all', async (c) => {
  const user = c.get('user');
  const accessFilter = buildAccessFilter(user.userId);

  const allPublished = await db
    .select({ id: notices.id })
    .from(notices)
    .where(and(eq(notices.publishStatus, 'published'), accessFilter));

  if (allPublished.length === 0) {
    return c.json({ code: 0, message: 'ok', data: null });
  }

  const readRows = await db
    .select({ noticeId: noticeReads.noticeId })
    .from(noticeReads)
    .where(eq(noticeReads.userId, user.userId));
  const readSet = new Set(readRows.map((r) => r.noticeId));

  const unreadIds = allPublished.filter((n) => !readSet.has(n.id)).map((n) => n.id);
  if (unreadIds.length > 0) {
    await db
      .insert(noticeReads)
      .values(unreadIds.map((noticeId) => ({ noticeId, userId: user.userId })))
      .onConflictDoNothing();
  }

  return c.json({ code: 0, message: 'ok', data: null });
});

// 收件箱（分页，含已读标记，供普通用户查看所有已发布通知）
noticesRouter.get('/inbox', async (c) => {
  const user = c.get('user');
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const isRead = c.req.query('isRead'); // 'true' | 'false' | undefined
  const tc = tenantCondition(notices, user);
  const accessFilter = buildAccessFilter(user.userId);
  const publishedWhere = and(
    eq(notices.publishStatus, 'published'),
    accessFilter,
    ...(tc ? [tc] : []),
  );

  const [readRows, allRows] = await Promise.all([
    db
      .select({ noticeId: noticeReads.noticeId })
      .from(noticeReads)
      .where(eq(noticeReads.userId, user.userId)),
    db
      .select()
      .from(notices)
      .where(publishedWhere)
      .orderBy(desc(notices.publishTime)),
  ]);

  const readSet = new Set(readRows.map((r) => r.noticeId));
  let list = allRows.map((row) => ({ ...toNotice(row), isRead: readSet.has(row.id) }));

  if (isRead === 'true') list = list.filter((n) => n.isRead);
  else if (isRead === 'false') list = list.filter((n) => !n.isRead);

  const total = list.length;
  const paged = list.slice((page - 1) * pageSize, page * pageSize);

  return c.json({ code: 0, message: 'ok', data: { list: paged, total, page, pageSize } });
});

// 分页列表（管理用）
noticesRouter.get('/', guard({ permission: 'system:notice:list' }), async (c) => {
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const title = c.req.query('title');
  const type = c.req.query('type');
  const publishStatus = c.req.query('publishStatus');
  const startTime = c.req.query('startTime');
  const endTime = c.req.query('endTime');

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

  const [{ count }] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(notices)
    .where(finalWhere);

  const rows = await db
    .select()
    .from(notices)
    .where(finalWhere)
    .orderBy(desc(notices.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // 批量查询每条通知的已读人数
  const noticeIds = rows.map((r) => r.id);
  const readCountRows = noticeIds.length > 0
    ? await db
      .select({ noticeId: noticeReads.noticeId, cnt: sql<number>`cast(count(*) as integer)` })
      .from(noticeReads)
      .where(inArray(noticeReads.noticeId, noticeIds))
      .groupBy(noticeReads.noticeId)
    : [];
  const readCountMap = new Map(readCountRows.map((r) => [r.noticeId, r.cnt]));

  return c.json({
    code: 0,
    message: 'ok',
    data: {
      list: rows.map((r) => ({ ...toNotice(r), readCount: readCountMap.get(r.id) ?? 0 })),
      total: count,
      page,
      pageSize,
    },
  });
});

// 获取单条
noticesRouter.get('/:id', guard({ permission: 'system:notice:list' }), async (c) => {
  const id = Number(c.req.param('id'));
  const [row] = await db.select().from(notices).where(and(eq(notices.id, id), tenantCondition(notices, c.get('user'))));
  if (!row) return c.json({ code: 404, message: '通知不存在', data: null }, 404);

  // 查询收件人列表并附带显示名称
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

  return c.json({ code: 0, message: 'ok', data: { ...toNotice(row), recipients } });
});

// 创建
noticesRouter.post('/', guard({ permission: 'system:notice:create', audit: { description: '创建通知公告', module: '通知公告' } }), async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const result = createNoticeSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  const now = new Date();
  let publishTime: Date | null = null;
  if (result.data.publishTime) {
    publishTime = new Date(result.data.publishTime);
  } else if (result.data.publishStatus === 'published') {
    publishTime = now;
  }

  const [row] = await db
    .insert(notices)
    .values({
      title: result.data.title,
      content: result.data.content,
      type: result.data.type,
      publishStatus: result.data.publishStatus,
      priority: result.data.priority,
      targetType: result.data.targetType ?? 'all',
      publishTime,
      createById: user?.userId ?? null,
      createByName: user?.username ?? null,
      tenantId: getCreateTenantId(user),
    })
    .returning();

  // 保存收件人（仅 specific 时有意义，但 all 也可存空）
  const recipientList = result.data.targetType === 'specific' ? (result.data.recipients ?? []) : [];
  await saveRecipients(row.id, recipientList);

  const notice = toNotice(row);
  if (row.publishStatus === 'published') {
    await broadcastNotice(notice, row.id);
  }
  return c.json({ code: 0, message: '创建成功', data: notice });
});

// 更新
noticesRouter.put('/:id', guard({ permission: 'system:notice:update', audit: { description: '更新通知公告', module: '通知公告' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const result = updateNoticeSchema.safeParse(body);
  if (!result.success) {
    return c.json({ code: 400, message: result.error.issues[0].message, data: null }, 400);
  }
  const now = new Date();
  let publishTime: Date | null | undefined = undefined;
  if (result.data.publishTime !== undefined) {
    publishTime = result.data.publishTime ? new Date(result.data.publishTime) : null;
  } else if (result.data.publishStatus === 'published') {
    // 如果切换为发布状态但没有传 publishTime，设为当前时间
    const existing = await db.select().from(notices).where(eq(notices.id, id));
    if (existing[0] && !existing[0].publishTime) {
      publishTime = now;
    }
  }

  const updateData: Record<string, unknown> = { ...result.data, updatedAt: now };
  // 不把 recipients 写入 notices 表
  delete updateData.recipients;
  if (publishTime !== undefined) updateData.publishTime = publishTime;

  const [row] = await db
    .update(notices)
    .set(updateData)
    .where(and(eq(notices.id, id), tenantCondition(notices, c.get('user'))))
    .returning();
  if (!row) return c.json({ code: 404, message: '通知不存在', data: null }, 404);

  // 更新收件人
  if (result.data.targetType !== undefined || result.data.recipients !== undefined) {
    const newTargetType = result.data.targetType ?? row.targetType;
    const recipientList = newTargetType === 'specific' ? (result.data.recipients ?? []) : [];
    await saveRecipients(id, recipientList);
  }

  const notice = toNotice(row);
  if (result.data.publishStatus === 'published') {
    await broadcastNotice(notice, row.id);
  }
  return c.json({ code: 0, message: '更新成功', data: notice });
});

// 批量删除
noticesRouter.delete('/batch', guard({ permission: 'system:notice:delete', audit: { description: '批量删除通知公告', module: '通知公告' } }), async (c) => {
  const body = await c.req.json();
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ code: 400, message: '请选择要删除的通知', data: null }, 400);
  }
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) {
    return c.json({ code: 400, message: '通知ID格式无效', data: null }, 400);
  }
  await db.delete(notices).where(and(inArray(notices.id, validIds), tenantCondition(notices, c.get('user'))));
  return c.json({ code: 0, message: `已删除 ${validIds.length} 条通知`, data: null });
});

// 删除
noticesRouter.delete('/:id', guard({ permission: 'system:notice:delete', audit: { description: '删除通知公告', module: '通知公告' } }), async (c) => {
  const id = Number(c.req.param('id'));
  const [row] = await db.delete(notices).where(and(eq(notices.id, id), tenantCondition(notices, c.get('user')))).returning();
  if (!row) return c.json({ code: 404, message: '通知不存在', data: null }, 404);
  return c.json({ code: 0, message: '删除成功', data: null });
});

// 已读统计详情（管理视角）
noticesRouter.get('/:id/read-stats', guard({ permission: 'system:notice:list' }), async (c) => {
  const id = Number(c.req.param('id'));
  const page = Number(c.req.query('page')) || 1;
  const pageSize = Number(c.req.query('pageSize')) || 10;
  const tab = c.req.query('tab') === 'unread' ? 'unread' : 'read';
  const authUser = c.get('user');

  const [notice] = await db.select().from(notices).where(eq(notices.id, id));
  if (!notice) return c.json({ code: 404, message: '通知不存在', data: null }, 404);

  // 获取所有已读记录
  const reads = await db
    .select({ userId: noticeReads.userId, readAt: noticeReads.readAt })
    .from(noticeReads)
    .where(eq(noticeReads.noticeId, id));
  const readMap = new Map(reads.map((r) => [r.userId, r.readAt]));

  // 确定目标用户 ID 集合
  let targetUserIds: number[];
  if (notice.targetType === 'all') {
    const tc = tenantCondition(users, authUser);
    const allUsers = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.status, 'active'), ...(tc ? [tc] : [])));
    targetUserIds = allUsers.map((u) => u.id);
  } else {
    const recipients = await db.select().from(noticeRecipients).where(eq(noticeRecipients.noticeId, id));
    const userIdSet = new Set<number>();
    recipients.filter((r) => r.recipientType === 'user').forEach((r) => userIdSet.add(r.recipientId));

    const roleIds = recipients.filter((r) => r.recipientType === 'role').map((r) => r.recipientId);
    if (roleIds.length > 0) {
      const roleUsers = await db
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(inArray(userRoles.roleId, roleIds));
      roleUsers.forEach((r) => userIdSet.add(r.userId));
    }

    const deptIds = recipients.filter((r) => r.recipientType === 'dept').map((r) => r.recipientId);
    if (deptIds.length > 0) {
      const deptUsers = await db
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.departmentId, deptIds));
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
    const userRows = await db
      .select({ id: users.id, username: users.username, nickname: users.nickname, avatar: users.avatar })
      .from(users)
      .where(inArray(users.id, pagedIds));
    const userMap = new Map(userRows.map((u) => [u.id, u]));
    list = pagedIds
      .map((uid) => userMap.get(uid))
      .filter((u): u is NonNullable<typeof u> => u !== undefined)
      .map((u) => ({
        id: u.id,
        username: u.username,
        nickname: u.nickname,
        avatar: u.avatar,
        ...(tab === 'read' ? { readAt: readMap.get(u.id)?.toISOString() } : {}),
      }));
  }

  return c.json({
    code: 0,
    message: 'ok',
    data: { readCount, totalCount, list, total, page, pageSize },
  });
});

noticesRouter.get('/export', guard({ permission: 'system:notice:list' }), async (c) => {
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
    '通知公告'
  );
  c.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  c.header('Content-Disposition', 'attachment; filename=notices.xlsx');
  return c.body(buffer);
});

export default noticesRouter;
