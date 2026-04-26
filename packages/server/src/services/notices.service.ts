import { count, desc, eq, like, and, gte, lte, inArray, isNull, isNotNull, sql, or, getTableColumns, type SQL } from 'drizzle-orm';
import { mergeWhere, escapeLike } from '../lib/where-helpers';
import { db } from '../db';
import type { DbExecutor } from '../db/types';
import { notices, noticeRecipients, noticeReads, users, userRoles, roles, departments } from '../db/schema';
import { broadcast, sendToUser } from '../lib/ws-manager';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { pageOffset } from '../lib/pagination';
import { exportToExcel, formatDateTimeForExcel } from '../lib/excel-export';
import { AppError } from '../lib/errors';
import { currentUser } from '../lib/context';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapNotice(row: typeof notices.$inferSelect) {
  return {
    ...row,
    targetType: row.targetType as 'all' | 'specific',
    publishTime: formatNullableDateTime(row.publishTime),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 访问过滤条件（只能看到自己有权限的通知）────────────────────────────────

export function buildAccessFilter(userId: number) {
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

// ─── 收件人管理 ───────────────────────────────────────────────────────────────

export async function saveRecipients(
  executor: DbExecutor,
  noticeId: number,
  recipientList: Array<{ recipientType: string; recipientId: number }>,
) {
  await executor.delete(noticeRecipients).where(eq(noticeRecipients.noticeId, noticeId));
  if (recipientList.length > 0) {
    await executor
      .insert(noticeRecipients)
      .values(recipientList.map((r) => ({ noticeId, recipientType: r.recipientType, recipientId: r.recipientId })))
      .onConflictDoNothing();
  }
}

// ─── WebSocket 广播 ───────────────────────────────────────────────────────────

export async function broadcastNotice(notice: ReturnType<typeof mapNotice>, noticeId: number) {
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
    const tenantFilter = notice.tenantId == null ? undefined : eq(users.tenantId, notice.tenantId);
    const deptUsers = await db.select({ id: users.id }).from(users).where(and(inArray(users.departmentId, deptIds), tenantFilter));
    deptUsers.forEach((u) => userIdSet.add(u.id));
  }
  for (const uid of userIdSet) sendToUser(uid, { type: 'notice:new', payload: notice });
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────

export async function listPublishedForUser() {
  const user = currentUser();
  const tc = tenantCondition(notices, user);
  const accessFilter = buildAccessFilter(user.userId);
  const rows = await db.query.notices.findMany({
    where: and(eq(notices.publishStatus, 'published'), accessFilter, ...(tc ? [tc] : [])),
    with: { reads: { where: eq(noticeReads.userId, user.userId), columns: { id: true } } },
    orderBy: [desc(notices.publishTime)],
    limit: 20,
  });
  return rows.map(({ reads, ...row }) => ({ ...mapNotice(row), isRead: reads.length > 0 }));
}

export async function markNoticeRead(noticeId: number) {
  const userId = currentUser().userId;
  await db.insert(noticeReads).values({ noticeId, userId }).onConflictDoNothing();
}

export async function markAllNoticesRead() {
  const userId = currentUser().userId;
  const accessFilter = buildAccessFilter(userId);
  const rows = await db.query.notices.findMany({
    where: and(eq(notices.publishStatus, 'published'), accessFilter),
    with: { reads: { where: eq(noticeReads.userId, userId), columns: { id: true } } },
    columns: { id: true },
  });
  const unreadIds = rows.filter((r) => r.reads.length === 0).map((r) => r.id);
  if (unreadIds.length === 0) return;
  await db.insert(noticeReads).values(unreadIds.map((noticeId) => ({ noticeId, userId }))).onConflictDoNothing();
}

export async function getInbox(q: { page?: number; pageSize?: number; isRead?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 10, isRead } = q;
  const tc = tenantCondition(notices, user);
  const accessFilter = buildAccessFilter(user.userId);
  const baseWhere = and(eq(notices.publishStatus, 'published'), accessFilter, ...(tc ? [tc] : []));
  const joinCond = and(eq(noticeReads.noticeId, notices.id), eq(noticeReads.userId, user.userId));
  let readFilter: ReturnType<typeof isNotNull | typeof isNull> | undefined;
  if (isRead === 'true') readFilter = isNotNull(noticeReads.id);
  else if (isRead === 'false') readFilter = isNull(noticeReads.id);
  const where = readFilter ? and(baseWhere, readFilter) : baseWhere;
  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(notices).leftJoin(noticeReads, joinCond).where(where),
    db.select({ ...getTableColumns(notices), isRead: isNotNull(noticeReads.id) })
      .from(notices)
      .leftJoin(noticeReads, joinCond)
      .where(where)
      .orderBy(desc(notices.publishTime))
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);
  return { list: rows.map(({ isRead, ...noticeRow }) => ({ ...mapNotice(noticeRow), isRead })), total: totalRow[0].total, page, pageSize };
}

export async function listNotices(q: { page?: number; pageSize?: number; title?: string; type?: string; publishStatus?: string; startTime?: string; endTime?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 10, title, type, publishStatus, startTime, endTime } = q;
  const conditions = [];
  if (title) conditions.push(like(notices.title, `%${escapeLike(title)}%`));
  if (type) conditions.push(eq(notices.type, type));
  if (publishStatus) conditions.push(eq(notices.publishStatus, publishStatus));
  const parsedStartTime = parseDateTimeInput(startTime);
  const parsedEndTime = parseDateTimeInput(endTime);
  if (parsedStartTime) conditions.push(gte(notices.createdAt, parsedStartTime));
  if (parsedEndTime) conditions.push(lte(notices.createdAt, parsedEndTime));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const tc = tenantCondition(notices, user);
  const finalWhere = mergeWhere(where, tc);
  const [total, rows] = await Promise.all([
    db.$count(notices, finalWhere),
    db.select().from(notices).where(finalWhere).orderBy(desc(notices.createdAt)).limit(pageSize).offset(pageOffset(page, pageSize)),
  ]);
  const noticeIds = rows.map((r) => r.id);
  const readCountRows = noticeIds.length > 0
    ? await db.select({ noticeId: noticeReads.noticeId, cnt: count() }).from(noticeReads).where(inArray(noticeReads.noticeId, noticeIds)).groupBy(noticeReads.noticeId)
    : [];
  const readCountMap = new Map(readCountRows.map((r) => [r.noticeId, r.cnt]));
  return { list: rows.map((r) => ({ ...mapNotice(r), readCount: readCountMap.get(r.id) ?? 0 })), total: Number(total), page, pageSize };
}

export async function exportNotices(): Promise<{ buffer: ArrayBuffer; filename: string }> {
  const user = currentUser();
  const rows = await db.select().from(notices).where(tenantCondition(notices, user)).orderBy(desc(notices.id));
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
    rows.map((r) => ({ ...r, createdAt: formatDateTimeForExcel(r.createdAt) })),
    '通知公告',
  );
  return { buffer, filename: 'notices.xlsx' };
}

export async function batchDeleteNotices(ids: number[]) {
  const user = currentUser();
  if (!Array.isArray(ids) || ids.length === 0) throw new AppError('请选择要删除的通知', 400);
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) throw new AppError('通知ID格式无效', 400);
  await db.delete(notices).where(and(inArray(notices.id, validIds), tenantCondition(notices, user)));
  return validIds.length;
}

