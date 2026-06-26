/**
 * 报表订阅推送 Service —— CRUD + 推送执行 + Cron 到期分发。
 * 推送内容：仪表盘关键指标摘要 + 查看链接，经邮件 / 站内信下发。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { CronExpressionParser } from 'cron-parser';
import { db } from '../db';
import { reportDashboardSubscriptions } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';
import logger from '../lib/logger';
import { ensureDashboardExists, getDashboardData } from './report-dashboard.service';
import { sendEmail } from './email-send-logs.service';
import { sendInApp } from './in-app-messages.service';
import type { ReportDashboardSubscriptionRow } from '../db/schema';
import type {
  ReportDashboardSubscription, ReportWidget, ReportDataResult,
  CreateReportSubscriptionInput, UpdateReportSubscriptionInput,
} from '@zenith/shared';

type SubRowExt = ReportDashboardSubscriptionRow & { dashboard?: { name: string } | null };

export function mapSubscription(row: SubRowExt): ReportDashboardSubscription {
  return {
    id: row.id, dashboardId: row.dashboardId, dashboardName: row.dashboard?.name ?? null,
    cron: row.cron, channels: (row.channels ?? []) as Array<'email' | 'inApp'>,
    recipients: row.recipients ?? null, enabled: row.enabled, remark: row.remark ?? null,
    lastRunAt: formatNullableDateTime(row.lastRunAt), createdBy: row.createdBy ?? null,
    createdAt: formatDateTime(row.createdAt), updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureSubscriptionExists(id: number): Promise<ReportDashboardSubscriptionRow> {
  const [row] = await db.select().from(reportDashboardSubscriptions).where(eq(reportDashboardSubscriptions.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '订阅不存在' });
  return row;
}

export async function listSubscriptions(query: { page?: number; pageSize?: number; keyword?: string; dashboardId?: number; enabled?: boolean }) {
  const { page = 1, pageSize = 20, keyword, dashboardId } = query;
  const conds = [];
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

export async function createSubscription(input: CreateReportSubscriptionInput): Promise<ReportDashboardSubscription> {
  await ensureDashboardExists(input.dashboardId);
  validateCron(input.cron);
  const [row] = await db.insert(reportDashboardSubscriptions).values({
    dashboardId: input.dashboardId, cron: input.cron, channels: input.channels as Array<'email' | 'inApp'>,
    recipients: input.recipients, enabled: input.enabled ?? true, remark: input.remark,
  }).returning();
  return mapSubscription(row);
}

export async function updateSubscription(id: number, input: UpdateReportSubscriptionInput): Promise<ReportDashboardSubscription> {
  if (input.cron) validateCron(input.cron);
  const [row] = await db.update(reportDashboardSubscriptions).set({
    dashboardId: input.dashboardId, cron: input.cron, channels: input.channels as Array<'email' | 'inApp'> | undefined,
    recipients: input.recipients, enabled: input.enabled, remark: input.remark,
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

/** 构造摘要文本：列出指标卡的当前值 + 查看链接 */
async function buildSummary(row: ReportDashboardSubscriptionRow): Promise<{ title: string; content: string }> {
  const dash = await ensureDashboardExists(row.dashboardId);
  const widgets = (dash.widgets ?? []) as ReportWidget[];
  const data: Record<string, ReportDataResult> = await getDashboardData(widgets, {});
  const lines: string[] = [];
  for (const w of widgets) {
    if (w.type === 'kpi' && w.datasetId) {
      const rows = data[w.i]?.rows ?? [];
      const f = w.options?.valueField;
      const agg = w.options?.aggregate ?? 'sum';
      let v = 0;
      if (f) {
        const nums = rows.map((r) => toNumber(r[f]));
        v = agg === 'avg' ? (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0)
          : agg === 'max' ? Math.max(0, ...nums) : agg === 'min' ? Math.min(0, ...nums)
          : agg === 'count' ? rows.length : nums.reduce((a, b) => a + b, 0);
      } else v = rows.length;
      lines.push(`· ${w.title}：${v}${w.options?.unit ?? ''}`);
    }
  }
  const base = (process.env.APP_URL ?? process.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const link = `${base}/report/dashboards/${dash.id}/view`;
  const title = `报表推送 · ${dash.name}`;
  const content = `${lines.length ? lines.join('\n') : '（该报表暂无指标卡）'}\n\n查看完整报表：${link}`;
  return { title, content };
}

/** 立即推送某订阅 */
export async function runSubscription(row: ReportDashboardSubscriptionRow): Promise<void> {
  const { title, content } = await buildSummary(row);
  const channels = (row.channels ?? []) as Array<'email' | 'inApp'>;
  if (channels.includes('inApp') && row.createdBy) {
    try { await sendInApp({ userIds: [row.createdBy], title, content, type: 'info' }); }
    catch (e) { logger.warn('报表订阅站内信推送失败', { err: e instanceof Error ? e.message : String(e) }); }
  }
  if (channels.includes('email') && row.recipients) {
    for (const email of row.recipients.split(',').map((s) => s.trim()).filter(Boolean)) {
      try { await sendEmail({ toEmail: email, subject: title, content }); }
      catch (e) { logger.warn('报表订阅邮件推送失败', { email, err: e instanceof Error ? e.message : String(e) }); }
    }
  }
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
