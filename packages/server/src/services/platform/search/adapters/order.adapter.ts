import { ilike, or } from 'drizzle-orm';
import { hasPermission, currentUser } from '../../../../lib/context';
import { getDataScopeCondition } from '../../../../lib/data-scope';
import { tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { db } from '../../../../db';
import { paymentOrders } from '../../../../db/schema';
import type { GlobalSearchAdapter } from '../types';
import { likePattern, result } from '../helpers';

export const orderSearchAdapter: GlobalSearchAdapter = {
  type: 'order',
  permissions: ['payment:order:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('payment:order:list'))) return [];
    const user = currentUser();
    const pattern = likePattern(q);
    const scope = await getDataScopeCondition({ currentUserId: user.userId, deptColumn: paymentOrders.departmentId, ownerColumn: paymentOrders.createdBy });
    const rows = await db.select({
      id: paymentOrders.id,
      orderNo: paymentOrders.orderNo,
      subject: paymentOrders.subject,
      status: paymentOrders.status,
      amount: paymentOrders.amount,
    })
      .from(paymentOrders)
      .where(buildWhere(
        or(ilike(paymentOrders.orderNo, pattern), ilike(paymentOrders.outTradeNo, pattern), ilike(paymentOrders.subject, pattern))!,
        scope,
        tenantCondition(paymentOrders, user),
      ))
      .orderBy(paymentOrders.id)
      .limit(limit);
    return rows.map((row) => result({
      type: 'order',
      id: String(row.id),
      title: row.orderNo,
      subtitle: row.subject,
      description: row.status,
      icon: 'ScrollText',
      route: `/payment/orders?keyword=${encodeURIComponent(row.orderNo)}`,
      highlights: [{ field: 'title', text: row.orderNo }],
    }));
  },
};
