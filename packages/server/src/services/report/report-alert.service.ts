/**
 * 报表数据预警 Service —— CRUD + 阈值评估 + Cron 到期分发。
 * 评估：对数据集取数结果按聚合方式算出实际值，与阈值按运算符比较；
 * 触发时经站内信/邮件通知。复用 getDatasetData 取数与既有通知通道。
 * 通知风暴防护：静默期内（silenceMins）持续触发不重复通知；从触发恢复正常可选发送恢复通知（notifyOnRecover）。
 */
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, ilike, or } from 'drizzle-orm';
import { CronExpressionParser } from 'cron-parser';
import { db } from '../../db';
import { reportAlertRules } from '../../db/schema';
import { pageOffset } from '../../lib/pagination';
import { escapeLike } from '../../lib/where-helpers';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import logger from '../../lib/logger';
import { getDatasetData, assertDatasetEvaluableGlobally } from './report-dataset.service';
import { sendEmail } from '../messaging/email-send-logs.service';
import { sendInApp } from '../messaging/in-app-messages.service';
import { sendWebhookNotification } from '../../lib/webhook-notify';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { ReportAlertRuleRow } from '../../db/schema';
import type {
  ReportAlertRule, ReportAlertOp, ReportAlertAggregate, ReportAlertEvalHit, ReportAlertEvalResult, ReportNotifyChannel,
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
    groupByField: row.groupByField ?? null,
    aggregate: row.aggregate as ReportAlertAggregate,
    op: row.op as ReportAlertOp,
    threshold: row.threshold ?? 0,
    cron: row.cron ?? null,
    channels: (row.channels ?? []) as ReportNotifyChannel[],
    recipients: row.recipients ?? null,
    webhookUrl: row.webhookUrl ?? null,
    silenceMins: row.silenceMins ?? 60,
    notifyOnRecover: row.notifyOnRecover ?? false,
    enabled: row.enabled,
    lastCheckedAt: formatNullableDateTime(row.lastCheckedAt),
    lastTriggered: row.lastTriggered ?? null,
    lastValue: row.lastValue ?? null,
    lastNotifiedAt: formatNullableDateTime(row.lastNotifiedAt),
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

/** channels 含 webhook 时必须提供 webhookUrl */
function validateWebhook(channels: ReportNotifyChannel[] | undefined, webhookUrl: string | null | undefined): void {
  if (channels?.includes('webhook') && !webhookUrl) {
    throw new HTTPException(400, { message: '选择 Webhook 通道时必须填写 Webhook 地址' });
  }
}

export async function createAlert(input: CreateReportAlertInput): Promise<ReportAlertRule> {
  await assertDatasetEvaluableGlobally(input.datasetId);
  validateCron(input.cron);
  validateWebhook(input.channels as ReportNotifyChannel[] | undefined, input.webhookUrl);
  try {
    const [row] = await db.insert(reportAlertRules).values({
      name: input.name,
      datasetId: input.datasetId,
      field: input.field ?? null,
      groupByField: input.groupByField ?? null,
      aggregate: input.aggregate ?? 'sum',
      op: input.op ?? 'gt',
      threshold: input.threshold,
      cron: input.cron ?? null,
      channels: (input.channels ?? []) as ReportNotifyChannel[],
      recipients: input.recipients,
      webhookUrl: input.webhookUrl ?? null,
      silenceMins: input.silenceMins ?? 60,
      notifyOnRecover: input.notifyOnRecover ?? false,
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
  const current = await ensureAlertExists(id);
  if (input.datasetId) await assertDatasetEvaluableGlobally(input.datasetId);
  validateCron(input.cron);
  validateWebhook(
    (input.channels ?? current.channels) as ReportNotifyChannel[],
    input.webhookUrl === undefined ? current.webhookUrl : input.webhookUrl,
  );
  const [row] = await db.update(reportAlertRules).set({
    name: input.name,
    datasetId: input.datasetId,
    field: input.field,
    groupByField: input.groupByField,
    aggregate: input.aggregate,
    op: input.op,
    threshold: input.threshold,
    cron: input.cron,
    channels: input.channels as ReportNotifyChannel[] | undefined,
    recipients: input.recipients,
    webhookUrl: input.webhookUrl,
    silenceMins: input.silenceMins,
    notifyOnRecover: input.notifyOnRecover,
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

/** 按字段聚合行集（count/sum/avg/max/min/first），空集返回 0 */
export function aggregate(rows: Record<string, unknown>[], field: string | null | undefined, agg: ReportAlertAggregate): number {
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

/** 比较实际值与阈值（gt/gte/lt/lte/eq/neq） */
export function compare(value: number, op: ReportAlertOp, threshold: number): boolean {
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

/**
 * 分组评估（纯函数）：按 groupByField 分组聚合，任一组命中阈值即触发。
 * value 返回「最极端」组值（gt/gte 取最大，lt/lte 取最小，其余取首个命中或首组），便于观察接近程度。
 */
export function evaluateGroups(
  rows: Record<string, unknown>[],
  groupByField: string,
  field: string | null | undefined,
  agg: ReportAlertAggregate,
  op: ReportAlertOp,
  threshold: number,
): { value: number; triggered: boolean; hits: ReportAlertEvalHit[] } {
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const key = String(r[groupByField] ?? '（空）');
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }
  const hits: ReportAlertEvalHit[] = [];
  const preferMax = op === 'gt' || op === 'gte';
  let extreme: number | null = null;
  for (const [group, groupRows] of groups) {
    const v = aggregate(groupRows, field, agg);
    if (compare(v, op, threshold)) hits.push({ group, value: v });
    if (extreme === null || (preferMax ? v > extreme : v < extreme)) extreme = v;
  }
  const value = hits.length ? (preferMax ? Math.max(...hits.map((h) => h.value)) : Math.min(...hits.map((h) => h.value))) : (extreme ?? 0);
  return { value, triggered: hits.length > 0, hits };
}

/** 按通道发送预警/恢复通知（邮件按 recipients，站内信推给创建者，Webhook 推机器人） */
async function notifyAlert(row: ReportAlertRuleRow, title: string, content: string, type: 'warning' | 'info'): Promise<void> {
  const channels = (row.channels ?? []) as ReportNotifyChannel[];
  if (channels.includes('inApp') && row.createdBy) {
    try { await sendInApp({ userIds: [row.createdBy], title, content, type }); }
    catch (e) { logger.warn('数据预警站内信失败', { id: row.id, err: e instanceof Error ? e.message : String(e) }); }
  }
  if (channels.includes('email') && row.recipients) {
    for (const email of row.recipients.split(',').map((s) => s.trim()).filter(Boolean)) {
      try { await sendEmail({ toEmail: email, subject: title, content }); }
      catch (e) { logger.warn('数据预警邮件失败', { email, err: e instanceof Error ? e.message : String(e) }); }
    }
  }
  if (channels.includes('webhook') && row.webhookUrl) {
    try { await sendWebhookNotification(row.webhookUrl, title, content); }
    catch (e) { logger.warn('数据预警 Webhook 失败', { id: row.id, err: e instanceof Error ? e.message : String(e) }); }
  }
}

/**
 * 静默窗口判定（纯函数）：
 * - 新触发（上次未触发）→ 立即通知；
 * - 持续触发时，silenceMins=0 或距上次通知已超静默期 → 再次通知，否则静默。
 */
export function shouldNotifyTrigger(wasTriggered: boolean, silenceMins: number, lastNotifiedAt: Date | null, now: Date): boolean {
  if (!wasTriggered) return true;
  const silenceMs = Math.max(0, silenceMins) * 60_000;
  if (silenceMs === 0 || !lastNotifiedAt) return true;
  return now.getTime() - lastNotifiedAt.getTime() >= silenceMs;
}

/**
 * 评估单条规则：取数→（分组）聚合→比较。返回 { value, triggered, hits? }
 * 通知策略：
 * - 新触发（上次未触发→本次触发）立即通知；
 * - 持续触发时，距上次通知不足 silenceMins 分钟不重复通知（0=每次触发都通知）；
 * - 触发→恢复且开启 notifyOnRecover 时发送恢复通知。
 */
export async function evaluateAlert(row: ReportAlertRuleRow): Promise<ReportAlertEvalResult> {
  const data = await getDatasetData(row.datasetId, undefined, 5000);
  const agg = row.aggregate as ReportAlertAggregate;
  const op = row.op as ReportAlertOp;
  const threshold = row.threshold ?? 0;
  let value: number;
  let triggered: boolean;
  let hits: ReportAlertEvalHit[] = [];
  if (row.groupByField) {
    ({ value, triggered, hits } = evaluateGroups(data.rows, row.groupByField, row.field, agg, op, threshold));
  } else {
    value = aggregate(data.rows, row.field, agg);
    triggered = compare(value, op, threshold);
  }
  const now = new Date();
  const wasTriggered = row.lastTriggered === true;
  const opLabel = OP_LABEL[op] ?? row.op;
  const scope = row.groupByField ? `按「${row.groupByField}」分组，` : '';
  const condition = `${scope}${row.aggregate}(${row.field ?? '行数'}) ${opLabel} ${threshold}`;
  const topHits = hits.slice(0, 10);
  let lastNotifiedAt = row.lastNotifiedAt ?? null;

  if (triggered) {
    if (shouldNotifyTrigger(wasTriggered, row.silenceMins ?? 0, lastNotifiedAt, now)) {
      const hitDetail = row.groupByField
        ? `\n命中 ${hits.length} 组：\n${topHits.map((h) => `  - ${h.group}：${h.value}`).join('\n')}${hits.length > topHits.length ? '\n  …' : ''}`
        : '';
      const content = `预警规则「${row.name}」已触发。\n实际值：${value}\n条件：${condition}${hitDetail}\n触发时间：${formatDateTime(now)}`;
      await notifyAlert(row, `数据预警 · ${row.name}`, content, 'warning');
      lastNotifiedAt = now;
    }
  } else if (wasTriggered && row.notifyOnRecover) {
    const content = `预警规则「${row.name}」已恢复正常。\n当前值：${value}\n条件：${condition}\n恢复时间：${formatDateTime(now)}`;
    await notifyAlert(row, `预警恢复 · ${row.name}`, content, 'info');
    lastNotifiedAt = now;
  }

  await db.update(reportAlertRules)
    .set({ lastCheckedAt: now, lastTriggered: triggered, lastValue: value, lastNotifiedAt })
    .where(eq(reportAlertRules.id, row.id));
  return { value, triggered, ...(row.groupByField ? { hits: topHits } : {}) };
}

/** 手动评估 */
export async function evaluateAlertById(id: number): Promise<ReportAlertEvalResult> {
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
