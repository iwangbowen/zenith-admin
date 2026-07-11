import { and, desc, eq, ne, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CreateAnalyticsCampaignInput, UpdateAnalyticsCampaignInput } from '@zenith/shared';
import { db } from '../../db';
import { analyticsSegmentCampaigns, analyticsUserSegments, emailTemplates, inAppTemplates } from '../../db/schema';
import type { AnalyticsSegmentCampaignRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { currentCreateTenantId, tenantScope } from '../../lib/tenant';
import { mergeWhere, withPagination } from '../../lib/where-helpers';
import { submitAsyncTask } from '../../lib/task-center';
import { ensureSegmentExists } from './analytics-segments.service';

export const ANALYTICS_CAMPAIGN_EXECUTE_TASK_TYPE = 'analytics-campaign-execute';

export interface ListCampaignsQuery {
  page?: number;
  pageSize?: number;
  segmentId?: number;
  status?: 'draft' | 'running' | 'completed' | 'failed';
}

interface CampaignJoinedRow {
  campaign: AnalyticsSegmentCampaignRow;
  segmentName: string | null;
}

export function mapCampaign(row: AnalyticsSegmentCampaignRow, segmentName: string | null = null) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    segmentId: row.segmentId,
    segmentName,
    name: row.name,
    channel: row.channel,
    templateId: row.templateId,
    webhookUrl: row.webhookUrl,
    status: row.status,
    totalCount: row.totalCount,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    lastRunAt: formatNullableDateTime(row.lastRunAt),
    lastError: row.lastError ?? null,
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function mapJoined(row: CampaignJoinedRow) {
  return mapCampaign(row.campaign, row.segmentName);
}

function buildWhere(q: ListCampaignsQuery): SQL | undefined {
  const conditions: SQL[] = [];
  if (q.segmentId) conditions.push(eq(analyticsSegmentCampaigns.segmentId, q.segmentId));
  if (q.status) conditions.push(eq(analyticsSegmentCampaigns.status, q.status));
  return mergeWhere(and(...conditions), tenantScope(analyticsSegmentCampaigns));
}

export async function listCampaigns(q: ListCampaignsQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
  if (q.segmentId) await ensureSegmentExists(q.segmentId);
  const where = buildWhere(q);
  const base = db.select({
    campaign: analyticsSegmentCampaigns,
    segmentName: analyticsUserSegments.name,
  })
    .from(analyticsSegmentCampaigns)
    .leftJoin(analyticsUserSegments, eq(analyticsSegmentCampaigns.segmentId, analyticsUserSegments.id))
    .where(where)
    .orderBy(desc(analyticsSegmentCampaigns.id));
  const [rows, total] = await Promise.all([
    withPagination(base.$dynamic(), page, pageSize),
    db.$count(analyticsSegmentCampaigns, where),
  ]);
  return { list: rows.map(mapJoined), total, page, pageSize };
}

export async function ensureCampaignExists(id: number): Promise<AnalyticsSegmentCampaignRow> {
  const [row] = await db.select().from(analyticsSegmentCampaigns)
    .where(mergeWhere(eq(analyticsSegmentCampaigns.id, id), tenantScope(analyticsSegmentCampaigns)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '触达活动不存在' });
  return row;
}

async function ensureTemplateForChannel(channel: CreateAnalyticsCampaignInput['channel'], templateId?: number | null) {
  if (channel === 'webhook') return;
  if (!templateId) throw new HTTPException(400, { message: '邮件/站内信渠道必须选择模板' });
  const table = channel === 'email' ? emailTemplates : inAppTemplates;
  const [tpl] = await db.select({ id: table.id, status: table.status }).from(table)
    .where(and(eq(table.id, templateId), tenantScope(table)))
    .limit(1);
  if (!tpl) throw new HTTPException(404, { message: channel === 'email' ? '邮件模板不存在' : '站内信模板不存在' });
  if (tpl.status !== 'enabled') throw new HTTPException(400, { message: '模板已禁用' });
}

export async function createCampaign(input: CreateAnalyticsCampaignInput) {
  const segment = await ensureSegmentExists(input.segmentId);
  await ensureTemplateForChannel(input.channel, input.templateId);
  const [row] = await db.insert(analyticsSegmentCampaigns).values({
    tenantId: currentCreateTenantId(),
    segmentId: segment.id,
    name: input.name,
    channel: input.channel,
    templateId: input.channel === 'webhook' ? null : input.templateId ?? null,
    webhookUrl: input.channel === 'webhook' ? input.webhookUrl ?? null : null,
  }).returning();
  return mapCampaign(row, segment.name);
}

export async function updateCampaign(id: number, input: UpdateAnalyticsCampaignInput) {
  const current = await ensureCampaignExists(id);
  if (current.status !== 'draft') throw new HTTPException(400, { message: '仅草稿状态可修改' });
  const nextChannel = input.channel ?? current.channel;
  const nextTemplateId = input.templateId !== undefined ? input.templateId : current.templateId;
  await ensureTemplateForChannel(nextChannel, nextTemplateId);
  const [row] = await db.update(analyticsSegmentCampaigns).set({
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.channel !== undefined ? { channel: input.channel } : {}),
    ...(input.channel === 'webhook' ? { templateId: null } : input.templateId !== undefined ? { templateId: input.templateId } : {}),
    ...(input.channel && input.channel !== 'webhook' ? { webhookUrl: null } : input.webhookUrl !== undefined ? { webhookUrl: input.webhookUrl } : {}),
  }).where(eq(analyticsSegmentCampaigns.id, id)).returning();
  const segment = await ensureSegmentExists(row.segmentId);
  return mapCampaign(row, segment.name);
}

