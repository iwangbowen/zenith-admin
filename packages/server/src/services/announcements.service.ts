import { count, desc, eq, like, and, gte, lte, inArray, isNull, isNotNull, sql, or, getTableColumns, type SQL } from 'drizzle-orm';
import { mergeWhere, escapeLike, withPagination } from '../lib/where-helpers';
import { db } from '../db';
import type { DbExecutor } from '../db/types';
import { announcements, announcementRecipients, announcementReads, users, userRoles, roles, departments } from '../db/schema';
import { broadcast, sendToUser } from '../lib/ws-manager';
import { tenantCondition, getCreateTenantId } from '../lib/tenant';
import { streamToExcel, formatDateTimeForExcel } from '../lib/excel-export';
import { HTTPException } from 'hono/http-exception';
import { currentUser } from '../lib/context';
import { formatDateTime, formatNullableDateTime, parseDateTimeInput } from '../lib/datetime';

// ─── 数据映射 ─────────────────────────────────────────────────────────────────

export function mapAnnouncement(row: typeof announcements.$inferSelect) {
  return {
    ...row,
    targetType: row.targetType as 'all' | 'specific',
    publishTime: formatNullableDateTime(row.publishTime),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

// ─── 访问过滤条件（只能看到自己有权限的公告）────────────────────────────────

export function buildAccessFilter(userId: number) {
  return or(
    eq(announcements.targetType, 'all'),
    sql`EXISTS (
      SELECT 1 FROM announcement_recipients ar
      WHERE ar.announcement_id = ${announcements.id}
      AND (
        (ar.recipient_type = 'user' AND ar.recipient_id = ${userId})
        OR (ar.recipient_type = 'role' AND ar.recipient_id IN (
          SELECT role_id FROM user_roles WHERE user_id = ${userId}
        ))
        OR (ar.recipient_type = 'dept' AND ar.recipient_id = (
          SELECT department_id FROM users WHERE id = ${userId}
        ))
      )
    )`,
  );
}

// ─── 收件人管理 ───────────────────────────────────────────────────────────────

export async function saveRecipients(
  executor: DbExecutor,
  announcementId: number,
  recipientList: Array<{ recipientType: string; recipientId: number }>,
) {
  await executor.delete(announcementRecipients).where(eq(announcementRecipients.announcementId, announcementId));
  if (recipientList.length > 0) {
    await executor
      .insert(announcementRecipients)
      .values(recipientList.map((r) => ({ announcementId, recipientType: r.recipientType, recipientId: r.recipientId })))
      .onConflictDoNothing();
  }
}

// ─── WebSocket 广播 ───────────────────────────────────────────────────────────

import type { WsMessage } from '@zenith/shared';

async function resolveAnnouncementAudience(announcementId: number, targetType: string, tenantId: number | null): Promise<'all' | Set<number>> {
  if (targetType === 'all') return 'all';
  const recipientRows = await db.select().from(announcementRecipients).where(eq(announcementRecipients.announcementId, announcementId));
  const userIdSet = new Set<number>();
  recipientRows.filter((r) => r.recipientType === 'user').forEach((r) => userIdSet.add(r.recipientId));
  const roleIds = recipientRows.filter((r) => r.recipientType === 'role').map((r) => r.recipientId);
  if (roleIds.length > 0) {
    const roleUsers = await db.select({ userId: userRoles.userId }).from(userRoles).where(inArray(userRoles.roleId, roleIds));
    roleUsers.forEach((r) => userIdSet.add(r.userId));
  }
  const deptIds = recipientRows.filter((r) => r.recipientType === 'dept').map((r) => r.recipientId);
  if (deptIds.length > 0) {
    const tenantFilter = tenantId == null ? undefined : eq(users.tenantId, tenantId);
    const deptUsers = await db.select({ id: users.id }).from(users).where(and(inArray(users.departmentId, deptIds), tenantFilter));
    deptUsers.forEach((u) => userIdSet.add(u.id));
  }
  return userIdSet;
}

function dispatchToAudience(audience: 'all' | Set<number>, message: WsMessage) {
  setImmediate(() => {
    if (audience === 'all') broadcast(message);
    else for (const uid of audience) sendToUser(uid, message);
  });
}

export async function broadcastAnnouncement(announcement: ReturnType<typeof mapAnnouncement>, announcementId: number) {
  const audience = await resolveAnnouncementAudience(announcementId, announcement.targetType, announcement.tenantId);
  dispatchToAudience(audience, { type: 'announcement:new', payload: announcement });
}

// ─── 业务逻辑 ─────────────────────────────────────────────────────────────────

export async function listPublishedForUser() {
  const user = currentUser();
  const tc = tenantCondition(announcements, user);
  const accessFilter = buildAccessFilter(user.userId);
  const rows = await db.query.announcements.findMany({
    where: and(eq(announcements.publishStatus, 'published'), accessFilter, ...(tc ? [tc] : [])),
    with: { reads: { where: eq(announcementReads.userId, user.userId), columns: { id: true } } },
    orderBy: [desc(announcements.publishTime)],
    limit: 20,
  });
  return rows.map(({ reads, ...row }) => ({ ...mapAnnouncement(row), isRead: reads.length > 0 }));
}

export async function markAnnouncementRead(announcementId: number) {
  const userId = currentUser().userId;
  await db.insert(announcementReads).values({ announcementId, userId }).onConflictDoNothing();
  setImmediate(() => sendToUser(userId, { type: 'announcement:read', payload: { id: announcementId } }));
}

export async function markAllAnnouncementsRead() {
  const userId = currentUser().userId;
  const accessFilter = buildAccessFilter(userId);
  const rows = await db.query.announcements.findMany({
    where: and(eq(announcements.publishStatus, 'published'), accessFilter),
    with: { reads: { where: eq(announcementReads.userId, userId), columns: { id: true } } },
    columns: { id: true },
  });
  const unreadIds = rows.filter((r) => r.reads.length === 0).map((r) => r.id);
  if (unreadIds.length === 0) return;
  await db.insert(announcementReads).values(unreadIds.map((announcementId) => ({ announcementId, userId }))).onConflictDoNothing();
  setImmediate(() => sendToUser(userId, { type: 'announcement:read-all', payload: {} }));
}

export async function getUnreadAnnouncementCount(): Promise<number> {
  const user = currentUser();
  const tc = tenantCondition(announcements, user);
  const accessFilter = buildAccessFilter(user.userId);
  const baseWhere = and(eq(announcements.publishStatus, 'published'), accessFilter, ...(tc ? [tc] : []));
  const joinCond = and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.userId, user.userId));
  const [row] = await db
    .select({ count: count() })
    .from(announcements)
    .leftJoin(announcementReads, joinCond)
    .where(and(baseWhere, isNull(announcementReads.id)));
  return Number(row?.count ?? 0);
}

