import { paymentChannelContract } from '@zenith/shared/payment';
import type { QueryOutputOf } from '@zenith/shared/core';
/**
 * 支付渠道配置 Service。
 * 密钥字段（APIv3 Key / 商户私钥 / 支付宝应用私钥）以 encryptField 加密存储，
 * 响应中绝不返回明文，仅以 hasXxx 布尔位标识是否已配置。
 */
import { and, asc, desc, eq, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { randomBytes } from 'node:crypto';
import { db } from '../../db';
import { buildListResult } from '../../lib/list-query';
import { paymentApps, paymentChannelConfigs, paymentContracts, paymentJournals, paymentLedgerAccounts, paymentOrders, paymentPreauths, paymentReconBatches, paymentSettlementBatches, paymentTransfers, type NewPaymentChannelConfig, type PaymentChannelConfigRow } from '../../db/schema';
import { requireRow } from '../../lib/db-assert';
import { currentUser } from '../../lib/context';
import { tenantCondition, requireTenantScopeId } from '../../lib/tenant';
import { buildWhere, withPagination, keywordCondition } from '../../lib/where-helpers';
import { encryptField } from '../../lib/encryption';
import { formatTimestamps } from '../../lib/datetime';
import { clearDefaultFlag } from '../../lib/default-flag';
import type { CreatePaymentChannelConfigInput, PaymentChannel, PaymentChannelConfig, PaymentChannelConfigLookup, UpdatePaymentChannelConfigInput } from '@zenith/shared/payment';

/** 默认标记的归属范围：同租户同渠道内互斥（不筛 is_default，范围内所有配置都会被刷新） */
function channelDefaultScope(channel: PaymentChannel, user: ReturnType<typeof currentUser>) {
  return and(eq(paymentChannelConfigs.channel, channel), tenantCondition(paymentChannelConfigs, user));
}

export function mapChannelConfig(row: PaymentChannelConfigRow): PaymentChannelConfig {
  return {
    id: row.id,
    name: row.name,
    channel: row.channel,
    status: row.status,
    isDefault: row.isDefault,
    sandbox: row.sandbox,
    notifyUrl: row.notifyUrl ?? null,
    wechatAppId: row.wechatAppId ?? null,
    wechatMchId: row.wechatMchId ?? null,
    wechatSerialNo: row.wechatSerialNo ?? null,
    wechatPlatformCert: row.wechatPlatformCert ?? null,
    hasWechatApiV3Key: Boolean(row.wechatApiV3KeyEncrypted),
    hasWechatPrivateKey: Boolean(row.wechatPrivateKeyEncrypted),
    alipayAppId: row.alipayAppId ?? null,
    alipaySellerId: row.alipaySellerId ?? null,
    alipayPublicKey: row.alipayPublicKey ?? null,
    alipaySignType: row.alipaySignType ?? null,
    alipayGateway: row.alipayGateway ?? null,
    hasAlipayPrivateKey: Boolean(row.alipayPrivateKeyEncrypted),
    unionpayMerId: row.unionpayMerId ?? null,
    unionpayCertId: row.unionpayCertId ?? null,
    unionpayPublicKey: row.unionpayPublicKey ?? null,
    unionpayGateway: row.unionpayGateway ?? null,
    hasUnionpayPrivateKey: Boolean(row.unionpayPrivateKeyEncrypted),
    remark: row.remark ?? null,
    ...formatTimestamps(row),
  };
}

export async function listAllChannelConfigs() {
  const tc = tenantCondition(paymentChannelConfigs, currentUser());
  const rows = await db.select().from(paymentChannelConfigs).where(tc).orderBy(asc(paymentChannelConfigs.id));
  return rows.map(mapChannelConfig);
}

/** 对账/结算等资金运营页面的最小下拉源，仅返回当前租户启用的商户配置。 */
export async function listChannelConfigLookup(): Promise<PaymentChannelConfigLookup[]> {
  const rows = await db
    .select({
      id: paymentChannelConfigs.id,
      name: paymentChannelConfigs.name,
      channel: paymentChannelConfigs.channel,
      sandbox: paymentChannelConfigs.sandbox,
    })
    .from(paymentChannelConfigs)
    .where(and(
      eq(paymentChannelConfigs.status, 'enabled'),
      tenantCondition(paymentChannelConfigs, currentUser()),
    ))
    .orderBy(asc(paymentChannelConfigs.channel), asc(paymentChannelConfigs.name));
  return rows;
}

export async function listChannelConfigs(q: QueryOutputOf<typeof paymentChannelContract.channels>) {
  const { page, pageSize } = q;
  const finalWhere = buildWhere(
    keywordCondition(q.keyword, [paymentChannelConfigs.name]),
    q.channel ? eq(paymentChannelConfigs.channel, q.channel) : undefined,
    q.status ? eq(paymentChannelConfigs.status, q.status) : undefined,
    tenantCondition(paymentChannelConfigs, currentUser()),
  );
  return buildListResult({
    page,
    pageSize,
    count: () => db.$count(paymentChannelConfigs, finalWhere),
    rows: () => withPagination(
      db.select().from(paymentChannelConfigs).where(finalWhere).orderBy(desc(paymentChannelConfigs.id)).$dynamic(),
      page,
      pageSize,
    ),
    map: mapChannelConfig,
  });
}

export async function ensureChannelConfigExists(id: number): Promise<PaymentChannelConfigRow> {
  const tc = tenantCondition(paymentChannelConfigs, currentUser());
  const [row] = await db.select().from(paymentChannelConfigs).where(and(eq(paymentChannelConfigs.id, id), tc)).limit(1);
  requireRow(row, '支付渠道配置不存在');
  return row;
}

export async function getChannelConfig(id: number): Promise<PaymentChannelConfig> {
  return mapChannelConfig(await ensureChannelConfigExists(id));
}

export async function createChannelConfig(input: CreatePaymentChannelConfigInput): Promise<PaymentChannelConfig> {
  const user = currentUser();
  const tenantId = requireTenantScopeId(user);
  const values: NewPaymentChannelConfig = {
    name: input.name,
    channel: input.channel,
    status: input.status ?? 'enabled',
    isDefault: input.isDefault ?? false,
    sandbox: input.sandbox ?? false,
    callbackToken: randomBytes(24).toString('base64url'),
    sandboxNotifySecretEncrypted: encryptField(randomBytes(32).toString('base64url'))!,
    notifyUrl: input.notifyUrl ?? null,
    wechatAppId: input.wechatAppId ?? null,
    wechatMchId: input.wechatMchId ?? null,
    wechatApiV3KeyEncrypted: input.wechatApiV3Key ? encryptField(input.wechatApiV3Key) : null,
    wechatPrivateKeyEncrypted: input.wechatPrivateKey ? encryptField(input.wechatPrivateKey) : null,
    wechatSerialNo: input.wechatSerialNo ?? null,
    wechatPlatformCert: input.wechatPlatformCert ?? null,
    alipayAppId: input.alipayAppId ?? null,
    alipaySellerId: input.alipaySellerId ?? null,
    alipayPrivateKeyEncrypted: input.alipayPrivateKey ? encryptField(input.alipayPrivateKey) : null,
    alipayPublicKey: input.alipayPublicKey ?? null,
    alipaySignType: input.alipaySignType ?? 'RSA2',
    alipayGateway: input.alipayGateway ?? null,
    unionpayMerId: input.unionpayMerId ?? null,
    unionpayPrivateKeyEncrypted: input.unionpayPrivateKey ? encryptField(input.unionpayPrivateKey) : null,
    unionpayCertId: input.unionpayCertId ?? null,
    unionpayPublicKey: input.unionpayPublicKey ?? null,
    unionpayGateway: input.unionpayGateway ?? null,
    remark: input.remark ?? null,
    tenantId,
  };
  return db.transaction(async (tx) => {
    if (values.isDefault) await clearDefaultFlag(tx, paymentChannelConfigs, channelDefaultScope(input.channel, user));
    const [row] = await tx.insert(paymentChannelConfigs).values(values).returning();
    return mapChannelConfig(row);
  });
}

async function countChannelConfigReferences(id: number): Promise<number> {
  const counts = await Promise.all([
    db.$count(paymentOrders, eq(paymentOrders.channelConfigId, id)),
    db.$count(paymentContracts, eq(paymentContracts.channelConfigId, id)),
    db.$count(paymentPreauths, eq(paymentPreauths.channelConfigId, id)),
    db.$count(paymentTransfers, eq(paymentTransfers.channelConfigId, id)),
    db.$count(paymentJournals, eq(paymentJournals.channelConfigId, id)),
    db.$count(paymentLedgerAccounts, eq(paymentLedgerAccounts.channelConfigId, id)),
    db.$count(paymentReconBatches, eq(paymentReconBatches.channelConfigId, id)),
    db.$count(paymentSettlementBatches, eq(paymentSettlementBatches.channelConfigId, id)),
  ]);
  return counts.reduce((total, count) => total + count, 0);
}

export async function updateChannelConfig(id: number, input: UpdatePaymentChannelConfigInput): Promise<PaymentChannelConfig> {
  const user = currentUser();
  requireTenantScopeId(user);
  const existing = await ensureChannelConfigExists(id);
  const referenceCount = await countChannelConfigReferences(id);
  const immutableIdentityChanged = referenceCount > 0 && (
    (input.channel !== undefined && input.channel !== existing.channel)
    || (input.sandbox !== undefined && input.sandbox !== existing.sandbox)
    || (input.wechatAppId !== undefined && input.wechatAppId !== existing.wechatAppId)
    || (input.wechatMchId !== undefined && input.wechatMchId !== existing.wechatMchId)
    || input.wechatApiV3Key !== undefined
    || input.wechatPrivateKey !== undefined
    || (input.wechatSerialNo !== undefined && input.wechatSerialNo !== existing.wechatSerialNo)
    || (input.wechatPlatformCert !== undefined && input.wechatPlatformCert !== existing.wechatPlatformCert)
    || (input.alipayAppId !== undefined && input.alipayAppId !== existing.alipayAppId)
    || (input.alipaySellerId !== undefined && input.alipaySellerId !== existing.alipaySellerId)
    || input.alipayPrivateKey !== undefined
    || (input.alipayPublicKey !== undefined && input.alipayPublicKey !== existing.alipayPublicKey)
    || (input.alipaySignType !== undefined && input.alipaySignType !== existing.alipaySignType)
    || (input.alipayGateway !== undefined && input.alipayGateway !== existing.alipayGateway)
    || (input.unionpayMerId !== undefined && input.unionpayMerId !== existing.unionpayMerId)
    || input.unionpayPrivateKey !== undefined
    || (input.unionpayCertId !== undefined && input.unionpayCertId !== existing.unionpayCertId)
    || (input.unionpayPublicKey !== undefined && input.unionpayPublicKey !== existing.unionpayPublicKey)
    || (input.unionpayGateway !== undefined && input.unionpayGateway !== existing.unionpayGateway)
  );
  if (immutableIdentityChanged) {
    throw new HTTPException(400, {
      message: `该商户配置已被 ${referenceCount} 条交易或账务记录引用，身份或凭证不可原地修改；请新建配置并切换应用路由`,
    });
  }
  const set: Partial<NewPaymentChannelConfig> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.channel !== undefined) set.channel = input.channel;
  if (input.status !== undefined) set.status = input.status;
  if (input.isDefault !== undefined) set.isDefault = input.isDefault;
  if (input.sandbox !== undefined) set.sandbox = input.sandbox;
  if (input.notifyUrl !== undefined) set.notifyUrl = input.notifyUrl;
  if (input.wechatAppId !== undefined) set.wechatAppId = input.wechatAppId;
  if (input.wechatMchId !== undefined) set.wechatMchId = input.wechatMchId;
  if (input.wechatSerialNo !== undefined) set.wechatSerialNo = input.wechatSerialNo;
  if (input.wechatPlatformCert !== undefined) set.wechatPlatformCert = input.wechatPlatformCert;
  if (input.alipayAppId !== undefined) set.alipayAppId = input.alipayAppId;
  if (input.alipaySellerId !== undefined) set.alipaySellerId = input.alipaySellerId;
  if (input.alipayPublicKey !== undefined) set.alipayPublicKey = input.alipayPublicKey;
  if (input.alipaySignType !== undefined) set.alipaySignType = input.alipaySignType;
  if (input.alipayGateway !== undefined) set.alipayGateway = input.alipayGateway;
  if (input.unionpayMerId !== undefined) set.unionpayMerId = input.unionpayMerId;
  if (input.unionpayCertId !== undefined) set.unionpayCertId = input.unionpayCertId;
  if (input.unionpayPublicKey !== undefined) set.unionpayPublicKey = input.unionpayPublicKey;
  if (input.unionpayGateway !== undefined) set.unionpayGateway = input.unionpayGateway;
  if (input.remark !== undefined) set.remark = input.remark;
  if (input.wechatApiV3Key) set.wechatApiV3KeyEncrypted = encryptField(input.wechatApiV3Key);
  if (input.wechatPrivateKey) set.wechatPrivateKeyEncrypted = encryptField(input.wechatPrivateKey);
  if (input.alipayPrivateKey) set.alipayPrivateKeyEncrypted = encryptField(input.alipayPrivateKey);
  if (input.unionpayPrivateKey) set.unionpayPrivateKeyEncrypted = encryptField(input.unionpayPrivateKey);

  if (Object.keys(set).length === 0) return mapChannelConfig(existing);

  const targetChannel = input.channel ?? existing.channel;
  return db.transaction(async (tx) => {
    if (set.isDefault) await clearDefaultFlag(tx, paymentChannelConfigs, channelDefaultScope(targetChannel, user));
    const [row] = await tx
      .update(paymentChannelConfigs)
      .set(set)
      .where(and(eq(paymentChannelConfigs.id, id), tenantCondition(paymentChannelConfigs, user)))
      .returning();
    requireRow(row, '支付渠道配置不存在');
    return mapChannelConfig(row);
  });
}

