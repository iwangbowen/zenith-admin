/**
 * 报表数据预警 Service —— CRUD + 阈值评估 + Cron 到期分发。
 * 评估：对数据集取数结果按聚合方式算出实际值，与阈值按运算符比较；
 * 触发时经站内信/邮件通知。复用 getDatasetData 取数与既有通知通道。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { CronExpressionParser } from 'cron-parser';
import { db } from '../db';
import { reportAlertRules } from '../db/schema';
import { pageOffset } from '../lib/pagination';
import { escapeLike } from '../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../lib/datetime';
import logger from '../lib/logger';
import { getDatasetData, assertDatasetEvaluableGlobally } from './report-dataset.service';
import { sendEmail } from './email-send-logs.service';
import { sendInApp } from './in-app-messages.service';
import { rethrowPgUniqueViolation } from '../lib/db-errors';
import type { ReportAlertRuleRow } from '../db/schema';
import type {
  ReportAlertRule, ReportAlertOp, ReportAlertAggregate,
  CreateReportAlertInput, UpdateReportAlertInput,
} from '@zenith/shared';

type AlertRowExt = ReportAlertRuleRow & { dataset?: { name: string } | null };

const OP_LABEL: Record<ReportAlertOp, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤', eq: '=', neq: '≠' };

export function mapAlert(row: AlertRowExt): ReportAlertRule {
  return {
    id: row.id,
    name: row.name,
    datasetId: row.datasetId,
    datasetName: row.dataset?.name ?? null,
    field: row.field ?? null,
    aggregate: row.aggregate as ReportAlertAggregate,
    op: row.op as ReportAlertOp,
    threshold: row.threshold ?? 0,
    cron: row.cron ?? null,
    channels: (row.channels ?? []) as Array<'email' | 'inApp'>,
    recipients: row.recipients ?? null,
    enabled: row.enabled,
    lastCheckedAt: formatNullableDateTime(row.lastCheckedAt),
    lastTriggered: row.lastTriggered ?? null,
    lastValue: row.lastValue ?? null,
    remark: row.remark ?? null,
    createdBy: row.createdBy ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export async function ensureAlertExists(id: number): Promise<ReportAlertRuleRow> {
  const [row] = await db.select().from(reportAlertRules).where(eq(reportAlertRules.id, id)).limit(1);
  if (!row) throw new HTTPException(404, { message: '预警规则不存在' });
  return row;
}

export async function getAlert(id: number): Promise<ReportAlertRule> {
  const row = await db.query.reportAlertRules.findFirst({
    where: eq(reportAlertRules.id, id),
    with: { dataset: { columns: { name: true } } },
  });
  if (!row) throw new HTTPException(404, { message: '预警规则不存在' });
  return mapAlert(row);
}

export async function listAlerts(query: { page?: number; pageSize?: number; keyword?: string; datasetId?: number; enabled?: boolean }) {
  const { page = 1, pageSize = 20, keyword, datasetId, enabled } = query;
  const conds = [];
  if (keyword) conds.push(or(ilike(reportAlertRules.name, `%${escapeLike(keyword)}%`), ilike(reportAlertRules.remark, `%${escapeLike(keyword)}%`)));
  if (datasetId) conds.push(eq(reportAlertRules.datasetId, datasetId));
  if (enabled !== undefined) conds.push(eq(reportAlertRules.enabled, enabled));
  const where = conds.length ? and(...conds) : undefined;
  const [total, rows] = await Promise.all([
    db.$count(reportAlertRules, where),
    db.query.reportAlertRules.findMany({
      where, with: { dataset: { columns: { name: true } } },
      orderBy: desc(reportAlertRules.id), limit: pageSize, offset: pageOffset(page, pageSize),
    }),
  ]);
  return { list: rows.map(mapAlert), total, page, pageSize };
}

function validateCron(cron?: string | null): void {
  if (!cron) return;
  try { CronExpressionParser.parse(cron); } catch { throw new HTTPException(400, { message: 'Cron 表达式无效' }); }
}

export async function createAlert(input: CreateReportAlertInput): Promise<ReportAlertRule> {
  await assertDatasetEvaluableGlobally(input.datasetId);
  validateCron(input.cron);
  try {
    const [row] = await db.insert(reportAlertRules).values({
      name: input.name,
      datasetId: input.datasetId,
      field: input.field ?? null,
      aggregate: input.aggregate ?? 'sum',
      op: input.op ?? 'gt',
      threshold: input.threshold,
      cron: input.cron ?? null,
      channels: (input.channels ?? []) as Array<'email' | 'inApp'>,
      recipients: input.recipients,
      enabled: input.enabled ?? true,
      remark: input.remark,
    }).returning();
    return mapAlert(row);
  } catch (err) {
    rethrowPgUniqueViolation(err, '预警规则名称已存在');
    throw err;
  }
}

export async function updateAlert(id: number, input: UpdateReportAlertInput): Promise<ReportAlertRule> {
  await ensureAlertExists(id);
  if (input.datasetId) await assertDatasetEvaluableGlobally(input.datasetId);
  validateCron(input.cron);
  const [row] = await db.update(reportAlertRules).set({
    name: input.name,
    datasetId: input.datasetId,
    field: input.field,
    aggregate: input.aggregate,
    op: input.op,
    threshold: input.threshold,
    cron: input.cron,
    channels: input.channels as Array<'email' | 'inApp'> | undefined,
    recipients: input.recipients,
    enabled: input.enabled,
    remark: input.remark,
  }).where(eq(reportAlertRules.id, id)).returning();
  if (!row) throw new HTTPException(404, { message: '预警规则不存在' });
  return mapAlert(row);
}

export async function deleteAlert(id: number): Promise<void> {
  await ensureAlertExists(id);
  await db.delete(reportAlertRules).where(eq(reportAlertRules.id, id));
}

// ─── 评估 ────────────────────────────────────────────────────────────────────

function toNum(v: unknown): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function aggregate(rows: Record<string, unknown>[], field: string | null | undefined, agg: ReportAlertAggregate): number {
  if (agg === 'count' || !field) return rows.length;
  const nums = rows.map((r) => toNum(r[field]));
  if (nums.length === 0) return 0;
  switch (agg) {
    case 'avg': return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'max': return Math.max(...nums);
    case 'min': return Math.min(...nums);
    case 'first': return toNum(rows[0]?.[field]);
    default: return nums.reduce((a, b) => a + b, 0);
  }
}

function compare(value: number, op: ReportAlertOp, threshold: number): boolean {
  switch (op) {
    case 'gt': return value > threshold;
    case 'gte': return value >= threshold;
    case 'lt': return value < threshold;
    case 'lte': return value <= threshold;
    case 'eq': return value === threshold;
    case 'neq': return value !== threshold;
    default: return false;
  }
}

/** 评估单条规则：取数→聚合→比较；触发则通知。返回 { value, triggered } */
export async function evaluateAlert(row: ReportAlertRuleRow): Promise<{ value: number; triggered: boolean }> {
  const data = await getDatasetData(row.datasetId, undefined, 5000);
  const value = aggregate(data.rows, row.field, row.aggregate as ReportAlertAggregate);
  const triggered = compare(value, row.op as ReportAlertOp, row.threshold ?? 0);

  if (triggered) {
    const title = `数据预警 · ${row.name}`;
    const opLabel = OP_LABEL[row.op as ReportAlertOp] ?? row.op;
    const content = `预警规则「${row.name}」已触发。\n实际值：${value}\n条件：${row.aggregate}(${row.field ?? '行数'}) ${opLabel} ${row.threshold}\n触发时间：${formatDateTime(new Date())}`;
    const channels = (row.channels ?? []) as Array<'email' | 'inApp'>;
    if (channels.includes('inApp') && row.createdBy) {
      try { await sendInApp({ userIds: [row.createdBy], title, content, type: 'warning' }); }
      catch (e) { logger.warn('数据预警站内信失败', { id: row.id, err: e instanceof Error ? e.message : String(e) }); }
    }
    if (channels.includes('email') && row.recipients) {
      for (const email of row.recipients.split(',').map((s) => s.trim()).filter(Boolean)) {
        try { await sendEmail({ toEmail: email, subject: title, content }); }
        catch (e) { logger.warn('数据预警邮件失败', { email, err: e instanceof Error ? e.message : String(e) }); }
      }
    }
  }

  await db.update(reportAlertRules)
    .set({ lastCheckedAt: new Date(), lastTriggered: triggered, lastValue: value })
    .where(eq(reportAlertRules.id, row.id));
  return { value, triggered };
}

/** 手动评估 */
export async function evaluateAlertById(id: number): Promise<{ value: number; triggered: boolean }> {
  const row = await ensureAlertExists(id);
  return evaluateAlert(row);
}

/** Cron 分发：扫描启用且配置 cron 的规则，按各自 cron 判断到期后评估 */
export async function dispatchDueAlerts(): Promise<{ checked: number; triggered: number }> {
  const rows = await db.select().from(reportAlertRules).where(eq(reportAlertRules.enabled, true));
  const now = new Date();
  let triggered = 0;
  let checked = 0;
  for (const row of rows) {
    if (!row.cron) continue;
    checked++;
    try {
      const prev = CronExpressionParser.parse(row.cron, { currentDate: now }).prev().toDate();
      const last = row.lastCheckedAt ? new Date(row.lastCheckedAt).getTime() : 0;
      if (prev.getTime() > last) {
        const r = await evaluateAlert(row);
        if (r.triggered) triggered++;
      }
    } catch (e) {
      logger.warn('数据预警分发失败', { id: row.id, err: e instanceof Error ? e.message : String(e) });
    }
  }
  return { checked, triggered };
}
