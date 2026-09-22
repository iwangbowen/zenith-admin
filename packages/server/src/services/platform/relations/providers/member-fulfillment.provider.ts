import { desc, eq, lt, sql } from 'drizzle-orm';
import { WALLET_TX_TYPES, WALLET_TX_TYPE_LABELS, MEMBER_RENEWAL_BIZ_TYPE } from '@zenith/shared/member';
import type { EntityRelationPage } from '@zenith/shared/platform';
import { members, memberVipRenewals, memberWalletTransactions, paymentOrders } from '../../../../db/schema';
import { hasPermission } from '../../../../lib/context';
import { exactTenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { memberFulfillmentVisibility } from '../../../member/member-fulfillment.service';
import { WALLET_RECHARGE_BIZ_TYPE } from '../../../member/member-wallet.service';
import { buildOrdersWhere } from '../../../payment/payment.service';
import { relationPage } from '../page';
import { decodeRelationCursor } from '../cursor';
import { relationFilterWhere } from '../filters';
import { relationSummaryQuery } from '../summary-query';
import type { EntityAnchorResolver, RelationAccessContext, RelationProvider, VisibleEntityAnchor } from '../types';

const empty = (): EntityRelationPage => ({ items: [], hasMore: false, nextCursor: null });
const types = ['member.wallet-transaction', 'member.vip-renewal'] as const;
type FulfillmentType = typeof types[number];
const validId = (value: string) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 2_147_483_647;

export const memberFulfillmentAnchors: readonly EntityAnchorResolver[] = types.map((type) => ({ type,
  async resolve(ref, access) {
    const wallet = type === 'member.wallet-transaction';
    if (!validId(ref.key) || !await hasPermission(wallet ? 'member:wallet:list' : 'member:member:list')) return null;
    const table = wallet ? memberWalletTransactions : memberVipRenewals;
    const [row] = await access.db.select({ id: table.id, memberId: table.memberId, tenantId: members.tenantId,
      orderNo: wallet ? memberWalletTransactions.paymentIntentNo : memberVipRenewals.orderNo,
    }).from(table).innerJoin(members, eq(table.memberId, members.id))
      .where(buildWhere(eq(table.id, Number(ref.key)), await memberFulfillmentVisibility(access.db))).limit(1);
    return row ? { ref: { type, key: String(row.id) }, title: `${wallet ? '钱包流水' : 'VIP 续费履约'} #${row.id}`,
      tenantId: row.tenantId, metadata: { memberId: row.memberId, orderNo: row.orderNo } } : null;
  },
}));

async function fulfillmentWhere(type: FulfillmentType, anchor: VisibleEntityAnchor, access: RelationAccessContext) {
  const wallet = type === 'member.wallet-transaction';
  const table = wallet ? memberWalletTransactions : memberVipRenewals;
  return buildWhere(await memberFulfillmentVisibility(access.db), exactTenantCondition(members.tenantId, anchor.tenantId),
    anchor.ref.type === 'member.member' ? eq(table.memberId, Number(anchor.ref.key)) : wallet
      ? buildWhere(eq(memberWalletTransactions.paymentIntentNo, String(anchor.metadata?.orderNo)),
        eq(memberWalletTransactions.bizType, WALLET_RECHARGE_BIZ_TYPE), eq(memberWalletTransactions.type, 'recharge'))
      : eq(memberVipRenewals.orderNo, String(anchor.metadata?.orderNo)));
}

function fulfillmentProvider(sourceType: 'member.member' | 'payment.order', type: FulfillmentType): RelationProvider {
  const wallet = type === 'member.wallet-transaction';
  const table = wallet ? memberWalletTransactions : memberVipRenewals;
  const key = `${sourceType}.${wallet ? 'wallet-transactions' : 'vip-renewals'}`;
  const columns = { keyword: wallet ? [memberWalletTransactions.paymentIntentNo, memberWalletTransactions.remark] : [memberVipRenewals.orderNo, memberVipRenewals.contractNo],
    status: wallet ? memberWalletTransactions.type : undefined, occurredAt: table.createdAt };
  return { sourceType, key, permissions: [wallet ? 'member:wallet:list' : 'member:member:list'],
    appliesTo: (anchor) => sourceType === 'member.member' || anchor.metadata?.bizType === (wallet ? WALLET_RECHARGE_BIZ_TYPE : MEMBER_RENEWAL_BIZ_TYPE),
    descriptor: { key, labelKey: `relation.${key}`, targetTypes: [type], kind: 'causal', cardinality: 'many',
      capabilities: { view: true, open: true }, filters: { keyword: true, dateRange: true,
        ...(wallet ? { statusOptions: WALLET_TX_TYPES.map((value) => ({ value, label: WALLET_TX_TYPE_LABELS[value] })) } : {}) } },
    async prepareSummaryQuery(anchor, { access }) {
      return relationSummaryQuery(access.db.select({ id: table.id }).from(table).innerJoin(members, eq(table.memberId, members.id))
        .where(await fulfillmentWhere(type, anchor, access)));
    },
    async list(anchor, { access, limit, cursor, filters }) {
      const before = decodeRelationCursor(cursor);
      const rows = await access.db.select({ id: table.id, amount: table.amount, createdAt: table.createdAt,
        title: wallet ? memberWalletTransactions.paymentIntentNo : memberVipRenewals.orderNo,
        status: wallet ? memberWalletTransactions.type : sql<string>`'completed'`,
        description: wallet ? memberWalletTransactions.remark : sql<string>`'续费已履约'`,
      }).from(table).innerJoin(members, eq(table.memberId, members.id))
        .where(buildWhere(await fulfillmentWhere(type, anchor, access), relationFilterWhere(filters, columns), before ? lt(table.id, before) : undefined))
        .orderBy(desc(table.id)).limit(limit + 1);
      return relationPage(rows, limit, (row) => ({ ref: { type, key: String(row.id) }, relationKey: key,
        title: (row.title || `${wallet ? '钱包流水' : 'VIP 续费'} #${row.id}`).slice(0, 160), subtitle: `¥${(row.amount / 100).toFixed(2)}`,
        description: row.description?.slice(0, 500), status: row.status, occurredAt: row.createdAt.toISOString(),
        capabilities: { view: true, open: true } }));
    },
  };
}

function fulfillmentMember(type: FulfillmentType): RelationProvider {
  const key = `${type}.member`;
  return { sourceType: type, key, permissions: ['member:member:list'], descriptor: { key, labelKey: `relation.${key}`,
    targetTypes: ['member.member'], kind: 'direct', cardinality: 'one', capabilities: { view: true, open: true } },
    async list(anchor, { access, limit, cursor }) {
      if (cursor || typeof anchor.metadata?.memberId !== 'number') return empty();
      const rows = await access.db.select({ id: members.id, name: members.nickname }).from(members)
        .where(buildWhere(eq(members.id, anchor.metadata.memberId), exactTenantCondition(members.tenantId, anchor.tenantId), await memberFulfillmentVisibility(access.db))).limit(1);
      return relationPage(rows, limit, (row) => ({ ref: { type: 'member.member', key: String(row.id) }, relationKey: key,
        title: row.name || `会员 #${row.id}`, capabilities: { view: true, open: true } }));
    },
  };
}

function fulfillmentOrder(type: FulfillmentType): RelationProvider {
  const key = `${type}.order`;
  return { sourceType: type, key, permissions: ['payment:order:list'], appliesTo: (a) => typeof a.metadata?.orderNo === 'string',
    descriptor: { key, labelKey: `relation.${key}`, targetTypes: ['payment.order'], kind: 'causal', cardinality: 'one', capabilities: { view: true, open: true } },
    async list(anchor, { access, limit, cursor }) {
      if (cursor || typeof anchor.metadata?.orderNo !== 'string') return empty();
      const rows = await access.db.select({ id: paymentOrders.id, orderNo: paymentOrders.orderNo, subject: paymentOrders.subject, status: paymentOrders.status, createdAt: paymentOrders.createdAt })
        .from(paymentOrders).where(buildWhere(eq(paymentOrders.orderNo, anchor.metadata.orderNo),
          eq(paymentOrders.bizType, type === 'member.wallet-transaction' ? WALLET_RECHARGE_BIZ_TYPE : MEMBER_RENEWAL_BIZ_TYPE),
          exactTenantCondition(paymentOrders.tenantId, anchor.tenantId), await buildOrdersWhere({}, access.db))).limit(1);
      return relationPage(rows, limit, (row) => ({ ref: { type: 'payment.order', key: String(row.id) }, relationKey: key,
        title: row.subject.slice(0, 160), subtitle: row.orderNo, status: row.status, occurredAt: row.createdAt.toISOString(), capabilities: { view: true, open: true } }));
    },
  };
}

export const memberFulfillmentProviders: readonly RelationProvider[] = types.flatMap((type) => [
  fulfillmentProvider('member.member', type), fulfillmentProvider('payment.order', type), fulfillmentMember(type), fulfillmentOrder(type),
]);