export async function getInbox(q: { page?: number; pageSize?: number; isRead?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 10, isRead } = q;
  const tc = tenantCondition(announcements, user);
  const accessFilter = buildAccessFilter(user.userId);
  const baseWhere = and(eq(announcements.publishStatus, 'published'), accessFilter, ...(tc ? [tc] : []));
  const joinCond = and(eq(announcementReads.announcementId, announcements.id), eq(announcementReads.userId, user.userId));
  let readFilter: ReturnType<typeof isNotNull | typeof isNull> | undefined;
  if (isRead === 'true') readFilter = isNotNull(announcementReads.id);
  else if (isRead === 'false') readFilter = isNull(announcementReads.id);
  const where = readFilter ? and(baseWhere, readFilter) : baseWhere;
  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(announcements).leftJoin(announcementReads, joinCond).where(where),
    withPagination(
      db.select({ ...getTableColumns(announcements), isRead: isNotNull(announcementReads.id) })
        .from(announcements)
        .leftJoin(announcementReads, joinCond)
        .where(where)
        .orderBy(desc(announcements.publishTime))
        .$dynamic(),
      page, pageSize,
    ),
  ]);
  return { list: rows.map(({ isRead, ...announcementRow }) => ({ ...mapAnnouncement(announcementRow), isRead })), total: totalRow[0].total, page, pageSize };
}

