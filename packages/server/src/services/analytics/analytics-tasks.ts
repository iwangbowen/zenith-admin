/**
 * 埋点每日聚合重建任务中心化（同步 rebuildRollup 接口经任务中心异步执行）。
 * rebuildRollup 本身按 SQL GROUP BY 一次性处理全部租户，暂不支持按日期/维度切片续跑；
 * 此处仍需通过任务中心异步化执行，保证大范围重建不阻塞请求线程，并具备重复提交拦截 + 自动重试。
 */
import { registerTaskHandler } from '../../lib/task-center';
import { db } from '../../db';
import { analyticsSegmentCampaigns, analyticsSegmentMembers, inAppTemplates, members, users } from '../../db/schema';
import { eq, inArray } from 'drizzle-orm';
import { currentUserOrNull } from '../../lib/context';
import { httpPost } from '../../lib/http-client';
import { rebuildRollup } from './analytics-rollup.service';
import { materializeSegment } from './analytics-segments.service';
import { sendEmail } from '../messaging/email-send-logs.service';
import { sendJobInApp } from '../messaging/in-app-messages.service';
import { sendSms } from '../messaging/sms-send-logs.service';
import { renderTemplate } from '../../lib/sms-sender';
import { ensureShortLink } from '../short-link/short-link.service';
import { ANALYTICS_CAMPAIGN_EXECUTE_TASK_TYPE } from './analytics-campaigns.service';

export const ANALYTICS_ROLLUP_REBUILD_TASK_TYPE = 'analytics-rollup-rebuild';
export const ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE = 'analytics-segment-materialize';

