/**
 * 报表订阅推送 Service —— CRUD + 推送执行 + Cron 到期分发。
 * 推送内容：仪表盘关键指标摘要 + 查看链接，经邮件 / 站内信下发。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { CronExpressionParser } from 'cron-parser';
import { db } from '../../db';
import { reportDashboardSubscriptions } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import { assertDashboardEvaluableGlobally, ensureDashboardExists, getDashboardData } from './report-dashboard.service';
import { reportCreateTenantId, reportScopedWhere, reportTenantScope } from './report-access';
import { sendEmail } from '../messaging/email-send-logs.service';
import { sendInApp } from '../messaging/in-app-messages.service';
import { sendWebhookNotification } from '../../lib/webhook-notify';
import {
  maskReportSecret,
  prepareReportSecret,
  resolveReportSecret,
} from './report-secrets';
import type { ReportDashboardSubscriptionRow } from '../../db/schema';
import type {
  ReportDashboardSubscription, ReportWidget, ReportDataResult, ReportNotifyChannel,
  CreateReportSubscriptionInput, UpdateReportSubscriptionInput,
} from '@zenith/shared';

type SubRowExt = ReportDashboardSubscriptionRow & { dashboard?: { name: string } | null };

export function mapSubscription(row: SubRowExt): ReportDashboardSubscription {
  return {
    id: row.id, dashboardId: row.dashboardId, dashboardName: row.dashboard?.name ?? null,
    cron: row.cron, channels: (row.channels ?? []) as ReportNotifyChannel[],
    recipients: row.recipients ?? null, webhookUrl: maskReportSecret(row.webhookUrl),
    enabled: row.enabled, remark: row.remark ?? null,
    lastRunAt: formatNullableDateTime(row.lastRunAt), createdBy: row.createdBy ?? null,
    createdAt: formatDateTime(row.createdAt), updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureSubscriptionExists(id: number): Promise<ReportDashboardSubscriptionRow> {
  const [row] = await db.select().from(reportDashboardSubscriptions)
    .where(reportScopedWhere(reportDashboardSubscriptions, eq(reportDashboardSubscriptions.id, id)))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: '订阅不存在' });
  return row;
}

export async function listSubscriptions(query: { page?: number; pageSize?: number; keyword?: string; dashboardId?: number; enabled?: boolean }) {
  const { page = 1, pageSize = 20, keyword, dashboardId } = query;
  const conds = [];
  const tenantScope = reportTenantScope(reportDashboardSubscriptions);
  if (tenantScope) conds.push(tenantScope);
  if (keyword) conds.push(or(ilike(reportDashboardSubscriptions.cron, `%${escapeLike(keyword)}%`), ilike(reportDashboardSubscriptions.remark, `%${escapeLike(keyword)}%`)));
  if (dashboardId) conds.push(eq(reportDashboardSubscriptions.dashboardId, dashboardId));
  if (query.enabled !== undefined) conds.push(eq(reportDashboardSubscriptions.enabled, query.enabled));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportDashboardSubscriptions, where),
    db.query.reportDashboardSubscriptions.findMany({ where, with: { dashboard: { columns: { name: true } } }, orderBy: desc(reportDashboardSubscriptions.id), limit: pageSize, offset: pageOffset(page, pageSize) }),
  ]);
  return { list: rows.map(mapSubscription), total, page, pageSize };
}

/** channels 含 webhook 时必须提供 webhookUrl */
function validateWebhook(channels: ReportNotifyChannel[] | undefined, webhookUrl: string | null | undefined): void {
  if (channels?.includes('webhook') && !webhookUrl) {
    throw new HTTPException(400, { message: '选择 Webhook 通道时必须填写 Webhook 地址' });
  }
}

export async function createSubscription(input: CreateReportSubscriptionInput): Promise<ReportDashboardSubscription> {
  await ensureDashboardExists(input.dashboardId);
  await assertDashboardEvaluableGlobally(input.dashboardId);
  validateCron(input.cron);
  validateWebhook(input.channels as ReportNotifyChannel[] | undefined, input.webhookUrl);
  const webhookUrl = prepareReportSecret(input.webhookUrl, null);
  const [row] = await db.insert(reportDashboardSubscriptions).values({
    tenantId: reportCreateTenantId(),
    dashboardId: input.dashboardId, cron: input.cron, channels: input.channels as ReportNotifyChannel[],
    recipients: input.recipients, webhookUrl: webhookUrl ?? null, enabled: input.enabled ?? true, remark: input.remark,
  }).returning();
  return mapSubscription(row);
}