export async function listAnnouncements(q: { page?: number; pageSize?: number; title?: string; type?: string; publishStatus?: string; startTime?: string; endTime?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 10, title, type, publishStatus, startTime, endTime } = q;
  const conditions = [];
  if (title) conditions.push(like(announcements.title, `%${escapeLike(title)}%`));
  if (type) conditions.push(eq(announcements.type, type));
  if (publishStatus) conditions.push(eq(announcements.publishStatus, publishStatus));
  const parsedStartTime = parseDateTimeInput(startTime);
  const parsedEndTime = parseDateTimeInput(endTime);
  if (parsedStartTime) conditions.push(gte(announcements.createdAt, parsedStartTime));
  if (parsedEndTime) conditions.push(lte(announcements.createdAt, parsedEndTime));
  const where = and(...conditions);
  const tc = tenantCondition(announcements, user);
  const finalWhere = mergeWhere(where, tc);
  const [total, rows] = await Promise.all([
    db.$count(announcements, finalWhere),
    withPagination(db.select().from(announcements).where(finalWhere).orderBy(desc(announcements.createdAt)).$dynamic(), page, pageSize),
  ]);
  const announcementIds = rows.map((r) => r.id);
  const readCountRows = announcementIds.length > 0
    ? await db.select({ announcementId: announcementReads.announcementId, cnt: count() }).from(announcementReads).where(inArray(announcementReads.announcementId, announcementIds)).groupBy(announcementReads.announcementId)
    : [];
  const readCountMap = new Map(readCountRows.map((r) => [r.announcementId, r.cnt]));
  return { list: rows.map((r) => ({ ...mapAnnouncement(r), readCount: readCountMap.get(r.id) ?? 0 })), total: Number(total), page, pageSize };
}

export async function exportAnnouncements(): Promise<{ stream: ReadableStream; filename: string }> {
  const user = currentUser();
  const rows = await db.select().from(announcements).where(tenantCondition(announcements, user)).orderBy(desc(announcements.id));
  const stream = await streamToExcel(
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
    '公告',
  );
  return { stream, filename: 'announcements.xlsx' };
}

export async function batchDeleteAnnouncements(ids: number[]) {
  const user = currentUser();
  if (!Array.isArray(ids) || ids.length === 0) throw new HTTPException(400, { message: '请选择要删除的公告' });
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) throw new HTTPException(400, { message: '公告ID格式无效' });
  const toDelete = await db.select({ id: announcements.id, targetType: announcements.targetType, tenantId: announcements.tenantId }).from(announcements).where(and(inArray(announcements.id, validIds), tenantCondition(announcements, user)));
  const audiences = await Promise.all(toDelete.map((row) => resolveAnnouncementAudience(row.id, row.targetType, row.tenantId)));
  await db.delete(announcements).where(and(inArray(announcements.id, validIds), tenantCondition(announcements, user)));
  toDelete.forEach((row, i) => dispatchToAudience(audiences[i], { type: 'announcement:deleted', payload: { id: row.id } }));
  return validIds.length;
}

export async function getAnnouncementsBeforeAudit(ids: number[]) {
  const user = currentUser();
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  if (validIds.length === 0) return [];
  const rows = await db.select().from(announcements).where(and(inArray(announcements.id, validIds), tenantCondition(announcements, user))).orderBy(desc(announcements.id));
  return rows.map(mapAnnouncement);
}

