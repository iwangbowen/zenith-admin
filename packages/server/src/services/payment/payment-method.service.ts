/**
 * 支付方式管理 Service。
 * 维护租户级可用支付方式（启停/排序/名称/图标），下单时 fail-closed 校验。
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { paymentMethodConfigs, type PaymentMethodConfigRow } from '../../db/schema';
import { config } from '../../config';
import { formatDateTime } from '../../lib/datetime';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { getTenantScopeId, exactTenantCondition } from '../../lib/tenant';
import type { UpdatePaymentMethodConfigInput } from '@zenith/shared/payment';
import type { PaymentMethod, PaymentMethodConfig } from '@zenith/shared/payment';

export function mapMethodConfig(row: PaymentMethodConfigRow): PaymentMethodConfig {
  return {
    id: row.id,
    method: row.method,
    channel: row.channel,
    label: row.label,
    icon: row.icon ?? null,
    enabled: row.enabled,
    sort: row.sort,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/**
 * Payment methods are an effective configuration, not a cross-tenant catalog.
 * A platform administrator in the unscoped platform view sees the global
 * defaults; once a tenant view is selected only that tenant's overrides are
 * returned. This keeps one row per method and prevents an ambiguous edit.
 */
function methodConfigTenantCondition() {
  // Even when multi-tenant mode is disabled, a database may contain tenant
  // overrides created while it was enabled. The single-tenant runtime must
  // use the global defaults only instead of rendering every historical row.
  if (!config.multiTenantMode) return isNull(paymentMethodConfigs.tenantId);
  const user = currentUser();
  const scope = getTenantScopeId(user);
  if (scope === undefined) {
    return isNull(paymentMethodConfigs.tenantId);
  }
  return exactTenantCondition(paymentMethodConfigs.tenantId, scope);
}

export async function listMethodConfigs(): Promise<PaymentMethodConfig[]> {
  const rows = await db
    .select()
    .from(paymentMethodConfigs)
    .where(methodConfigTenantCondition())
    .orderBy(asc(paymentMethodConfigs.sort), asc(paymentMethodConfigs.id));
  return rows.map(mapMethodConfig);
}

export async function listEnabledMethodConfigs(): Promise<PaymentMethodConfig[]> {
  const rows = await db
    .select()
    .from(paymentMethodConfigs)
    .where(and(eq(paymentMethodConfigs.enabled, true), methodConfigTenantCondition()))
    .orderBy(asc(paymentMethodConfigs.sort), asc(paymentMethodConfigs.id));
  return rows.map(mapMethodConfig);
}

async function ensureMethodConfig(id: number): Promise<PaymentMethodConfigRow> {
  const [row] = await db
    .select()
    .from(paymentMethodConfigs)
    .where(and(eq(paymentMethodConfigs.id, id), methodConfigTenantCondition()))
    .limit(1);
  requireRow(row, '支付方式配置不存在');
  return row;
}

export async function getMethodConfig(id: number): Promise<PaymentMethodConfig> {
  return mapMethodConfig(await ensureMethodConfig(id));
}

export async function updateMethodConfig(id: number, input: UpdatePaymentMethodConfigInput): Promise<PaymentMethodConfig> {
  await ensureMethodConfig(id);
  const set: Partial<PaymentMethodConfigRow> = {};
  if (input.label !== undefined) set.label = input.label;
  if (input.icon !== undefined) set.icon = input.icon || null;
  if (input.enabled !== undefined) set.enabled = input.enabled;
  if (input.sort !== undefined) set.sort = input.sort;
  const [row] = await db
    .update(paymentMethodConfigs)
    .set(set)
    .where(and(eq(paymentMethodConfigs.id, id), methodConfigTenantCondition()))
    .returning();
  return mapMethodConfig(row);
}

/** 下单校验：配置缺失或停用均拒绝。 */
export async function assertMethodEnabled(method: PaymentMethod, tenantId: number | null): Promise<void> {
  const exactTenant = exactTenantCondition(paymentMethodConfigs.tenantId, tenantId);
  const [maybeRow] = await db
    .select({ enabled: paymentMethodConfigs.enabled, label: paymentMethodConfigs.label })
    .from(paymentMethodConfigs)
    .where(and(eq(paymentMethodConfigs.method, method), exactTenant))
    .limit(1);
  const row = requireRow(maybeRow, `支付方式 ${method} 未配置`, 400);
  if (!row.enabled) {
    throw new HTTPException(400, { message: `支付方式「${row.label}」已停用` });
  }
}
