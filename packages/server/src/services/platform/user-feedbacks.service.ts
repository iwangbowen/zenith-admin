import { HTTPException } from 'hono/http-exception';
import { desc, eq, gte, inArray, lte } from 'drizzle-orm';
import { db } from '../../db';
import { userFeedbacks } from '../../db/schema';
import type { UserFeedbackRow } from '../../db/schema';
import { USER_FEEDBACK_STATUS_LABELS } from '@zenith/shared/platform';
import type { UserFeedbackCategory, UserFeedbackStatus } from '@zenith/shared/platform';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatNullableDateTime, parseDateRangeEnd, parseDateRangeStart } from '../../lib/datetime';
import logger from '../../lib/logger';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { notify } from '../messaging/notification-outbox.service';

type UserFeedbackWithUsers = UserFeedbackRow & {
  user?: { nickname: string | null } | null;
  handler?: { nickname: string | null } | null;
};

export function mapUserFeedback(row: UserFeedbackWithUsers) {
  return {
    id: row.id,
    userId: row.userId,
    userNickname: row.user?.nickname ?? null,
    score: row.score ?? null,
    category: row.category,
    content: row.content ?? null,
    pagePath: row.pagePath ?? null,
    replayId: row.replayId ?? null,
    status: row.status,
    handleRemark: row.handleRemark ?? null,
    handledBy: row.handledBy ?? null,
    handlerNickname: row.handler?.nickname ?? null,
    handledAt: formatNullableDateTime(row.handledAt),
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureUserFeedbackExists(id: number) {
  const [row] = await db.select().from(userFeedbacks).where(eq(userFeedbacks.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '反馈不存在' });
  return row;
}

export interface CreateUserFeedbackData {
  score?: number | null;
  category: UserFeedbackCategory;
  content?: string | null;
  pagePath?: string | null;
  replayId?: string | null;
}

export async function createUserFeedback(data: CreateUserFeedbackData) {
  const user = currentUser();
  const [created] = await db.insert(userFeedbacks).values({
    userId: user.userId,
    score: data.score ?? null,
    category: data.category,
    content: data.content?.trim() || null,
    pagePath: data.pagePath ?? null,
    replayId: data.replayId ?? null,
  }).returning();
  return mapUserFeedback(created);
}

export interface ListUserFeedbacksQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  category?: UserFeedbackCategory;
  status?: UserFeedbackStatus;
  startTime?: string;
  endTime?: string;
}

function buildListWhere(q: ListUserFeedbacksQuery) {
  const conditions = [];
  conditions.push(keywordCondition(q.keyword, [userFeedbacks.content]));
  if (q.category) conditions.push(eq(userFeedbacks.category, q.category));
  if (q.status) conditions.push(eq(userFeedbacks.status, q.status));
  const startTime = parseDateRangeStart(q.startTime);
  const endTime = parseDateRangeEnd(q.endTime);
  if (startTime) conditions.push(gte(userFeedbacks.createdAt, startTime));
  if (endTime) conditions.push(lte(userFeedbacks.createdAt, endTime));
  return buildWhere(...conditions);
}

export async function listUserFeedbacks(q: ListUserFeedbacksQuery) {
  const page = Number(q.page) || 1;
  const pageSize = Number(q.pageSize) || 10;
  const where = buildListWhere(q);
  const [total, rows] = await Promise.all([
    db.$count(userFeedbacks, where),
    db.query.userFeedbacks.findMany({
      where,
      with: {
        user: { columns: { nickname: true } },
        handler: { columns: { nickname: true } },
      },
      orderBy: desc(userFeedbacks.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
  ]);
  return { list: rows.map(mapUserFeedback), total, page, pageSize };
}

export interface HandleUserFeedbackData {
  status: UserFeedbackStatus;
  handleRemark?: string | null;
}

export async function handleUserFeedback(id: number, data: HandleUserFeedbackData) {
  const user = currentUser();
  const handled = data.status !== 'pending';
  await db.update(userFeedbacks).set({
    status: data.status,
    handleRemark: data.handleRemark?.trim() || null,
    handledBy: handled ? user.userId : null,
    handledAt: handled ? new Date() : null,
  }).where(eq(userFeedbacks.id, id));
  const row = await db.query.userFeedbacks.findFirst({
    where: eq(userFeedbacks.id, id),
    with: {
      user: { columns: { nickname: true } },
      handler: { columns: { nickname: true } },
    },
  });
  if (!row) throw new HTTPException(404, { message: '反馈不存在' });

  // 处理结果通知提交人（自己处理自己的反馈不通知）；失败不阻断处理主流程
  if (handled && row.userId !== user.userId) {
    try {
      const remark = row.handleRemark ? `，处理备注：${row.handleRemark.slice(0, 100)}` : '。';
      await notify('platform.feedback.handled', {
        recipients: [{ type: 'user', id: row.userId }],
        vars: { feedbackId: row.id, statusText: `已标记为「${USER_FEEDBACK_STATUS_LABELS[row.status]}」`, remark },
        tenantId: null,
      });
    } catch (err) {
      logger.warn('[feedback] 处理结果通知发送失败', { id, err });
    }
  }
  return mapUserFeedback(row);
}

export async function deleteUserFeedback(id: number) {
  await db.delete(userFeedbacks).where(eq(userFeedbacks.id, id));
}

export async function batchDeleteUserFeedbacks(ids: number[]) {
  const result = await db.delete(userFeedbacks).where(inArray(userFeedbacks.id, ids)).returning({ id: userFeedbacks.id });
  return result.length;
}
