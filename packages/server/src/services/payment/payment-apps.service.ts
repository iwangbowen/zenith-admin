/** 支付应用：开放平台客户端的一对一支付路由画像。 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
import { oauth2Clients, paymentApps, paymentChannelConfigs, type PaymentAppRow } from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { requireTenantScopeId, tenantCondition, exactTenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreatePaymentAppInput, UpdatePaymentAppInput, PaymentApp, PaymentChannel } from '@zenith/shared/payment';

type AppWithConfigs = PaymentAppRow & {
  openClient?: { clientId: string; name: string; environment: 'production' | 'sandbox' } | null;
  wechatConfig?: { name: string } | null;
  alipayConfig?: { name: string } | null;
  unionpayConfig?: { name: string } | null;
};

const APP_RELATIONS = {
  openClient: { columns: { clientId: true, name: true, environment: true } },
  wechatConfig: { columns: { name: true } },
  alipayConfig: { columns: { name: true } },
  unionpayConfig: { columns: { name: true } },
} as const;

export function mapApp(row: AppWithConfigs): PaymentApp {
  return {
    id: row.id,
    name: row.name,
    openClientId: row.openClientId,
    openClientKey: row.openClient?.clientId ?? '',
    openClientName: row.openClient?.name ?? '',
    environment: row.openClient?.environment ?? 'sandbox',
    status: row.status,
    wechatConfigId: row.wechatConfigId ?? null,
    wechatConfigName: row.wechatConfig?.name ?? null,
    alipayConfigId: row.alipayConfigId ?? null,
    alipayConfigName: row.alipayConfig?.name ?? null,
    unionpayConfigId: row.unionpayConfigId ?? null,
    unionpayConfigName: row.unionpayConfig?.name ?? null,
    remark: row.remark ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface ListAppsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'enabled' | 'disabled';
}

export async function listApps(q: ListAppsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conditions = [];
  conditions.push(keywordCondition(q.keyword, [paymentApps.name]));
  if (q.status) conditions.push(eq(paymentApps.status, q.status));
  const where = buildWhere(
    buildWhere(...conditions),
    tenantCondition(paymentApps, currentUser()),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentApps, where),
    rows: () => db.query.paymentApps.findMany({
      where,
      orderBy: desc(paymentApps.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
      with: APP_RELATIONS,
    }),
    map: mapApp,
  });
}

async function ensureApp(id: number): Promise<PaymentAppRow> {
  const [row] = await db
    .select()
    .from(paymentApps)
    .where(and(eq(paymentApps.id, id), tenantCondition(paymentApps, currentUser())))
    .limit(1);
  requireRow(row, '支付应用不存在');
  return row;
}

export async function getApp(id: number): Promise<PaymentApp> {
  await ensureApp(id);
  const row = requireRow(await db.query.paymentApps.findFirst({ where: eq(paymentApps.id, id), with: APP_RELATIONS }), '支付应用不存在');
  return mapApp(row);
}

async function ensureOpenClient(id: number) {
  const user = currentUser();
  const [row] = await db
    .select()
    .from(oauth2Clients)
    .where(and(eq(oauth2Clients.id, id), tenantCondition(oauth2Clients, user)))
    .limit(1);
  if (!row) throw new HTTPException(400, { message: '开放平台应用不存在或不属于当前租户' });
  if (row.status !== 'enabled') throw new HTTPException(400, { message: '开放平台应用已停用' });
  if (row.isPublic || !row.signEnabled) {
    throw new HTTPException(400, { message: '支付应用必须绑定已开启 HMAC 签名的机密开放应用' });
  }
  return row;
}

async function assertConfigChannel(
  configId: number | null | undefined,
  channel: PaymentChannel,
  tenantId: number | null,
  environment: 'production' | 'sandbox',
): Promise<void> {
  if (configId == null) return;
  const tenantScope = exactTenantCondition(paymentChannelConfigs.tenantId, tenantId);
  const [row] = await db
    .select({ channel: paymentChannelConfigs.channel, sandbox: paymentChannelConfigs.sandbox })
    .from(paymentChannelConfigs)
    .where(and(
      eq(paymentChannelConfigs.id, configId),
      eq(paymentChannelConfigs.status, 'enabled'),
      tenantScope,
    ))
    .limit(1);
  if (!row) throw new HTTPException(400, { message: '渠道配置不存在' });
  if (row.channel !== channel) throw new HTTPException(400, { message: `配置 ${configId} 不是${channel}渠道，无法绑定` });
  if (row.sandbox !== (environment === 'sandbox')) {
    throw new HTTPException(400, { message: `开放应用环境 ${environment} 与渠道配置环境不一致` });
  }
}

export async function createApp(input: CreatePaymentAppInput): Promise<PaymentApp> {
  const user = currentUser();
  const tenantId = requireTenantScopeId(user);
  const openClient = await ensureOpenClient(input.openClientId);
  if ((openClient.tenantId ?? null) !== tenantId) {
    throw new HTTPException(400, { message: '开放平台应用与支付应用必须属于同一租户' });
  }
  await assertConfigChannel(input.wechatConfigId, 'wechat', tenantId, openClient.environment);
  await assertConfigChannel(input.alipayConfigId, 'alipay', tenantId, openClient.environment);
  await assertConfigChannel(input.unionpayConfigId, 'unionpay', tenantId, openClient.environment);
  try {
    const [row] = await db.insert(paymentApps).values({
      name: input.name,
      openClientId: input.openClientId,
      status: input.status ?? 'enabled',
      wechatConfigId: input.wechatConfigId ?? null,
      alipayConfigId: input.alipayConfigId ?? null,
      unionpayConfigId: input.unionpayConfigId ?? null,
      remark: input.remark ?? null,
      tenantId,
    }).returning();
    return getApp(row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, '该开放平台应用已绑定支付应用');
  }
}

export async function updateApp(id: number, input: UpdatePaymentAppInput): Promise<PaymentApp> {
  requireTenantScopeId(currentUser());
  const existing = await ensureApp(id);
  const openClient = await ensureOpenClient(existing.openClientId);
  const tenantId = existing.tenantId ?? null;
  if ((openClient.tenantId ?? null) !== tenantId) {
    throw new HTTPException(409, { message: '开放平台应用与支付应用租户已不一致，请重新绑定同租户应用' });
  }
  if (input.wechatConfigId !== undefined) await assertConfigChannel(input.wechatConfigId, 'wechat', tenantId, openClient.environment);
  if (input.alipayConfigId !== undefined) await assertConfigChannel(input.alipayConfigId, 'alipay', tenantId, openClient.environment);
  if (input.unionpayConfigId !== undefined) await assertConfigChannel(input.unionpayConfigId, 'unionpay', tenantId, openClient.environment);
  const set: Partial<PaymentAppRow> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.status !== undefined) set.status = input.status;
  if (input.wechatConfigId !== undefined) set.wechatConfigId = input.wechatConfigId ?? null;
  if (input.alipayConfigId !== undefined) set.alipayConfigId = input.alipayConfigId ?? null;
  if (input.unionpayConfigId !== undefined) set.unionpayConfigId = input.unionpayConfigId ?? null;
  if (input.remark !== undefined) set.remark = input.remark ?? null;
  const [row] = await db.update(paymentApps).set(set)
    .where(and(eq(paymentApps.id, id), tenantCondition(paymentApps, currentUser())))
    .returning({ id: paymentApps.id });
  requireRow(row, '支付应用不存在');
  return getApp(row.id);
}

export async function deleteApp(id: number): Promise<void> {
  requireTenantScopeId(currentUser());
  await ensureApp(id);
  await db.delete(paymentApps).where(and(eq(paymentApps.id, id), tenantCondition(paymentApps, currentUser())));
}

/** 由可信内部 applicationId 解析支付路由；外部调用不得直接传该 ID。 */
export async function resolveApplicationChannelConfig(
  applicationId: number,
  channel: PaymentChannel,
  expectedTenantId: number | null,
): Promise<{ appId: number; channelConfigId: number; tenantId: number | null }> {
  const appTenant = expectedTenantId === null
    ? isNull(paymentApps.tenantId)
    : eq(paymentApps.tenantId, expectedTenantId);
  const app = await db.query.paymentApps.findFirst({
    where: and(eq(paymentApps.id, applicationId), appTenant),
    with: { openClient: true },
  });
  if (!app) throw new HTTPException(400, { message: '支付应用不存在或不属于当前租户' });
  if (app.status !== 'enabled') throw new HTTPException(400, { message: `支付应用已停用：${app.name}` });
  if (!app.openClient || app.openClient.status !== 'enabled' || app.openClient.isPublic || !app.openClient.signEnabled) {
    throw new HTTPException(400, { message: '支付应用绑定的开放平台应用不可用' });
  }
  if ((app.openClient.tenantId ?? null) !== (app.tenantId ?? null)) {
    throw new HTTPException(409, { message: '开放平台应用与支付应用租户不一致，请重新绑定同租户应用' });
  }
  const configId = channel === 'wechat'
    ? app.wechatConfigId
    : channel === 'alipay'
      ? app.alipayConfigId
      : app.unionpayConfigId;
  if (!configId) throw new HTTPException(400, { message: `应用「${app.name}」未绑定${channel}渠道配置` });
  const configTenant = exactTenantCondition(paymentChannelConfigs.tenantId, app.tenantId);
  const [boundConfig] = await db.select({ id: paymentChannelConfigs.id, sandbox: paymentChannelConfigs.sandbox })
    .from(paymentChannelConfigs)
    .where(and(
      eq(paymentChannelConfigs.id, configId),
      eq(paymentChannelConfigs.channel, channel),
      eq(paymentChannelConfigs.status, 'enabled'),
      configTenant,
    ))
    .limit(1);
  if (!boundConfig) throw new HTTPException(400, { message: `应用「${app.name}」绑定的渠道配置无效或不属于同一租户` });
  if (boundConfig.sandbox !== (app.openClient.environment === 'sandbox')) {
    throw new HTTPException(400, { message: '支付应用与渠道配置环境不一致' });
  }
  return { appId: app.id, channelConfigId: configId, tenantId: app.tenantId ?? null };
}

