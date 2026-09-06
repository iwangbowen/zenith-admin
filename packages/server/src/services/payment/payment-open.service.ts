import { and, eq, inArray } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type {
  CreateOpenPaymentIntentInput,
  CreateOpenPaymentRefundInput,
  OpenPaymentApplicationCapabilities,
  OpenPaymentCapability,
  OpenPaymentIntent,
  OpenPaymentIntentCreated,
  OpenPaymentRefund,
  PaymentMethod,
} from '@zenith/shared/payment';
import { db } from '../../db';
import { exactTenantCondition } from '../../lib/tenant';
import { requireRow } from '../../lib/db-assert';
import { paymentChannelConfigs, paymentMethodConfigs, paymentOrders, paymentRefunds } from '../../db/schema';
import type { OpenPrincipal } from '../../middleware/open-gateway';
import { formatDateTime, formatNullableDateTime } from '../../lib/datetime';
import { getProviderManifest, initPaymentAdapters } from '../../lib/payment';
import { createPayment, refund } from './payment.service';
import { resolvePaymentApplicationByOpenClient } from './payment-apps.service';
import { decidePaymentCapability } from './payment-capability-evaluator';

function mapOpenIntent(row: typeof paymentOrders.$inferSelect): OpenPaymentIntent {
  return {
    orderNo: row.orderNo,
    bizType: row.bizType,
    bizId: row.bizId,
    subject: row.subject,
    amount: row.amount,
    currency: row.currency,
    channel: row.channel,
    payMethod: row.payMethod,
    status: row.status,
    paidAmount: row.paidAmount ?? null,
    paidAt: formatNullableDateTime(row.paidAt),
    expiredAt: formatNullableDateTime(row.expiredAt),
    errorMessage: row.errorMessage ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

function mapOpenRefund(row: typeof paymentRefunds.$inferSelect): OpenPaymentRefund {
  return {
    refundNo: row.refundNo,
    orderNo: row.orderNo,
    refundAmount: row.refundAmount,
    status: row.status,
    approvalStatus: row.approvalStatus,
    refundedAt: formatNullableDateTime(row.refundedAt),
    errorMessage: row.errorMessage ?? null,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

async function applicationContext(principal: OpenPrincipal) {
  const tenantId = principal.tenantId;
  const app = await resolvePaymentApplicationByOpenClient(principal.app.id, tenantId);
  if (app.openClient.environment !== principal.app.environment) {
    throw new HTTPException(403, { message: '开放应用环境与支付应用环境不一致' });
  }
  return { app, tenantId };
}

async function scopedOrder(principal: OpenPrincipal, orderNo: string) {
  const { app, tenantId } = await applicationContext(principal);
  const [order] = await db
    .select()
    .from(paymentOrders)
    .where(and(
      eq(paymentOrders.orderNo, orderNo),
      eq(paymentOrders.appId, app.id),
      exactTenantCondition(paymentOrders.tenantId, tenantId),
    ))
    .limit(1);
  requireRow(order, '支付意图不存在');
  return { app, tenantId, order };
}

export async function createOpenPaymentIntent(input: {
  principal: OpenPrincipal;
  data: CreateOpenPaymentIntentInput;
  idempotencyKey: string;
  clientIp: string;
}): Promise<OpenPaymentIntentCreated> {
  if (new Set(['member_recharge', 'member_renewal', 'biz_pay_demo']).has(input.data.bizType)) {
    throw new HTTPException(403, { message: '该业务类型仅允许由内部业务服务发起' });
  }
  const { app, tenantId } = await applicationContext(input.principal);
  const created = await createPayment({
    ...input.data,
    applicationId: app.id,
    tenantId,
    idempotencyKey: input.idempotencyKey,
    clientIp: input.clientIp,
  });
  const { order } = await scopedOrder(input.principal, created.orderNo);
  return { intent: mapOpenIntent(order), payParams: created.payParams };
}

export async function getOpenPaymentIntent(principal: OpenPrincipal, orderNo: string): Promise<OpenPaymentIntent> {
  return mapOpenIntent((await scopedOrder(principal, orderNo)).order);
}

export async function createOpenPaymentRefund(input: {
  principal: OpenPrincipal;
  data: CreateOpenPaymentRefundInput;
  idempotencyKey: string;
}): Promise<OpenPaymentRefund> {
  const { order, tenantId } = await scopedOrder(input.principal, input.data.orderNo);
  const result = await refund({ ...input.data, idempotencyKey: input.idempotencyKey });
  const [row] = await db
    .select()
    .from(paymentRefunds)
    .where(and(
      eq(paymentRefunds.refundNo, result.refundNo),
      eq(paymentRefunds.orderId, order.id),
      exactTenantCondition(paymentRefunds.tenantId, tenantId),
    ))
    .limit(1);
  if (!row) throw new HTTPException(500, { message: '退款已受理但本地记录读取失败' });
  return mapOpenRefund(row);
}

export async function getOpenPaymentRefund(principal: OpenPrincipal, refundNo: string): Promise<OpenPaymentRefund> {
  const { app, tenantId } = await applicationContext(principal);
  const [row] = await db
    .select({ refund: paymentRefunds })
    .from(paymentRefunds)
    .innerJoin(paymentOrders, eq(paymentRefunds.orderId, paymentOrders.id))
    .where(and(
      eq(paymentRefunds.refundNo, refundNo),
      eq(paymentOrders.appId, app.id),
      exactTenantCondition(paymentOrders.tenantId, tenantId),
      exactTenantCondition(paymentRefunds.tenantId, tenantId),
    ))
    .limit(1);
  requireRow(row, '退款不存在');
  return mapOpenRefund(row.refund);
}

export async function getOpenPaymentCapabilities(
  principal: OpenPrincipal,
): Promise<OpenPaymentApplicationCapabilities> {
  initPaymentAdapters();
  const { app, tenantId } = await applicationContext(principal);
  const configIds = [app.wechatConfigId, app.alipayConfigId, app.unionpayConfigId]
    .filter((id): id is number => id != null);
  const configs = configIds.length > 0
    ? await db.select().from(paymentChannelConfigs).where(and(
        inArray(paymentChannelConfigs.id, configIds),
        exactTenantCondition(paymentChannelConfigs.tenantId, tenantId),
      ))
    : [];
  const methods = await db
    .select()
    .from(paymentMethodConfigs)
    .where(exactTenantCondition(paymentMethodConfigs.tenantId, tenantId));
  const methodByCode = new Map(methods.map((item) => [item.method, item]));
  const capabilities: OpenPaymentCapability[] = [];
  const exposedOperations = new Set(['payment.create', 'payment.query', 'refund.create', 'refund.query']);

  for (const configRow of configs) {
    const manifest = getProviderManifest(configRow.channel);
    for (const capability of manifest.capabilities) {
      if (!exposedOperations.has(capability.operation)) continue;
      const capabilityMethods: Array<PaymentMethod | null> = capability.paymentMethods?.length
        ? [...capability.paymentMethods]
        : [null];
      for (const method of capabilityMethods) {
        for (const currency of capability.currencies) {
          const decision = decidePaymentCapability({
            configRow,
            manifestSandboxFields: manifest.sandboxRequiredConfigFields,
            capability,
            method,
            currency,
            methodByCode,
          });
          capabilities.push({
            channel: configRow.channel,
            operation: capability.operation,
            paymentMethod: method,
            currency,
            execution: capability.execution,
            limits: capability.limits
              ? {
                  maxAmount: capability.limits.maxAmount ?? null,
                  receiverNameRequiredAtOrAbove: capability.limits.receiverNameRequiredAtOrAbove ?? null,
                }
              : null,
            supported: decision.supported,
            reasonCode: decision.reasonCode,
            reason: decision.reason,
          });
        }
      }
    }
  }

  return {
    clientId: principal.app.clientId,
    environment: principal.app.environment,
    capabilities,
  };
}
