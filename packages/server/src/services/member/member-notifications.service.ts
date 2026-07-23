/**
 * 会员站内通知服务。
 *
 * - createMemberNotification()：内部业务发通知统一入口（bizId 配合 type 可防重）
 * - 前台自助：列表 / 未读数 / 标记已读
 */
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { memberNotifications } from '../../db/schema';
import type { MemberNotificationRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { currentMemberId } from '../../lib/member-context';
import { pageOffset } from '../../lib/pagination';

export function mapMemberNotification(row: MemberNotificationRow) {
  return {
    id: row.id,
    memberId: row.memberId,
    type: row.type,
    title: row.title,
    content: row.content ?? null,
    readAt: formatNullableDateTime(row.readAt),
    createdAt: formatDateTime(row.createdAt),
  };
}

export interface CreateNotificationInput {
  memberId: number;
  type: string;
  title: string;
  content?: string | null;
  /** 与 type 组合防重：同 (memberId, type, bizId) 已存在时跳过 */
  bizId?: string | null;
}

/** 发送站内通知；带 bizId 时按 (memberId, type, bizId) 幂等，返回是否实际写入 */
export async function createMemberNotification(input: CreateNotificationInput, executor: DbExecutor = db): Promise<boolean> {
  if (input.bizId) {
    const [exist] = await executor
      .select({ id: memberNotifications.id })
      .from(memberNotifications)
      .where(and(
        eq(memberNotifications.memberId, input.memberId),
        eq(memberNotifications.type, input.type),
        eq(memberNotifications.bizId, input.bizId),
      ))
      .limit(1);
    if (exist) return false;
  }
  const inserted = await executor.insert(memberNotifications).values({
    memberId: input.memberId,
    type: input.type,
    title: input.title,
    content: input.content ?? null,
    bizId: input.bizId ?? null,
  }).onConflictDoNothing().returning({ id: memberNotifications.id });
  return inserted.length > 0;
}

// ─── 前台自助 ─────────────────────────────────────────────────────────────────
export async function listMyNotifications(q: { page: number; pageSize: number; unreadOnly?: boolean }) {
  const memberId = currentMemberId();
  const conds = [eq(memberNotifications.memberId, memberId)];
  if (q.unreadOnly) conds.push(isNull(memberNotifications.readAt));
  const where = and(...conds);
  const [total, rows] = await Promise.all([
    db.$count(memberNotifications, where),
    db.select().from(memberNotifications)
      .where(where)
      .orderBy(desc(memberNotifications.id))
      .limit(q.pageSize)
      .offset(pageOffset(q.page, q.pageSize)),
  ]);
  return { list: rows.map(mapMemberNotification), total, page: q.page, pageSize: q.pageSize };
}

export async function getMyUnreadCount(): Promise<number> {
  const memberId = currentMemberId();
  const [row] = await db.select({ v: count() }).from(memberNotifications)
    .where(and(eq(memberNotifications.memberId, memberId), isNull(memberNotifications.readAt)));
  return row?.v ?? 0;
}

export async function markMyNotificationRead(id: number): Promise<void> {
  const memberId = currentMemberId();
  const updated = await db.update(memberNotifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(memberNotifications.id, id),
      eq(memberNotifications.memberId, memberId),
      isNull(memberNotifications.readAt),
    ))
    .returning({ id: memberNotifications.id });
  if (updated.length === 0) {
    const [exist] = await db.select({ id: memberNotifications.id }).from(memberNotifications)
      .where(and(eq(memberNotifications.id, id), eq(memberNotifications.memberId, memberId))).limit(1);
    if (!exist) throw new HTTPException(404, { message: '通知不存在' });
  }
}

export async function markAllMyNotificationsRead(): Promise<number> {
  const memberId = currentMemberId();
  const updated = await db.update(memberNotifications)
    .set({ readAt: new Date() })
    .where(and(eq(memberNotifications.memberId, memberId), isNull(memberNotifications.readAt)))
    .returning({ id: memberNotifications.id });
  return updated.length;
}