export async function deleteCampaign(id: number) {
  const row = await ensureCampaignExists(id);
  if (row.status === 'running') throw new HTTPException(400, { message: '执行中的触达活动不可删除' });
  await db.delete(analyticsSegmentCampaigns).where(eq(analyticsSegmentCampaigns.id, id));
}

export async function executeCampaign(id: number) {
  const row = await ensureCampaignExists(id);
  if (row.status === 'running') throw new HTTPException(400, { message: '触达活动正在执行中' });
  // 原子 CAS 流转：并发双击时只有一个请求能完成 draft/completed/failed → running 的转换，
  // 仅靠"先查后改"+分钟桶幂等键无法防住跨分钟边界的双提交（会导致全量重复群发）
  const [claimed] = await db.update(analyticsSegmentCampaigns).set({
    status: 'running',
    lastError: null,
  }).where(and(
    eq(analyticsSegmentCampaigns.id, id),
    ne(analyticsSegmentCampaigns.status, 'running'),
  )).returning({ id: analyticsSegmentCampaigns.id });
  if (!claimed) throw new HTTPException(400, { message: '触达活动正在执行中' });
  const minuteBucket = Math.floor(Date.now() / 60_000);
  try {
    return await submitAsyncTask({
      taskType: ANALYTICS_CAMPAIGN_EXECUTE_TASK_TYPE,
      title: `执行分群触达 #${id}`,
      payload: { campaignId: id },
      idempotencyKey: `${ANALYTICS_CAMPAIGN_EXECUTE_TASK_TYPE}:${id}:${row.updatedAt.getTime()}:${minuteBucket}`,
    });
  } catch (err) {
    // 任务提交失败必须回滚状态，否则活动永久卡在 running（不可重跑、不可删除）
    await db.update(analyticsSegmentCampaigns).set({
      status: row.status,
      lastError: '触达任务提交失败，请重试',
    }).where(eq(analyticsSegmentCampaigns.id, id)).catch(() => { /* 回滚失败保持 running，由人工介入 */ });
    throw err;
  }
}