function truncateError(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function updateCampaignResult(id: number, patch: Partial<typeof analyticsSegmentCampaigns.$inferInsert>) {
  await db.update(analyticsSegmentCampaigns).set(patch).where(eq(analyticsSegmentCampaigns.id, id));
}

type SegmentMember = typeof analyticsSegmentMembers.$inferSelect;

async function loadMemberNames(rows: SegmentMember[]) {
  const userIds = rows.map((r) => r.userId).filter((id): id is number => typeof id === 'number');
  const memberIds = rows.map((r) => r.memberId).filter((id): id is number => typeof id === 'number');
  const [adminRows, memberRows] = await Promise.all([
    userIds.length ? db.select({ id: users.id, email: users.email, name: users.nickname, phone: users.phone }).from(users).where(inArray(users.id, userIds)) : Promise.resolve([]),
    memberIds.length ? db.select({ id: members.id, email: members.email, name: members.nickname, phone: members.phone }).from(members).where(inArray(members.id, memberIds)) : Promise.resolve([]),
  ]);
  return {
    admins: new Map(adminRows.map((u) => [u.id, u])),
    members: new Map(memberRows.map((m) => [m.id, m])),
  };
}

/**
 * 配置了落地页时幂等生成短链（bizType=campaign），返回注入模板的公共变量。
 * email/in_app/sms 模板均可通过 {{shortUrl}} 引用，点击数据回流到活动指标。
 */
async function buildCampaignVariables(campaign: typeof analyticsSegmentCampaigns.$inferSelect): Promise<Record<string, string>> {
  if (!campaign.landingUrl) return {};
  const link = await ensureShortLink({
    targetUrl: campaign.landingUrl,
    bizType: 'campaign',
    bizRef: String(campaign.id),
    title: campaign.name,
    tenantId: campaign.tenantId ?? null,
  });
  return { shortUrl: link.shortUrl };
}

async function executeEmailCampaign(campaign: typeof analyticsSegmentCampaigns.$inferSelect, rows: SegmentMember[], extraVars: Record<string, string>, onProgress: (processed: number, note: string) => Promise<void>) {
  const contacts = await loadMemberNames(rows);
  const targets = new Map<string, { email: string; name: string }>();
  let failed = 0;
  for (const row of rows) {
    const contact = row.identityType === 'admin' && row.userId ? contacts.admins.get(row.userId) : row.identityType === 'member' && row.memberId ? contacts.members.get(row.memberId) : null;
    if (!contact?.email) {
      failed += 1;
      continue;
    }
    if (!targets.has(contact.email)) targets.set(contact.email, { email: contact.email, name: contact.name || contact.email });
  }
  let sent = 0;
  let processed = failed;
  for (const batch of chunk([...targets.values()], 50)) {
    for (const target of batch) {
      const res = await sendEmail({ toEmail: target.email, templateId: campaign.templateId ?? undefined, variables: { name: target.name, ...extraVars } }, 'system');
      if (res.status === 'success') sent += 1;
      else failed += 1;
    }
    processed += batch.length;
    await onProgress(processed, `邮件触达 ${processed}/${rows.length}`);
  }
  return { sent, failed };
}

async function executeInAppCampaign(campaign: typeof analyticsSegmentCampaigns.$inferSelect, rows: SegmentMember[], extraVars: Record<string, string>, onProgress: (processed: number, note: string) => Promise<void>) {
  const adminRows = rows.filter((row) => row.identityType === 'admin' && row.userId);
  const failed = rows.length - adminRows.length;
  const contacts = await loadMemberNames(adminRows);
  const [tpl] = await db.select().from(inAppTemplates).where(eq(inAppTemplates.id, campaign.templateId ?? 0)).limit(1);
  if (!tpl) throw new Error('站内信模板不存在');
  let sent = 0;
  let processed = failed;
  for (const batch of chunk(adminRows, 50)) {
    for (const row of batch) {
      const userId = row.userId!;
      const name = contacts.admins.get(userId)?.name ?? String(userId);
      const variables = { name, ...extraVars };
      const result = await sendJobInApp({
        userIds: [userId],
        templateId: campaign.templateId ?? undefined,
        title: renderTemplate(tpl.title, variables),
        content: renderTemplate(tpl.content, variables),
        type: tpl.type,
        variables,
      }, { tenantId: campaign.tenantId ?? null, senderId: currentUserOrNull()?.userId ?? campaign.createdBy });
      sent += result.sentCount;
    }
    processed += batch.length;
    await onProgress(processed, `站内信触达 ${processed}/${rows.length}`);
  }
  return { sent, failed };
}

/** 短信触达：按手机号去重后逐条发送（sendSms 内部写发送留痕，计费口径与手动群发一致） */
async function executeSmsCampaign(campaign: typeof analyticsSegmentCampaigns.$inferSelect, rows: SegmentMember[], extraVars: Record<string, string>, onProgress: (processed: number, note: string) => Promise<void>) {
  if (!campaign.templateId) throw new Error('短信模板不存在');
  const contacts = await loadMemberNames(rows);
  const targets = new Map<string, { phone: string; name: string }>();
  let failed = 0;
  for (const row of rows) {
    const contact = row.identityType === 'admin' && row.userId ? contacts.admins.get(row.userId) : row.identityType === 'member' && row.memberId ? contacts.members.get(row.memberId) : null;
    if (!contact?.phone) {
      failed += 1;
      continue;
    }
    if (!targets.has(contact.phone)) targets.set(contact.phone, { phone: contact.phone, name: contact.name || contact.phone });
  }
  let sent = 0;
  let processed = failed;
  for (const batch of chunk([...targets.values()], 50)) {
    for (const target of batch) {
      try {
        const res = await sendSms({ templateId: campaign.templateId, phone: target.phone, variables: { name: target.name, ...extraVars } }, 'system');
        if (res.status === 'success') sent += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    processed += batch.length;
    await onProgress(processed, `短信触达 ${processed}/${rows.length}`);
  }
  return { sent, failed };
}

async function executeWebhookCampaign(campaign: typeof analyticsSegmentCampaigns.$inferSelect, rows: SegmentMember[], onProgress: (processed: number, note: string) => Promise<void>) {
  if (!campaign.webhookUrl) throw new Error('Webhook URL 为空');
  let sent = 0;
  let failed = 0;
  let processed = 0;
  const batches = chunk(rows, 500);
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    const res = await httpPost(campaign.webhookUrl, {
      campaignId: campaign.id,
      segmentId: campaign.segmentId,
      batchIndex: i,
      members: batch.map((row) => ({ distinctId: row.distinctId, identityType: row.identityType, userId: row.userId, memberId: row.memberId })),
    }, { timeout: 10_000, ssrfProtection: true });
    if (res.ok) sent += batch.length;
    else failed += batch.length;
    processed += batch.length;
    await onProgress(processed, `Webhook 触达 ${processed}/${rows.length}`);
  }
  return { sent, failed };
}

export function registerAnalyticsTaskHandlers(): void {
  registerTaskHandler({
    taskType: ANALYTICS_ROLLUP_REBUILD_TASK_TYPE,
    title: '重建埋点每日聚合',
    module: '行为分析',
    description: '重新计算最近 N 天的每日聚合数据（总量 + 低基数维度分布），用于治理规则变更或数据修复后回填看板。',
    allowConcurrent: false,
    maxAttempts: 2,
    retryDelayMs: 30_000,
    async run(ctx) {
      const days = Math.min(Math.max(Number(ctx.payload.days ?? 30), 1), 730);
      await ctx.progress({ note: `开始重建近 ${days} 天聚合…`, checkpoint: { days } });
      const rebuiltRows = await rebuildRollup(days);
      await ctx.progress({ note: `已重建 ${rebuiltRows} 条聚合记录`, checkpoint: { days, rebuiltRows } });
      return { days, rebuiltRows, message: `已重建 ${rebuiltRows} 条聚合记录` };
    },
  });

  registerTaskHandler({
    taskType: ANALYTICS_SEGMENT_MATERIALIZE_TASK_TYPE,
    title: '重算用户分群成员',
    module: '行为分析',
    description: '根据分群规则（事件/属性条件 AND/OR 组合）重新计算并物化分群成员快照，用于圈选后立即可用的成员列表与人数展示。',
    allowConcurrent: false,
    maxAttempts: 2,
    retryDelayMs: 30_000,
    async run(ctx) {
      const segmentId = Number(ctx.payload.segmentId);
      if (!Number.isInteger(segmentId) || segmentId <= 0) throw new Error('无效的分群 ID');
      await ctx.progress({ note: `开始重算分群 #${segmentId} 成员…` });
      // materializeSegment 内部通过 ensureSegmentExists 在恢复后的创建者身份下重新校验 tenant 归属，
      // 防止分群归属发生变化（如租户迁移）后仍越权重算
      const { estimatedSize } = await materializeSegment(segmentId);
      const message = `重算完成，共 ${estimatedSize} 个成员`;
      await ctx.progress({ note: message });
      return { segmentId, estimatedSize, message };
    },
  });

  registerTaskHandler({
    taskType: ANALYTICS_CAMPAIGN_EXECUTE_TASK_TYPE,
    title: '执行分群触达',
    module: '行为分析',
    description: '按已物化分群成员快照执行邮件、站内信或 Webhook 分批触达。',
    allowConcurrent: false,
    maxAttempts: 1,
    async run(ctx) {
      const campaignId = Number(ctx.payload.campaignId);
      if (!Number.isInteger(campaignId) || campaignId <= 0) throw new Error('无效的触达活动 ID');
      try {
        const [campaign] = await db.select().from(analyticsSegmentCampaigns).where(eq(analyticsSegmentCampaigns.id, campaignId)).limit(1);
        if (!campaign) throw new Error('触达活动不存在');
        const rows = await db.select().from(analyticsSegmentMembers).where(eq(analyticsSegmentMembers.segmentId, campaign.segmentId));
        if (rows.length === 0) throw new Error('分群成员快照为空，请先物化分群后再执行触达');
        await updateCampaignResult(campaignId, { totalCount: rows.length, sentCount: 0, failedCount: 0, lastError: null });
        await ctx.progress({ processed: 0, total: rows.length, note: '开始执行分群触达' });
        const onProgress = async (processed: number, note: string) => {
          await ctx.progress({ processed, total: rows.length, note, checkpoint: { processed } });
        };
        // 落地页短链：幂等生成并注入 {{shortUrl}} 模板变量（点击回流活动指标）
        const extraVars = await buildCampaignVariables(campaign);
        const result = campaign.channel === 'email'
          ? await executeEmailCampaign(campaign, rows, extraVars, onProgress)
          : campaign.channel === 'in_app'
            ? await executeInAppCampaign(campaign, rows, extraVars, onProgress)
            : campaign.channel === 'sms'
              ? await executeSmsCampaign(campaign, rows, extraVars, onProgress)
              : await executeWebhookCampaign(campaign, rows, onProgress);
        const finalStatus = result.sent > 0 ? 'completed' : 'failed';
        const lastError = finalStatus === 'failed' ? '全部触达失败' : result.failed > 0 ? `部分触达失败：${result.failed} 条` : null;
        await updateCampaignResult(campaignId, {
          status: finalStatus,
          totalCount: rows.length,
          sentCount: result.sent,
          failedCount: result.failed,
          lastRunAt: new Date(),
          lastError,
        });
        await ctx.progress({ processed: rows.length, total: rows.length, note: finalStatus === 'completed' ? '触达执行完成' : '触达执行失败' });
        return { campaignId, total: rows.length, sent: result.sent, failed: result.failed };
      } catch (err) {
        await updateCampaignResult(campaignId, { status: 'failed', lastRunAt: new Date(), lastError: truncateError(err) });
        throw err;
      }
    },
  });
}