export async function getAnnouncementReadStats(id: number, q: { page?: number; pageSize?: number; tab?: string }) {
  const user = currentUser();
  const { page = 1, pageSize = 10, tab: rawTab } = q;
  const tab = rawTab === 'unread' ? 'unread' : 'read';
  const [announcement] = await db.select().from(announcements).where(eq(announcements.id, id));
  if (!announcement) throw new HTTPException(404, { message: '公告不存在' });

  const joinCond = and(eq(announcementReads.announcementId, id), eq(announcementReads.userId, users.id));
  const tabFilter = tab === 'read' ? isNotNull(announcementReads.id) : isNull(announcementReads.id);

  let baseWhere: SQL | undefined;
  if (announcement.targetType === 'all') {
    const tc = tenantCondition(users, user);
    baseWhere = and(eq(users.status, 'enabled'), ...(tc ? [tc] : []));
  } else {
    const recipients = await db.select().from(announcementRecipients).where(eq(announcementRecipients.announcementId, id));
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
    db.select({ cnt: count() }).from(users).leftJoin(announcementReads, joinCond).where(and(baseWhere, isNotNull(announcementReads.id))),
    db.select({ cnt: count() }).from(users).where(baseWhere),
    db.select({ cnt: count() }).from(users).leftJoin(announcementReads, joinCond).where(and(baseWhere, tabFilter)),
    withPagination(
      db.select({ id: users.id, username: users.username, nickname: users.nickname, avatar: users.avatar, readAt: announcementReads.readAt })
        .from(users)
        .leftJoin(announcementReads, joinCond)
        .where(and(baseWhere, tabFilter))
        .orderBy(users.id)
        .$dynamic(),
      page, pageSize,
    ),
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

export async function getAnnouncementDetail(id: number) {
  const user = currentUser();
  const [row] = await db.select().from(announcements).where(and(eq(announcements.id, id), tenantCondition(announcements, user)));
  if (!row) throw new HTTPException(404, { message: '公告不存在' });
  const recipientRows = await db.select().from(announcementRecipients).where(eq(announcementRecipients.announcementId, id));
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
  return { ...mapAnnouncement(row), recipients };
}

export interface CreateAnnouncementInput {
  title: string; content: string; type: string;
  publishStatus: 'draft' | 'published' | 'recalled' | 'scheduled';
  priority: string;
  targetType: 'all' | 'specific';
  recipients?: Array<{ recipientType: 'user' | 'role' | 'dept'; recipientId: number }>;
  publishTime?: string | null;
}

export async function createAnnouncement(data: CreateAnnouncementInput) {
  const user = currentUser();
  const now = new Date();
  let publishTime: Date | null = null;
  if (data.publishTime) publishTime = parseDateTimeInput(data.publishTime);
  else if (data.publishStatus === 'published') publishTime = now;

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(announcements).values({
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

  const announcement = mapAnnouncement(row);
  if (row.publishStatus === 'published') await broadcastAnnouncement(announcement, row.id);
  return announcement;
}

export async function publishScheduledAnnouncements(): Promise<number> {
  const now = new Date();
  const pendingList = await db.select().from(announcements)
    .where(and(
      eq(announcements.publishStatus, 'scheduled'),
      lte(announcements.publishTime, now),
    ));
  if (pendingList.length === 0) return 0;
  for (const row of pendingList) {
    await db.update(announcements)
      .set({ publishStatus: 'published' })
      .where(eq(announcements.id, row.id));
    const updated = mapAnnouncement({ ...row, publishStatus: 'published' });
    await broadcastAnnouncement(updated, row.id);
  }
  return pendingList.length;
}

export async function updateAnnouncement(id: number, data: Partial<CreateAnnouncementInput>) {
  const user = currentUser();
  const now = new Date();
  let publishTime: Date | null | undefined;
  if (data.publishTime !== undefined) {
    publishTime = data.publishTime ? parseDateTimeInput(data.publishTime) : null;
  } else if (data.publishStatus === 'published') {
    const existing = await db.select().from(announcements).where(eq(announcements.id, id));
    if (existing[0] && !existing[0].publishTime) publishTime = now;
  }
  const updateData: Record<string, unknown> = { ...data };
  delete updateData.recipients;
  if (publishTime !== undefined) updateData.publishTime = publishTime;

  const row = await db.transaction(async (tx) => {
    const [updated] = await tx.update(announcements).set(updateData).where(and(eq(announcements.id, id), tenantCondition(announcements, user))).returning();
    if (!updated) return null;
    if (data.targetType !== undefined || data.recipients !== undefined) {
      const newTargetType = data.targetType ?? updated.targetType;
      const recipientList = newTargetType === 'specific' ? (data.recipients ?? []) : [];
      await saveRecipients(tx, id, recipientList);
    }
    return updated;
  });
  if (!row) throw new HTTPException(404, { message: '公告不存在' });
  const announcement = mapAnnouncement(row);
  if (data.publishStatus === 'published') {
    await broadcastAnnouncement(announcement, row.id);
  } else if (data.publishStatus !== 'scheduled') {
    const audience = await resolveAnnouncementAudience(row.id, announcement.targetType, announcement.tenantId);
    dispatchToAudience(audience, { type: 'announcement:updated', payload: announcement });
  }
  return announcement;
}

export async function deleteAnnouncement(id: number) {
  const user = currentUser();
  const [existing] = await db.select({ id: announcements.id, targetType: announcements.targetType, tenantId: announcements.tenantId }).from(announcements).where(and(eq(announcements.id, id), tenantCondition(announcements, user))).limit(1);
  if (!existing) throw new HTTPException(404, { message: '公告不存在' });
  const audience = await resolveAnnouncementAudience(existing.id, existing.targetType, existing.tenantId);
  const [row] = await db.delete(announcements).where(and(eq(announcements.id, id), tenantCondition(announcements, user))).returning();
  if (!row) throw new HTTPException(404, { message: '公告不存在' });
  dispatchToAudience(audience, { type: 'announcement:deleted', payload: { id } });
}

export async function getAnnouncementBeforeAudit(id: number) {
  const user = currentUser();
  const [row] = await db.select().from(announcements).where(and(eq(announcements.id, id), tenantCondition(announcements, user))).limit(1);
  if (!row) return null;
  return mapAnnouncement(row);
}
