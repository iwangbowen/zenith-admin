/**
 * 转账/代付管理路由（/api/payment/transfers）。
 * 发起转账（微信零钱 / 支付宝账户）、查单同步、失败重试（仅渠道未受理）、列表与汇总。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createPaymentTransferSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, IdParam, okBody } from '../../lib/openapi-schemas';
import { PaymentTransferDTO, PaymentTransferSummaryDTO } from '../../lib/openapi-dtos';
import {
  createTransfer,
  getTransfer,
  getTransferSummary,
  listTransfers,
  retryTransfer,
  syncTransferStatus,
} from '../../services/payment/payment-transfer.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const channelEnum = z.enum(['wechat', 'alipay', 'unionpay']);
const transferStatusEnum = z.enum(['pending', 'processing', 'success', 'failed']);

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['支付中心-转账'], summary: '转账单列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:transfer:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        channel: channelEnum.optional(),
        status: transferStatusEnum.optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...okPaginated(PaymentTransferDTO, '转账单列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listTransfers(c.req.valid('query'))), 200),
});

const summaryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/summary', tags: ['支付中心-转账'], summary: '转账汇总（成功金额/各状态笔数）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:transfer:list' })] as const,
    request: { query: z.object({ channel: channelEnum.optional() }) },
    responses: { ...ok(PaymentTransferSummaryDTO, '转账汇总'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getTransferSummary(c.req.valid('query'))), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['支付中心-转账'], summary: '转账单详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:transfer:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentTransferDTO, '转账单详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getTransfer(c.req.valid('param').id)), 200),
});

const createTransferRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['支付中心-转账'], summary: '发起转账（微信零钱 / 支付宝账户）',
    description: '落单后同步调渠道执行；渠道失败时单据置为 failed（渠道未受理可在列表重试）。资金流出接口，挂幂等防重复提交。',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'payment:transfer:create', audit: { description: '发起转账', module: '支付中心' } }),
      idempotencyGuard({ ttlSeconds: 15 }),
    ] as const,
    request: { body: { content: jsonContent(createPaymentTransferSchema), required: true } },
    responses: { ...ok(PaymentTransferDTO, '转账已受理'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createTransfer(c.req.valid('json')), '转账已受理'), 200),
});

const queryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/query', tags: ['支付中心-转账'], summary: '主动查询渠道转账结果并同步本地状态',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:transfer:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentTransferDTO, '查单完成'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await syncTransferStatus(c.req.valid('param').id), '查单完成'), 200),
});

const retryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/retry', tags: ['支付中心-转账'], summary: '重试失败转账（仅渠道未受理的失败单）',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'payment:transfer:create', audit: { description: '重试转账', module: '支付中心' } }),
      idempotencyGuard({ ttlSeconds: 15 }),
    ] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentTransferDTO, '重试完成'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await retryTransfer(c.req.valid('param').id), '重试完成'), 200),
});

router.openapiRoutes([listRoute, summaryRoute, detailRoute, createTransferRoute, queryRoute, retryRoute] as const);

export default router;
