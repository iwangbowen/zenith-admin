import { timestampColumns } from './common';
import { pgTable, varchar, timestamp, pgEnum, integer, text, real, index } from 'drizzle-orm/pg-core';
import { auditColumns, tenants } from './core';

// ─── 业务接入示例：请假（业务模块自有实体，通过 businessKey 关联工作流）──────────
export const bizLeaveStatusEnum = pgEnum('biz_leave_status', ['draft', 'pending', 'approved', 'rejected', 'cancelled']);

export const bizLeaves = pgTable('biz_leaves', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  leaveType: varchar({ length: 32 }).notNull(),
  startDate: timestamp({ withTimezone: true }).notNull(),
  endDate: timestamp({ withTimezone: true }).notNull(),
  days: real().notNull().default(1),
  reason: text(),
  status: bizLeaveStatusEnum().notNull().default('draft'),
  /** 关联的工作流实例 ID（提交审批后回填） */
  workflowInstanceId: integer(),
  /** 冗余的工作流状态，便于列表直接展示（由订阅器回写） */
  workflowStatus: varchar({ length: 16 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('biz_leaves_tenant_idx').on(t.tenantId)]);

export type BizLeaveRow = typeof bizLeaves.$inferSelect;

export type NewBizLeave = typeof bizLeaves.$inferInsert;

// ─── 业务接入示例：支付接入（演示业务模块如何对接支付中心）─────────────────────
export const bizPayDemoStatusEnum = pgEnum('biz_pay_demo_status', ['pending', 'paying', 'paid', 'closed']);

export const bizPayDemos = pgTable('biz_pay_demos', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  /** 示例事项 / 商品名称 */
  subject: varchar({ length: 128 }).notNull(),
  /** 金额（分） */
  amount: integer().notNull(),
  /** 发起支付时记录的支付方式（下单前为空） */
  payMethod: varchar({ length: 32 }),
  status: bizPayDemoStatusEnum().notNull().default('pending'),
  /** 关联支付中心订单号（发起支付后回填，用于查单/对账/履约幂等） */
  paymentOrderNo: varchar({ length: 64 }),
  /** 支付成功时间（履约时回写） */
  paidAt: timestamp({ withTimezone: true }),
  /** 履约备注（演示：支付成功后自动发放示例权益） */
  fulfillRemark: varchar({ length: 255 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [index('biz_pay_demos_tenant_idx').on(t.tenantId)]);

export type BizPayDemoRow = typeof bizPayDemos.$inferSelect;

export type NewBizPayDemo = typeof bizPayDemos.$inferInsert;
