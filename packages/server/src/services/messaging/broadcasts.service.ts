/**
 * 运营群发（通知中心级）。
 *
 * 群发不是新的发送通道:活动只是「受众 × 渠道 × 文案」的载体,
 * 发送时经任务中心分批调用 notify()(hidden 事件 messaging.broadcast),
 * 渠道投递、偏好与免打扰全部复用通知派发层;批次 dedupeKey 保证断点重跑幂等。
 * 群发是平台级运营动作,列表不做租户隔离(tenantId 仅透传给 outbox 用于站内信落租户)。
 */
import { desc, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { requireFirstRow, requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import type { BroadcastChannel, CreateBroadcastInput, UpdateBroadcastInput, broadcastContract } from '@zenith/shared/messaging';
import type { QueryOutputOf } from '@zenith/shared/core';
import { db } from '../../db';
import { broadcastCampaigns, members, users, type BroadcastCampaignRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { formatNullableDateTime, formatTimestamps } from '../../lib/datetime';
import { mapAsyncTask, submitAsyncTask } from '../../lib/task-center';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';

export function mapBroadcast(row: BroadcastCampaignRow & { creator?: { nickname: string } | null }) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    link: row.link ?? null,
    channels: row.channels as BroadcastChannel[],
    audienceType: row.audienceType,
    audienceIds: row.audienceIds,
    status: row.status,
    totalRecipients: row.totalRecipients ?? null,
    enqueuedCount: row.enqueuedCount,
    taskId: row.taskId ?? null,
    sentAt: formatNullableDateTime(row.sentAt),
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    createdByName: row.creator?.nickname ?? null,
    ...formatTimestamps(row),
  };
}

export async function ensureBroadcastExists(id: number): Promise<BroadcastCampaignRow> {
  return requireFirstRow(
    db.select().from(broadcastCampaigns).where(eq(broadcastCampaigns.id, id)).limit(1),
    '群发活动不存在',
  );
}

export async function listBroadcasts(q: QueryOutputOf<typeof broadcastContract.list>) {
  const { page, pageSize } = q;
  const where = buildWhere(
    keywordCondition(q.keyword, [broadcastCampaigns.title, broadcastCampaigns.content, broadcastCampaigns.remark]),
    q.status ? eq(broadcastCampaigns.status, q.status) : undefined,
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(broadcastCampaigns, where),
    rows: () => db.query.broadcastCampaigns.findMany({
      where,
      with: { creator: { columns: { nickname: true } } },
      orderBy: desc(broadcastCampaigns.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
    }),
    map: mapBroadcast,
  });
}

export async function getBroadcast(id: number) {
  const row = requireRow(await db.query.broadcastCampaigns.findFirst({
    where: eq(broadcastCampaigns.id, id),
    with: { creator: { columns: { nickname: true } } },
  }), '群发活动不存在');
  return mapBroadcast(row);
}

export async function getBroadcastBeforeAudit(id: number) {
  return mapBroadcast(await ensureBroadcastExists(id));
}

export async function createBroadcast(data: CreateBroadcastInput) {
  const [row] = await db.insert(broadcastCampaigns)
    .values({ ...data, createdBy: currentUser().userId })
    .returning();
  return mapBroadcast(row);
}

export async function updateBroadcast(id: number, data: UpdateBroadcastInput) {
  const existing = await ensureBroadcastExists(id);
  if (existing.status !== 'draft' && existing.status !== 'failed' && existing.status !== 'cancelled') {
    throw new HTTPException(400, { message: '仅草稿/失败/已取消状态可编辑' });
  }
  const [row] = await db.update(broadcastCampaigns)
    // 编辑后回到草稿,清掉上次发送痕迹
    .set({ ...data, updatedBy: currentUser().userId, status: 'draft', taskId: null, totalRecipients: null, enqueuedCount: 0, sentAt: null })
    .where(eq(broadcastCampaigns.id, id))
    .returning();
  return mapBroadcast(row);
}

export async function deleteBroadcast(id: number) {
  const existing = await ensureBroadcastExists(id);
  if (existing.status === 'sending') {
    throw new HTTPException(400, { message: '发送中的活动不可删除,请先在任务中心取消' });
  }
  await db.delete(broadcastCampaigns).where(eq(broadcastCampaigns.id, id));
}

// ─── 受众解析与发送 ───────────────────────────────────────────────────────────

export type BroadcastRecipientRef = { type: 'user' | 'member'; id: number };

/** 解析受众为收件人列表（发送时快照;仅启用状态的主体） */
export async function resolveBroadcastAudience(row: BroadcastCampaignRow): Promise<BroadcastRecipientRef[]> {
  switch (row.audienceType) {
    case 'all_users': {
      const rows = await db.select({ id: users.id }).from(users).where(eq(users.status, 'enabled'));
      return rows.map((r) => ({ type: 'user' as const, id: r.id }));
    }
    case 'all_members': {
      const rows = await db.select({ id: members.id }).from(members).where(eq(members.status, 'active'));
      return rows.map((r) => ({ type: 'member' as const, id: r.id }));
    }
    case 'user_ids': {
      if (row.audienceIds.length === 0) return [];
      const rows = await db.select({ id: users.id }).from(users)
        .where(buildWhere(inArray(users.id, row.audienceIds), eq(users.status, 'enabled')));
      return rows.map((r) => ({ type: 'user' as const, id: r.id }));
    }
    case 'member_ids': {
      if (row.audienceIds.length === 0) return [];
      const rows = await db.select({ id: members.id }).from(members)
        .where(buildWhere(inArray(members.id, row.audienceIds), eq(members.status, 'active')));
      return rows.map((r) => ({ type: 'member' as const, id: r.id }));
    }
    default:
      return [];
  }
}

/** 发送:置为 sending 并提交任务中心任务(同活动幂等,重复点击返回已有任务) */
export async function sendBroadcast(id: number) {
  const existing = await ensureBroadcastExists(id);
  if (existing.status === 'sending') throw new HTTPException(400, { message: '活动正在发送中' });
  if (existing.status === 'sent') throw new HTTPException(400, { message: '活动已发送,不可重复发送' });
  if (existing.channels.length === 0) throw new HTTPException(400, { message: '未配置投递渠道' });

  const task = await submitAsyncTask({
    taskType: 'messaging-broadcast',
    title: `运营群发「${existing.title}」`,
    payload: { campaignId: id },
    idempotencyKey: `broadcast-send-${id}-${Date.now()}`,
  });
  await db.update(broadcastCampaigns)
    .set({ status: 'sending', taskId: task.id, enqueuedCount: 0, totalRecipients: null, sentAt: null })
    .where(eq(broadcastCampaigns.id, id));
  return mapAsyncTask(task);
}
