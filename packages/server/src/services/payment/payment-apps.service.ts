/**
 * 支付应用（App 维度）Service。
 * 业务方按 appKey 下单，支付中心路由到该应用绑定的各渠道配置（微信/支付宝/云闪付各一），
 * 订单落 appId 归属，向「商户/应用」多层体系演进的第一期实现。
 */
import { and, desc, eq, like } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { paymentApps, paymentChannelConfigs, type PaymentAppRow } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { getCreateTenantId, tenantCondition } from '../../lib/tenant';
import { mergeWhere, escapeLike, withPagination } from '../../lib/where-helpers';
import { pageOffset } from '../../lib/pagination';
import { formatDateTime } from '../../lib/datetime';
import { rethrowPgUniqueViolation } from '../../lib/db-errors';
import type { CreatePaymentAppInput, UpdatePaymentAppInput, PaymentApp, PaymentChannel } from '@zenith/shared';

type AppWithConfigs = PaymentAppRow & {
  wechatConfig?: { name: string } | null;
  alipayConfig?: { name: string } | null;
  unionpayConfig?: { name: string } | null;
};

export function mapApp(row: AppWithConfigs): PaymentApp {
  return {
    id: row.id,
    name: row.name,
    appKey: row.appKey,
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

const APP_RELATIONS = {
  wechatConfig: { columns: { name: true } },
  alipayConfig: { columns: { name: true } },
  unionpayConfig: { columns: { name: true } },
} as const;

export async function listApps(q: ListAppsQuery) {
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? 10;
  const conds = [];
  if (q.keyword) {
    const kw = `%${escapeLike(q.keyword)}%`;
    conds.push(like(paymentApps.name, kw));
  }
  if (q.status) conds.push(eq(paymentApps.status, q.status));
  const where = mergeWhere(conds.length ? and(...conds) : undefined, tenantCondition(paymentApps, currentUser()));
  const [total, rows] = await Promise.all([
    db.$count(paymentApps, where),
    db.query.paymentApps.findMany({
      where,
      orderBy: desc(paymentApps.id),
      limit: pageSize,
      offset: pageOffset(page, pageSize),
      with: APP_RELATIONS,
    }),
  ]);
  return { list: rows.map(mapApp), total, page, pageSize };
}

async function ensureApp(id: number): Promise<PaymentAppRow> {
  const tc = tenantCondition(paymentApps, currentUser());
  const [row] = await db.select().from(paymentApps).where(and(eq(paymentApps.id, id), tc)).limit(1);
  if (!row) throw new HTTPException(404, { message: '支付应用不存在' });
  return row;
}

export async function getApp(id: number): Promise<PaymentApp> {
  await ensureApp(id);
  const row = await db.query.paymentApps.findFirst({ where: eq(paymentApps.id, id), with: APP_RELATIONS });
  if (!row) throw new HTTPException(404, { message: '支付应用不存在' });
  return mapApp(row);
}

async function assertConfigChannel(configId: number | null | undefined, channel: PaymentChannel): Promise<void> {
  if (configId == null) return;
  const [row] = await db.select({ channel: paymentChannelConfigs.channel }).from(paymentChannelConfigs).where(eq(paymentChannelConfigs.id, configId)).limit(1);
  if (!row) throw new HTTPException(400, { message: '渠道配置不存在' });
  if (row.channel !== channel) throw new HTTPException(400, { message: `配置 ${configId} 不是${channel}渠道，无法绑定` });
}

export async function createApp(input: CreatePaymentAppInput): Promise<PaymentApp> {
  await assertConfigChannel(input.wechatConfigId, 'wechat');
  await assertConfigChannel(input.alipayConfigId, 'alipay');
  await assertConfigChannel(input.unionpayConfigId, 'unionpay');
  try {
    const [row] = await db
      .insert(paymentApps)
      .values({
        name: input.name,
        appKey: input.appKey,
        status: input.status ?? 'enabled',
        wechatConfigId: input.wechatConfigId ?? null,
        alipayConfigId: input.alipayConfigId ?? null,
        unionpayConfigId: input.unionpayConfigId ?? null,
        remark: input.remark ?? null,
        tenantId: getCreateTenantId(currentUser()),
      })
      .returning();
    return getApp(row.id);
  } catch (err) {
    rethrowPgUniqueViolation(err, 'appKey 已存在');
  }
}

export async function updateApp(id: number, input: UpdatePaymentAppInput): Promise<PaymentApp> {
  await ensureApp(id);
  if (input.wechatConfigId !== undefined) await assertConfigChannel(input.wechatConfigId, 'wechat');
  if (input.alipayConfigId !== undefined) await assertConfigChannel(input.alipayConfigId, 'alipay');
  if (input.unionpayConfigId !== undefined) await assertConfigChannel(input.unionpayConfigId, 'unionpay');
  const set: Partial<PaymentAppRow> = {};
  if (input.name !== undefined) set.name = input.name;
  if (input.appKey !== undefined) set.appKey = input.appKey;
  if (input.status !== undefined) set.status = input.status;
  if (input.wechatConfigId !== undefined) set.wechatConfigId = input.wechatConfigId ?? null;
  if (input.alipayConfigId !== undefined) set.alipayConfigId = input.alipayConfigId ?? null;
  if (input.unionpayConfigId !== undefined) set.unionpayConfigId = input.unionpayConfigId ?? null;
  if (input.remark !== undefined) set.remark = input.remark ?? null;
  try {
    const tc = tenantCondition(paymentApps, currentUser());
    await db.update(paymentApps).set(set).where(and(eq(paymentApps.id, id), tc));
    return getApp(id);
  } catch (err) {
    rethrowPgUniqueViolation(err, 'appKey 已存在');
  }
}

export async function deleteApp(id: number): Promise<void> {
  await ensureApp(id);
  await db.delete(paymentApps).where(eq(paymentApps.id, id));
}

/** 下单按 appKey 解析：返回应用与该渠道绑定的配置 id（未绑定该渠道时报错）。供 createPayment 调用，不依赖请求上下文。 */
export async function resolveAppChannelConfig(appKey: string, channel: PaymentChannel): Promise<{ appId: number; channelConfigId: number }> {
  const [app] = await db.select().from(paymentApps).where(eq(paymentApps.appKey, appKey)).limit(1);
  if (!app) throw new HTTPException(400, { message: `支付应用不存在：${appKey}` });
  if (app.status !== 'enabled') throw new HTTPException(400, { message: `支付应用已停用：${appKey}` });
  const configId = channel === 'wechat' ? app.wechatConfigId : channel === 'alipay' ? app.alipayConfigId : app.unionpayConfigId;
  if (!configId) throw new HTTPException(400, { message: `应用「${app.name}」未绑定${channel}渠道配置` });
  return { appId: app.id, channelConfigId: configId };
}
