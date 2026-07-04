/**
 * 支付渠道配置 Service。
 * 密钥字段（APIv3 Key / 商户私钥 / 支付宝应用私钥）以 encryptField 加密存储，
 * 响应中绝不返回明文，仅以 hasXxx 布尔位标识是否已配置。
 */
import { and, asc, desc, eq, like } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { paymentChannelConfigs, type NewPaymentChannelConfig, type PaymentChannelConfigRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition, getCreateTenantId } from '../../lib/tenant';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { encryptField } from '../../lib/encryption';
import { formatDateTime } from '../../lib/datetime';
import type {
  CreatePaymentChannelConfigInput,
  PaymentChannel,
  PaymentChannelConfig,
  UpdatePaymentChannelConfigInput,
} from '@zenith/shared';

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
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

export interface ListChannelConfigsQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  channel?: PaymentChannel;
  status?: 'enabled' | 'disabled';
}

export async function listAllChannelConfigs() {
  const tc = tenantCondition(paymentChannelConfigs, currentUser());
  const rows = await db.select().from(paymentChannelConfigs).where(tc).orderBy(asc(paymentChannelConfigs.id));
  return rows.map(mapChannelConfig);
}

export async function listChannelConfigs(q: ListChannelConfigsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conditions = [];
  if (q.keyword) conditions.push(like(paymentChannelConfigs.name, `%${escapeLike(q.keyword)}%`));
  if (q.channel) conditions.push(eq(paymentChannelConfigs.channel, q.channel));
  if (q.status) conditions.push(eq(paymentChannelConfigs.status, q.status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const finalWhere = mergeWhere(where, tenantCondition(paymentChannelConfigs, currentUser()));
  const [total, list] = await Promise.all([
    db.$count(paymentChannelConfigs, finalWhere),
    withPagination(
      db.select().from(paymentChannelConfigs).where(finalWhere).orderBy(desc(paymentChannelConfigs.id)).$dynamic(),
      page,
      pageSize,
    ),
  ]);
  return { list: list.map(mapChannelConfig), total, page, pageSize };
}

export async function ensureChannelConfigExists(id: number): Promise<PaymentChannelConfigRow> {
  const tc = tenantCondition(paymentChannelConfigs, currentUser());
  const [row] = await db.select().from(paymentChannelConfigs).where(and(eq(paymentChannelConfigs.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '支付渠道配置不存在' });
  return row;
}

export async function getChannelConfig(id: number): Promise<PaymentChannelConfig> {
  return mapChannelConfig(await ensureChannelConfigExists(id));
}

export async function createChannelConfig(input: CreatePaymentChannelConfigInput): Promise<PaymentChannelConfig> {
  const user = currentUser();
  const values: NewPaymentChannelConfig = {
    name: input.name,
    channel: input.channel,
    status: input.status ?? 'enabled',
    isDefault: input.isDefault ?? false,
    sandbox: input.sandbox ?? false,
    notifyUrl: input.notifyUrl ?? null,
    wechatAppId: input.wechatAppId ?? null,
    wechatMchId: input.wechatMchId ?? null,
    wechatApiV3KeyEncrypted: input.wechatApiV3Key ? encryptField(input.wechatApiV3Key) : null,
    wechatPrivateKeyEncrypted: input.wechatPrivateKey ? encryptField(input.wechatPrivateKey) : null,
    wechatSerialNo: input.wechatSerialNo ?? null,
    wechatPlatformCert: input.wechatPlatformCert ?? null,
    alipayAppId: input.alipayAppId ?? null,
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
    tenantId: getCreateTenantId(user),
  };
  return db.transaction(async (tx) => {
    if (values.isDefault) {
      await tx
        .update(paymentChannelConfigs)
        .set({ isDefault: false })
        .where(and(eq(paymentChannelConfigs.channel, input.channel), tenantCondition(paymentChannelConfigs, user)));
    }
    const [row] = await tx.insert(paymentChannelConfigs).values(values).returning();
    return mapChannelConfig(row);
  });
}

export async function updateChannelConfig(id: number, input: UpdatePaymentChannelConfigInput): Promise<PaymentChannelConfig> {
  const user = currentUser();
  const existing = await ensureChannelConfigExists(id);
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
    if (set.isDefault) {
      await tx
        .update(paymentChannelConfigs)
        .set({ isDefault: false })
        .where(and(eq(paymentChannelConfigs.channel, targetChannel), tenantCondition(paymentChannelConfigs, user)));
    }
    const [row] = await tx
      .update(paymentChannelConfigs)
      .set(set)
      .where(and(eq(paymentChannelConfigs.id, id), tenantCondition(paymentChannelConfigs, user)))
      .returning();
    if (!row) throw new HTTPException(404, { message: '支付渠道配置不存在' });
    return mapChannelConfig(row);
  });
}

export async function deleteChannelConfig(id: number): Promise<void> {
  await ensureChannelConfigExists(id);
  await db.delete(paymentChannelConfigs).where(eq(paymentChannelConfigs.id, id));
}

/** 将指定渠道配置设为该渠道的默认（同租户同渠道内互斥），并自动启用 */
export async function setChannelAsDefault(id: number): Promise<PaymentChannelConfig> {
  const user = currentUser();
  const existing = await ensureChannelConfigExists(id);
  return db.transaction(async (tx) => {
    await tx
      .update(paymentChannelConfigs)
      .set({ isDefault: false })
      .where(and(eq(paymentChannelConfigs.channel, existing.channel), tenantCondition(paymentChannelConfigs, user)));
    const [row] = await tx
      .update(paymentChannelConfigs)
      .set({ isDefault: true, status: 'enabled' })
      .where(and(eq(paymentChannelConfigs.id, id), tenantCondition(paymentChannelConfigs, user)))
      .returning();
    if (!row) throw new HTTPException(404, { message: '支付渠道配置不存在' });
    return mapChannelConfig(row);
  });
}