/** 内部业务未显式指定应用时，仅在当前租户/渠道存在唯一候选时自动解析。 */
export async function resolveSoleApplicationChannelConfig(
  channel: PaymentChannel,
  tenantId: number | null,
): Promise<{ appId: number; channelConfigId: number; tenantId: number | null }> {
  const tenantScope = exactTenantCondition(paymentApps.tenantId, tenantId);
  const rows = await db
    .select({
      id: paymentApps.id,
      configId: channel === 'wechat'
        ? paymentApps.wechatConfigId
        : channel === 'alipay'
          ? paymentApps.alipayConfigId
          : paymentApps.unionpayConfigId,
    })
    .from(paymentApps)
    .where(and(eq(paymentApps.status, 'enabled'), tenantScope));
  const candidates = rows.filter((row): row is { id: number; configId: number } => row.configId != null);
  if (candidates.length === 0) throw new HTTPException(400, { message: `当前租户未配置可用的 ${channel} 支付应用` });
  if (candidates.length > 1) throw new HTTPException(400, { message: `当前租户存在多个 ${channel} 支付应用，请明确指定 applicationId` });
  return resolveApplicationChannelConfig(candidates[0].id, channel, tenantId);
}

export async function resolvePaymentApplicationByOpenClient(openClientId: number, tenantId: number | null) {
  const tenantScope = exactTenantCondition(paymentApps.tenantId, tenantId);
  const app = await db.query.paymentApps.findFirst({
    where: and(eq(paymentApps.openClientId, openClientId), eq(paymentApps.status, 'enabled'), tenantScope),
    with: { openClient: true },
  });
  if (!app || !app.openClient || app.openClient.status !== 'enabled') {
    throw new HTTPException(403, { message: '当前开放应用未绑定可用支付应用' });
  }
  if ((app.openClient.tenantId ?? null) !== tenantId) {
    throw new HTTPException(403, { message: '开放应用与支付应用租户不一致' });
  }
  return app;
}
