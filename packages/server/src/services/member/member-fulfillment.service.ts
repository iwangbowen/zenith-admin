import { eq, isNull } from 'drizzle-orm';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { members, memberVipRenewals, memberWalletTransactions } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { getDataScopeCondition } from '../../lib/data-scope';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime } from '../../lib/datetime';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { mapWalletTransaction } from './member-wallet.service';

/** Fulfillment inherits the member's tenant and administrator data scope. */
export async function memberFulfillmentVisibility(executor: DbExecutor = db) {
  const user = currentUser();
  return buildWhere(isNull(members.deletedAt), tenantCondition(members, user),
    await getDataScopeCondition({ currentUserId: user.userId, executor, ownerColumn: members.createdBy }));
}

export async function getMemberWalletTransaction(id: number) {
  const [found] = await db.select({ row: memberWalletTransactions, name: members.nickname })
    .from(memberWalletTransactions).innerJoin(members, eq(members.id, memberWalletTransactions.memberId))
    .where(buildWhere(eq(memberWalletTransactions.id, id), await memberFulfillmentVisibility())).limit(1);
  const result = requireRow(found, '钱包流水不存在或无权查看');
  return { ...mapWalletTransaction(result.row, result.name), paymentIntentNo: result.row.paymentIntentNo };
}

export async function getMemberVipRenewal(id: number) {
  const [found] = await db.select({ row: memberVipRenewals, name: members.nickname })
    .from(memberVipRenewals).innerJoin(members, eq(members.id, memberVipRenewals.memberId))
    .where(buildWhere(eq(memberVipRenewals.id, id), await memberFulfillmentVisibility())).limit(1);
  const { row, name } = requireRow(found, 'VIP 续费履约不存在或无权查看');
  return { id: row.id, memberId: row.memberId, memberName: name, orderNo: row.orderNo, contractNo: row.contractNo,
    amount: row.amount, vipExpireAfter: formatDateTime(row.vipExpireAfter), createdAt: formatDateTime(row.createdAt) };
}
