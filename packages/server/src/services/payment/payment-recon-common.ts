import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { paymentChannelAccounts, paymentStatementPeriods, paymentStatements, paymentReconCases, users } from '../../db/schema';
import { currentUser, currentUserOrNull } from '../../lib/context';
import { exactTenantCondition, requireTenantScopeId, tenantCondition } from '../../lib/tenant';
import { requireRow } from '../../lib/db-assert';
import { getSettings } from '../../lib/settings';
import type { DbExecutor } from '../../db/types';
import { notifyWithin } from '../messaging/notification-outbox.service';

export const RECON_DOWNLOAD_TASK = 'payment-statement-download';
export const RECON_IMPORT_TASK = 'payment-statement-import';
export const RECON_COMPARE_TASK = 'payment-reconcile';
export const RECON_COMPENSATE_TASK = 'payment-recon-compensate';
export async function requireReconAccount(id: number) {
  const [row] = await db.select().from(paymentChannelAccounts).where(and(eq(paymentChannelAccounts.id, id), tenantCondition(paymentChannelAccounts, currentUser()))).limit(1);
  return requireRow(row, '渠道账户不存在');
}
export async function requireStatementPeriod(id: number) {
  const [row] = await db.select().from(paymentStatementPeriods).where(and(eq(paymentStatementPeriods.id, id), tenantCondition(paymentStatementPeriods, currentUser()))).limit(1);
  return requireRow(row, '账期不存在');
}
export async function requireStatement(id: number) {
  const [row] = await db.select().from(paymentStatements).where(and(eq(paymentStatements.id, id), tenantCondition(paymentStatements, currentUser()))).limit(1);
  return requireRow(row, '账单不存在');
}
export async function requireReconCase(id: number) {
  const [row] = await db.select().from(paymentReconCases).where(and(eq(paymentReconCases.id, id), tenantCondition(paymentReconCases, currentUser()))).limit(1);
  return requireRow(row, '差异案件不存在');
}
export function assertReconWriteScope(tenantId: number | null) {
  if (requireTenantScopeId(currentUser()) !== tenantId) throw new HTTPException(403, { message: '请切换到资金记录所属租户操作' });
}
export function reconJson(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === 'bigint' ? item.toString() : item)) as Record<string, unknown>;
}
/** Resolve recipients before transactions, never query the global pool from inside tx. */
export async function reconNotificationPolicy(tenantId: number | null, ownerId?: number | null) {
  const settings = await getSettings('payment', { tenantId });
  const ids = new Set(settings.reconAlertUserIds);
  if (!ids.size) {
    const actor = ownerId ?? currentUserOrNull()?.userId;
    if (actor) ids.add(actor);
  }
  const candidates = await db.select({ id: users.id }).from(users).where(and(eq(users.status, 'enabled'), exactTenantCondition(users.tenantId, tenantId)));
  return { settings, recipients: candidates.filter((u) => ids.has(u.id)).map((u) => ({ type: 'user' as const, id: u.id })) };
}
export async function notifyReconFailure(tx: DbExecutor, input: {
  tenantId: number | null; periodId: number; generation: number; accountName: string; billDate: string; message: string;
  recipients: Awaited<ReturnType<typeof reconNotificationPolicy>>['recipients'];
}) {
  await notifyWithin(tx, 'payment.recon.failed', { tenantId: input.tenantId, recipients: input.recipients,
    vars: { accountName: input.accountName, billDate: input.billDate, message: input.message },
    dedupeKey: `payment-recon-failed:${input.periodId}:${input.generation}`, link: `/payment/recon?periodId=${input.periodId}` });
}