export async function deleteChannelConfig(id: number): Promise<void> {
  requireTenantScopeId(currentUser());
  const existing = await ensureChannelConfigExists(id);
  // 三道闸：渠道配置被删除后，关联订单将无法退款/查单（密钥随配置一起消失），
  // 一律引导「停用」而非删除；仅无任何引用的配置可物理删除。
  if (existing.isDefault) {
    throw new HTTPException(400, { message: '该配置是当前渠道的默认配置，请先将其他配置设为默认后再删除' });
  }
  const [referenceCount, [boundApp]] = await Promise.all([
    countChannelConfigReferences(id),
    db
      .select({ id: paymentApps.id, name: paymentApps.name })
      .from(paymentApps)
      .where(or(eq(paymentApps.wechatConfigId, id), eq(paymentApps.alipayConfigId, id), eq(paymentApps.unionpayConfigId, id)))
      .limit(1),
  ]);
  if (referenceCount > 0) {
    throw new HTTPException(400, { message: `该配置已被 ${referenceCount} 条交易或账务记录引用，删除后将无法恢复或审计，请改用停用` });
  }
  if (boundApp) {
    throw new HTTPException(400, { message: `该配置已被支付应用「${boundApp.name}」绑定，请先解除绑定后再删除` });
  }
  await db.delete(paymentChannelConfigs).where(eq(paymentChannelConfigs.id, id));
}

/** 将指定渠道配置设为该渠道的默认（同租户同渠道内互斥），并自动启用 */
export async function setChannelAsDefault(id: number): Promise<PaymentChannelConfig> {
  const user = currentUser();
  requireTenantScopeId(user);
  const existing = await ensureChannelConfigExists(id);
  return db.transaction(async (tx) => {
    await clearDefaultFlag(tx, paymentChannelConfigs, channelDefaultScope(existing.channel, user));
    const [row] = await tx
      .update(paymentChannelConfigs)
      .set({ isDefault: true, status: 'enabled' })
      .where(and(eq(paymentChannelConfigs.id, id), tenantCondition(paymentChannelConfigs, user)))
      .returning();
    requireRow(row, '支付渠道配置不存在');
    return mapChannelConfig(row);
  });
}