export async function getNoticesBeforeAudit(ids: number[]) {
  const user = currentUser();
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) return [];
  const rows = await db.select().from(notices).where(and(inArray(notices.id, validIds), tenantCondition(notices, user))).orderBy(desc(notices.id));
  return rows.map(mapNotice);
}

export async function getNoticeReadStats(id: number, q: { page?: number; pageSize?: number; tab?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 10, tab: rawTab } = q;
  const tab = rawTab === 'unread' ? 'unread' : 'read';
  const [notice] = await db.select().from(notices).where(eq(notices.id, id));
  if (!notice) throw new AppError('通知不存在', 404);

  const joinCond = and(eq(noticeReads.noticeId, id), eq(noticeReads.userId, users.id));
  const tabFilter = tab === 'read' ? isNotNull(noticeReads.id) : isNull(noticeReads.id);

  let baseWhere: SQL | undefined;
  if (notice.targetType === 'all') {
    const tc = tenantCondition(users, user);
    baseWhere = and(eq(users.status, 'enabled'), ...(tc ? [tc] : []));
  } else {
    const recipients = await db.select().from(noticeRecipients).where(eq(noticeRecipients.noticeId, id));
    const userIdSet = new Set<number>();
    recipients.filter((r) => r.recipientType === 'user').forEach((r) => userIdSet.add(r.recipientId));
    const roleIds = recipients.filter((r) => r.recipientType === 'role').map((r) => r.recipientId);
    const deptIds = recipients.filter((r) => r.recipientType === 'dept').map((r) => r.recipientId);
    const [roleUsers, deptUsers] = await Promise.all([
      roleIds.length > 0 ? db.select({ userId: userRoles.userId }).from(userRoles).where(inArray(userRoles.roleId, roleIds)) : Promise.resolve([]),
      deptIds.length > 0 ? db.select({ id: users.id }).from(users).where(inArray(users.departmentId, deptIds)) : Promise.resolve([]),
    ]);
    roleUsers.forEach((r) => userIdSet.add(r.userId));
    deptUsers.forEach((u) => userIdSet.add(u.id));
    if (userIdSet.size === 0) return { readCount: 0, totalCount: 0, list: [], total: 0, page, pageSize };
    baseWhere = inArray(users.id, [...userIdSet]);
  }

  const [readCountRow, totalCountRow, totalRow, list] = await Promise.all([
    db.select({ cnt: count() }).from(users).leftJoin(noticeReads, joinCond).where(and(baseWhere, isNotNull(noticeReads.id))),
    db.select({ cnt: count() }).from(users).where(baseWhere),
    db.select({ cnt: count() }).from(users).leftJoin(noticeReads, joinCond).where(and(baseWhere, tabFilter)),
    db.select({ id: users.id, username: users.username, nickname: users.nickname, avatar: users.avatar, readAt: noticeReads.readAt })
      .from(users)
      .leftJoin(noticeReads, joinCond)
      .where(and(baseWhere, tabFilter))
      .orderBy(users.id)
      .limit(pageSize)
      .offset(pageOffset(page, pageSize)),
  ]);

  return {
    readCount: readCountRow[0].cnt,
    totalCount: totalCountRow[0].cnt,
    total: totalRow[0].cnt,
    list: list.map((u) => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      avatar: u.avatar,
      ...(tab === 'read' ? { readAt: formatNullableDateTime(u.readAt) ?? undefined } : {}),
    })),
    page,
    pageSize,
  };
}