export async function updateSubscription(id: number, input: UpdateReportSubscriptionInput): Promise<ReportDashboardSubscription> {
  const current = await ensureSubscriptionExists(id);
  const dashboardId = input.dashboardId ?? current.dashboardId;
  await ensureDashboardExists(dashboardId);
  await assertDashboardEvaluableGlobally(dashboardId);
  if (input.cron) validateCron(input.cron);
  validateWebhook(
    (input.channels ?? current.channels) as ReportNotifyChannel[],
    input.webhookUrl === undefined ? current.webhookUrl : input.webhookUrl,
  );
  const webhookUrl = prepareReportSecret(input.webhookUrl, current.webhookUrl);
  const [row] = await db.update(reportDashboardSubscriptions).set({
    dashboardId: input.dashboardId, cron: input.cron, channels: input.channels as ReportNotifyChannel[] | undefined,
    recipients: input.recipients, webhookUrl, enabled: input.enabled, remark: input.remark,
  }).where(eq(reportDashboardSubscriptions.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '订阅不存在' });
  return mapSubscription(row);
}

export async function deleteSubscription(id: number): Promise<void> {
  await ensureSubscriptionExists(id);
  await db.delete(reportDashboardSubscriptions).where(eq(reportDashboardSubscriptions.id, id));
}

function validateCron(cron: string) {
  try { CronExpressionParser.parse(cron); } catch { throw new HTTPException(400, { message: 'Cron 表达式无效' }); }
}

