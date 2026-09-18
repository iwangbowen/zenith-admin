import { and, asc, desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@zenith/shared/core';
import { paymentChannelAccountContract, paymentChannelAccountSchema } from '@zenith/shared/payment';
import { db } from '../../db';
import { paymentChannelAccounts, paymentChannelConfigs, type PaymentChannelAccountRow, type PaymentChannelConfigRow } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { currentUser } from '../../lib/context';
import { requireRow } from '../../lib/db-assert';
import { pickEntity } from '../../lib/entity-map';
import { listRows } from '../../lib/list-query';
import { exactTenantCondition, tenantCondition } from '../../lib/tenant';
import { buildWhere, keywordCondition } from '../../lib/where-helpers';

type AccountIdentityConfig = Pick<PaymentChannelConfigRow, 'name' | 'channel' | 'sandbox' | 'tenantId' | 'wechatMchId' | 'alipaySellerId' | 'unionpayMerId'>;

/** 商户号是资金身份；应用号和密钥都不得用作商户号的替代。 */
export function channelMerchantId(config: AccountIdentityConfig): string {
  const merchantId = (config.channel === 'wechat' ? config.wechatMchId : config.channel === 'alipay' ? config.alipaySellerId : config.unionpayMerId)?.trim();
  if (!merchantId) throw new HTTPException(400, { message: '渠道账户必须提供真实商户号；支付宝请填写卖家 ID，沙箱也须填写独立商户标识' });
  return merchantId;
}

export async function ensureChannelAccountForConfig(config: AccountIdentityConfig, executor: DbExecutor = db): Promise<PaymentChannelAccountRow> {
  const merchantId = channelMerchantId(config);
  const environment = config.sandbox ? 'sandbox' as const : 'production' as const;
  const identity = and(exactTenantCondition(paymentChannelAccounts.tenantId, config.tenantId), eq(paymentChannelAccounts.channel, config.channel), eq(paymentChannelAccounts.environment, environment), eq(paymentChannelAccounts.merchantId, merchantId), eq(paymentChannelAccounts.subMerchantId, ''));
  await executor.insert(paymentChannelAccounts).values({
    name: `${config.name} · ${merchantId}`.slice(0, 128),
    channel: config.channel, environment, merchantId, tenantId: config.tenantId,
  }).onConflictDoNothing();
  const [account] = await executor.select().from(paymentChannelAccounts).where(identity).limit(1);
  requireRow(account, '渠道账户创建失败', 409);
  if (account.status !== 'enabled') throw new HTTPException(400, { message: '渠道账户已停用，不能绑定新的认证配置' });
  return account;
}

/** 在调用方事务内绑定；已产生交易的配置身份变更由 channels service 拒绝。 */
export async function bindChannelConfigAccount(config: PaymentChannelConfigRow, executor: DbExecutor = db): Promise<PaymentChannelAccountRow> {
  const account = await ensureChannelAccountForConfig(config, executor);
  if (config.channelAccountId !== account.id) await executor.update(paymentChannelConfigs).set({ channelAccountId: account.id }).where(eq(paymentChannelConfigs.id, config.id));
  return account;
}

const mapAccount = (row: PaymentChannelAccountRow) => pickEntity(paymentChannelAccountSchema, row);

export async function listChannelAccounts(q: QueryOutputOf<typeof paymentChannelAccountContract.list>) {
  return listRows({
    table: paymentChannelAccounts, page: q.page, pageSize: q.pageSize,
    where: buildWhere(tenantCondition(paymentChannelAccounts, currentUser()), keywordCondition(q.keyword, [paymentChannelAccounts.name, paymentChannelAccounts.merchantId]), q.channel ? eq(paymentChannelAccounts.channel, q.channel) : undefined, q.environment ? eq(paymentChannelAccounts.environment, q.environment) : undefined, q.status ? eq(paymentChannelAccounts.status, q.status) : undefined),
    orderBy: [desc(paymentChannelAccounts.id)], map: mapAccount,
  });
}

export async function listAllChannelAccounts() {
  const rows = await db.select().from(paymentChannelAccounts).where(buildWhere(tenantCondition(paymentChannelAccounts, currentUser()), eq(paymentChannelAccounts.status, 'enabled'))).orderBy(asc(paymentChannelAccounts.channel), asc(paymentChannelAccounts.name));
  return rows.map(mapAccount);
}

export async function getChannelAccount(id: number) {
  const [row] = await db.select().from(paymentChannelAccounts).where(buildWhere(eq(paymentChannelAccounts.id, id), tenantCondition(paymentChannelAccounts, currentUser()))).limit(1);
  return mapAccount(requireRow(row, '渠道账户不存在'));
}