export async function getNoticeDetail(id: number) {
  const user = currentUser();
  const [row] = await db.select().from(notices).where(and(eq(notices.id, id), tenantCondition(notices, user)));
  if (!row) throw new AppError('通知不存在', 404);
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
  return { ...mapNotice(row), recipients };
}

export interface CreateNoticeInput {
  title: string; content: string; type: string;
  publishStatus: 'draft' | 'published' | 'recalled';
  priority: string;
  targetType: 'all' | 'specific';
  recipients?: Array<{ recipientType: 'user' | 'role' | 'dept'; recipientId: number }>;
  publishTime?: string | null;
}

export async function createNotice(data: CreateNoticeInput) {
  const user = currentUser();
  const now = new Date();
  let publishTime: Date | null = null;
  if (data.publishTime) publishTime = parseDateTimeInput(data.publishTime);
  else if (data.publishStatus === 'published') publishTime = now;

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(notices).values({
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
    await saveRecipients(tx, inserted.id, recipientList);
    return inserted;
  });

  const notice = mapNotice(row);
  if (row.publishStatus === 'published') await broadcastNotice(notice, row.id);
  return notice;
}

export async function updateNotice(id: number, data: Partial<CreateNoticeInput>) {
  const user = currentUser();
  const now = new Date();
  let publishTime: Date | null | undefined;
  if (data.publishTime !== undefined) {
    publishTime = data.publishTime ? parseDateTimeInput(data.publishTime) : null;
  } else if (data.publishStatus === 'published') {
    const existing = await db.select().from(notices).where(eq(notices.id, id));
    if (existing[0] && !existing[0].publishTime) publishTime = now;
  }
  const updateData: Record<string, unknown> = { ...data };
  delete updateData.recipients;
  if (publishTime !== undefined) updateData.publishTime = publishTime;

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(notices).set(updateData).where(and(eq(notices.id, id), tenantCondition(notices, user))).returning();
    if (!updated) return null;
    if (data.targetType !== undefined || data.recipients !== undefined) {
      const newTargetType = data.targetType ?? updated.targetType;
      const recipientList = newTargetType === 'specific' ? (data.recipients ?? []) : [];
      await saveRecipients(tx, id, recipientList);
    }
    return updated;
  });
  if (!row) throw new AppError('通知不存在', 404);
  const notice = mapNotice(row);
  if (data.publishStatus === 'published') await broadcastNotice(notice, row.id);
  return notice;
}

export async function deleteNotice(id: number) {
  const user = currentUser();
  const [row] = await db.delete(notices).where(and(eq(notices.id, id), tenantCondition(notices, user))).returning();
  if (!row) throw new AppError('通知不存在', 404);
}

export async function getNoticeBeforeAudit(id: number) {
  const user = currentUser();
  const [row] = await db.select().from(notices).where(and(eq(notices.id, id), tenantCondition(notices, user))).limit(1);
  if (!row) return null;
  return mapNotice(row);
}
