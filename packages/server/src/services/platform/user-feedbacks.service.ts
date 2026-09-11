import { desc, eq, inArray } from 'drizzle-orm';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db } from '../../db';
import { userFeedbacks } from '../../db/schema';
import type { UserFeedbackRow } from '../../db/schema';
import { userFeedbackContract, USER_FEEDBACK_STATUS_LABELS } from '@zenith/shared/platform';
import type { UserFeedbackCategory, UserFeedbackStatus } from '@zenith/shared/platform';
import { currentUser } from '../../lib/context';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import { buildWhere, dateRangeConditions, keywordCondition } from '../../lib/where-helpers';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
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
  return requireFirstRow(
    db.select().from(userFeedbacks).where(eq(userFeedbacks.id, id)).limit(1),
    '反馈不存在',
  );
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

function buildListWhere(q: QueryOutputOf<typeof userFeedbackContract.list>) {
  return buildWhere(
    keywordCondition(q.keyword, [userFeedbacks.content]),
    q.category ? eq(userFeedbacks.category, q.category) : undefined,
    q.status ? eq(userFeedbacks.status, q.status) : undefined,
    ...dateRangeConditions(userFeedbacks.createdAt, q.startTime, q.endTime),
  );
}

export async function listUserFeedbacks(q: QueryOutputOf<typeof userFeedbackContract.list>) {
  const { page, pageSize } = q;
  const where = buildListWhere(q);
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(userFeedbacks, where),
    rows: () => db.query.userFeedbacks.findMany({
      where,
      with: {
        user: { columns: { nickname: true } },
        handler: { columns: { nickname: true } },
      },
      orderBy: desc(userFeedbacks.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: mapUserFeedback,
  });
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
  const row = requireRow(await db.query.userFeedbacks.findFirst({
    where: eq(userFeedbacks.id, id),
    with: {
      user: { columns: { nickname: true } },
      handler: { columns: { nickname: true } },
    },
  }), '反馈不存在');

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