function toNumber(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

/** 计算 KPI 组件的聚合值（与前端 WidgetRenderer 聚合逻辑对齐） */
function calcKpiValue(rows: Record<string, unknown>[], field: string | undefined, agg: string): number {
  if (!field) return rows.length;
  const nums = rows.map((r) => toNumber(r[field]));
  switch (agg) {
    case 'avg': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
    case 'max': return Math.max(0, ...nums);
    case 'min': return Math.min(0, ...nums);
    case 'count': return rows.length;
    default: return nums.reduce((a, b) => a + b, 0);
  }
}

interface SummaryLine { title: string; value: number; unit: string; deltaPct: number | null }

function trendText(deltaPct: number | null): string {
  if (deltaPct === null) return '';
  if (deltaPct > 0) return `（较上期 ↑ ${deltaPct.toFixed(1)}%）`;
  if (deltaPct < 0) return `（较上期 ↓ ${Math.abs(deltaPct).toFixed(1)}%）`;
  return '（较上期持平）';
}

function trendHtml(deltaPct: number | null): string {
  if (deltaPct === null) return '';
  if (deltaPct > 0) return ` <span style="color:#f5222d">▲ ${deltaPct.toFixed(1)}%</span>`;
  if (deltaPct < 0) return ` <span style="color:#52c41a">▼ ${Math.abs(deltaPct).toFixed(1)}%</span>`;
  return ' <span style="color:#8c8c8c">— 持平</span>';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 构造推送摘要：指标卡当前值 + 与上次推送的环比趋势 + 查看链接。
 * 返回 text（站内信）与 html（邮件通道本身按 HTML 发送）双格式，以及本期快照（供落库做下期环比基准）。
 */
async function buildSummary(row: ReportDashboardSubscriptionRow): Promise<{ title: string; text: string; html: string; snapshot: Record<string, number> }> {
  await assertDashboardEvaluableGlobally(row.dashboardId);
  const dash = await ensureDashboardExists(row.dashboardId);
  const widgets = (dash.widgets ?? []) as ReportWidget[];
  const data: Record<string, ReportDataResult> = await getDashboardData(widgets, {});
  const prevSnapshot = (row.lastSummary ?? {}) as Record<string, number>;
  const lines: SummaryLine[] = [];
  const snapshot: Record<string, number> = {};
  for (const w of widgets) {
    if (w.type !== 'kpi' || !w.datasetId) continue;
    const rows = data[w.i]?.rows ?? [];
    const value = calcKpiValue(rows, w.options?.valueField as string | undefined, String(w.options?.aggregate ?? 'sum'));
    const prev = prevSnapshot[w.i];
    const deltaPct = typeof prev === 'number' && prev !== 0 ? ((value - prev) / Math.abs(prev)) * 100 : null;
    lines.push({ title: w.title, value, unit: String(w.options?.unit ?? ''), deltaPct });
    snapshot[w.i] = value;
  }
  const base = (process.env.APP_URL ?? process.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const link = `${base}/report/dashboards/${dash.id}/view`;
  const title = `报表推送 · ${dash.name}`;
  const text = lines.length
    ? `${lines.map((l) => `· ${l.title}：${l.value}${l.unit}${trendText(l.deltaPct)}`).join('\n')}\n\n查看完整报表：${link}`
    : `（该报表暂无指标卡）\n\n查看完整报表：${link}`;
  const html = [
    `<h3 style="margin:0 0 12px">${escapeHtml(dash.name)}</h3>`,
    lines.length
      ? `<table style="border-collapse:collapse">${lines.map((l) =>
        `<tr><td style="padding:4px 16px 4px 0;color:#595959">${escapeHtml(l.title)}</td>` +
        `<td style="padding:4px 0;font-weight:600">${l.value}${escapeHtml(l.unit)}${trendHtml(l.deltaPct)}</td></tr>`).join('')}</table>`
      : '<p style="color:#8c8c8c">（该报表暂无指标卡）</p>',
    `<p style="margin-top:16px"><a href="${escapeHtml(link)}">查看完整报表 →</a></p>`,
  ].join('');
  return { title, text, html, snapshot };
}

/** 立即推送某订阅（推送后落本期 KPI 快照，供下期环比） */
export async function runSubscription(row: ReportDashboardSubscriptionRow): Promise<void> {
  const { title, text, html, snapshot } = await buildSummary(row);
  const channels = (row.channels ?? []) as ReportNotifyChannel[];
  if (channels.includes('inApp') && row.createdBy) {
    try { await sendInApp({ userIds: [row.createdBy], title, content: text, type: 'info' }); }
    catch (e) { logger.warn('报表订阅站内信推送失败', { err: e instanceof Error ? e.message : String(e) }); }
  }
  if (channels.includes('email') && row.recipients) {
    for (const email of row.recipients.split(',').map((s) => s.trim()).filter(Boolean)) {
      try { await sendEmail({ toEmail: email, subject: title, content: html }); }
      catch (e) { logger.warn('报表订阅邮件推送失败', { email, err: e instanceof Error ? e.message : String(e) }); }
    }
  }
  if (channels.includes('webhook') && row.webhookUrl) {
    try {
      const webhookUrl = resolveReportSecret(row.webhookUrl);
      if (!webhookUrl) throw new Error('Webhook 地址无法解密');
      await sendWebhookNotification(webhookUrl, title, text);
    }
    catch (e) { logger.warn('报表订阅 Webhook 推送失败', { id: row.id, err: e instanceof Error ? e.message : String(e) }); }
  }
  try { await db.update(reportDashboardSubscriptions).set({ lastSummary: snapshot }).where(eq(reportDashboardSubscriptions.id, row.id)); }
  catch (e) { logger.warn('报表订阅快照落库失败', { id: row.id, err: e instanceof Error ? e.message : String(e) }); }
}

export async function runSubscriptionById(id: number): Promise<void> {
  const row = await ensureSubscriptionExists(id);
  await runSubscription(row);
  await db.update(reportDashboardSubscriptions).set({ lastRunAt: new Date() }).where(eq(reportDashboardSubscriptions.id, id));
}

/** Cron 分发：扫描启用订阅，按各自 cron 判断是否到期并推送（供 pg-boss handler 每分钟调用）*/
export async function dispatchDueSubscriptions(): Promise<{ checked: number; pushed: number }> {
  const subs = await db.select().from(reportDashboardSubscriptions).where(eq(reportDashboardSubscriptions.enabled, true));
  const now = new Date();
  let pushed = 0;
  for (const sub of subs) {
    try {
      const interval = CronExpressionParser.parse(sub.cron, { currentDate: now });
      const prev = interval.prev().toDate();
      const last = sub.lastRunAt ? new Date(sub.lastRunAt).getTime() : 0;
      if (prev.getTime() > last) {
        await runSubscription(sub);
        await db.update(reportDashboardSubscriptions).set({ lastRunAt: now }).where(eq(reportDashboardSubscriptions.id, sub.id));
        pushed++;
      }
    } catch (e) {
      logger.warn('报表订阅分发失败', { id: sub.id, err: e instanceof Error ? e.message : String(e) });
    }
  }
  return { checked: subs.length, pushed };
}
