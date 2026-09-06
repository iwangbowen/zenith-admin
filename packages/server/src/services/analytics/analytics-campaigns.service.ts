import { and, desc, eq, inArray, ne, type SQL } from 'drizzle-orm';
import { requireRow } from '../../lib/db-assert';
import { buildListResult } from '../../lib/list-query';
import { HTTPException } from 'hono/http-exception';
import type { CreateAnalyticsCampaignInput, UpdateAnalyticsCampaignInput } from '@zenith/shared/analytics';
import { db } from '../../db';
import { analyticsSegmentCampaigns, analyticsUserSegments, emailTemplates, inAppTemplates, shortLinks, smsTemplates } from '../../db/schema';
import type { AnalyticsSegmentCampaignRow } from '../../db/schema';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { currentCreateTenantId, tenantScope } from '../../lib/tenant';
import { buildWhere, withPagination } from '../../lib/where-helpers';
import { submitAsyncTask } from '../../lib/task-center';
import { buildShortUrl } from '../short-link/short-link.service';
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

interface CampaignShortLinkInfo {
  shortUrl: string;
  clickCount: number;
}

export function mapCampaign(row: AnalyticsSegmentCampaignRow, segmentName: string | null = null, shortLink: CampaignShortLinkInfo | null = null) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    segmentId: row.segmentId,
    segmentName,
    name: row.name,
    channel: row.channel,
    templateId: row.templateId,
    webhookUrl: row.webhookUrl,
    landingUrl: row.landingUrl ?? null,
    shortUrl: shortLink?.shortUrl ?? null,
    clickCount: shortLink?.clickCount ?? null,
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

/** 批量取触达活动的落地页短链（执行时按 bizType=campaign 幂等生成） */
async function loadCampaignShortLinks(ids: number[]): Promise<Map<number, CampaignShortLinkInfo>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ bizRef: shortLinks.bizRef, code: shortLinks.code, totalPv: shortLinks.totalPv })
    .from(shortLinks)
    .where(and(eq(shortLinks.bizType, 'campaign'), inArray(shortLinks.bizRef, ids.map(String))));
  return new Map(rows
    .filter((r): r is typeof r & { bizRef: string } => r.bizRef !== null)
    .map((r) => [Number(r.bizRef), { shortUrl: buildShortUrl(r.code), clickCount: r.totalPv }]));
}

function mapJoined(row: CampaignJoinedRow, shortLinkMap: Map<number, CampaignShortLinkInfo>) {
  return mapCampaign(row.campaign, row.segmentName, shortLinkMap.get(row.campaign.id) ?? null);
}

function buildCampaignWhere(q: ListCampaignsQuery): SQL | undefined {
  const conditions: SQL[] = [];
  if (q.segmentId) conditions.push(eq(analyticsSegmentCampaigns.segmentId, q.segmentId));
  if (q.status) conditions.push(eq(analyticsSegmentCampaigns.status, q.status));
  return buildWhere(...conditions, tenantScope(analyticsSegmentCampaigns));
}

export async function listCampaigns(q: ListCampaignsQuery) {
  const page = Math.max(Number(q.page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(q.pageSize) || 20, 1), 100);
  if (q.segmentId) await ensureSegmentExists(q.segmentId);
  const where = buildCampaignWhere(q);
  const base = db.select({
    campaign: analyticsSegmentCampaigns,
    segmentName: analyticsUserSegments.name,
  })
    .from(analyticsSegmentCampaigns)
    .leftJoin(analyticsUserSegments, eq(analyticsSegmentCampaigns.segmentId, analyticsUserSegments.id))
    .where(where)
    .orderBy(desc(analyticsSegmentCampaigns.id));
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(analyticsSegmentCampaigns, where),
    rows: async () => {
      const rows = await withPagination(base.$dynamic(), page, pageSize);
      const shortLinkMap = await loadCampaignShortLinks(rows.map((r) => r.campaign.id));
      return rows.map((r) => mapJoined(r, shortLinkMap));
    },
  });
}

export async function ensureCampaignExists(id: number): Promise<AnalyticsSegmentCampaignRow> {
  const [row] = await db.select().from(analyticsSegmentCampaigns)
    .where(buildWhere(eq(analyticsSegmentCampaigns.id, id), tenantScope(analyticsSegmentCampaigns)))
    .limit(1);
  return requireRow(row, '触达活动不存在');
}

async function ensureTemplateForChannel(channel: CreateAnalyticsCampaignInput['channel'], templateId?: number | null) {
  if (channel === 'webhook') return;
  if (!templateId) throw new HTTPException(400, { message: '邮件/站内信/短信渠道必须选择模板' });
  const table = channel === 'email' ? emailTemplates : channel === 'sms' ? smsTemplates : inAppTemplates;
  const [tpl] = await db.select({ id: table.id, status: table.status }).from(table)
    .where(and(eq(table.id, templateId), tenantScope(table)))
    .limit(1);
  if (!tpl) throw new HTTPException(404, { message: channel === 'email' ? '邮件模板不存在' : channel === 'sms' ? '短信模板不存在' : '站内信模板不存在' });
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
    landingUrl: input.landingUrl ?? null,
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
    ...(input.landingUrl !== undefined ? { landingUrl: input.landingUrl } : {}),
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
  requireRow(claimed, '触达活动正在执行中', 400);
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
