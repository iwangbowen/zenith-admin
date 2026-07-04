import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import {
  PaginationQuery,
  jsonContent,
  validationHook,
  commonErrorResponses,
  ok,
  okPaginated,
  okMsg,
  IdParam,
  okBody,
} from '../../lib/openapi-schemas';
import { PaymentReconBatchDTO, PaymentReconItemDTO } from '../../lib/openapi-dtos';
import {
  listReconBatches,
  getReconBatch,
  listReconItems,
  createReconBatch,
  deleteReconBatch,
  generateSampleBill,
  handleReconItem,
  autoReconcileForCurrentUser,
} from '../../services/payment/payment-recon.service';
import { handlePaymentReconItemSchema } from '@zenith/shared';

const router = new OpenAPIHono({ defaultHook: validationHook });
const channelEnum = z.enum(['wechat', 'alipay', 'unionpay']);
const reconStatusEnum = z.enum(['pending', 'comparing', 'done', 'failed']);
const reconResultEnum = z.enum(['matched', 'local_only', 'channel_only', 'amount_diff', 'status_diff']);
const reconHandleStatusEnum = z.enum(['pending', 'adjusted', 'suspended', 'ignored']);
const billDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '账单日期须为 YYYY-MM-DD');

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/batches', tags: ['支付中心-对账'], summary: '对账批次列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:recon:list' })] as const,
    request: { query: PaginationQuery.extend({ channel: channelEnum.optional(), status: reconStatusEnum.optional() }) },
    responses: { ...okPaginated(PaymentReconBatchDTO, '对账批次列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listReconBatches(c.req.valid('query'))), 200),
});

const createBatchRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/batches', tags: ['支付中心-对账'], summary: '创建对账批次（上传渠道账单逐笔比对）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:recon:create', audit: { description: '创建支付对账批次', module: '支付中心', recordBody: false } })] as const,
    request: {
      body: {
        content: jsonContent(
          z.object({
            channel: channelEnum,
            billDate,
            billText: z.string().min(1).max(2_000_000),
            remark: z.string().max(256).optional(),
          }),
        ),
        required: true,
      },
    },
    responses: { ...ok(PaymentReconBatchDTO, '对账完成'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createReconBatch(c.req.valid('json')), '对账完成'), 200),
});

const sampleRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/sample-bill', tags: ['支付中心-对账'], summary: '生成模拟渠道账单（演示/模板）',
    description: '基于本地订单生成一份 CSV 渠道账单，用于演示对账或作为账单格式模板。',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:recon:create' })] as const,
    request: { query: z.object({ channel: channelEnum, billDate }) },
    responses: { ...ok(z.object({ billText: z.string() }).openapi('PaymentReconSampleBill'), '模拟账单'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { channel, billDate: date } = c.req.valid('query');
    return c.json(okBody({ billText: await generateSampleBill(channel, date) }), 200);
  },
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/batches/{id}', tags: ['支付中心-对账'], summary: '对账批次详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:recon:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentReconBatchDTO, '对账批次详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getReconBatch(c.req.valid('param').id)), 200),
});

const itemsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/batches/{id}/items', tags: ['支付中心-对账'], summary: '对账明细（可按差异类型筛选）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:recon:list' })] as const,
    request: { params: IdParam, query: PaginationQuery.extend({ result: reconResultEnum.optional(), handleStatus: reconHandleStatusEnum.optional() }) },
    responses: { ...okPaginated(PaymentReconItemDTO, '对账明细'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listReconItems(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const autoRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/auto', tags: ['支付中心-对账'], summary: '自动拉取渠道账单并对账',
    description: '沙箱渠道用本地订单生成模拟账单（演示闭环）；生产渠道调用渠道账单下载 API（微信交易账单；支付宝暂不支持需手动上传）。',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:recon:create', audit: { description: '自动拉取渠道账单对账', module: '支付中心' } })] as const,
    request: { body: { content: jsonContent(z.object({ channel: channelEnum, billDate })), required: true } },
    responses: { ...ok(PaymentReconBatchDTO, '对账完成'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { channel, billDate: date } = c.req.valid('json');
    return c.json(okBody(await autoReconcileForCurrentUser(channel, date), '对账完成'), 200);
  },
});

const handleItemRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'patch', path: '/items/{id}/handle', tags: ['支付中心-对账'], summary: '处理对账差异（调账/挂账/忽略）',
    description: '将待处理差异流转为已调账/挂账/已忽略；选择「已调账」时按差异金额自动记入资金台账（type=adjust）。',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:recon:handle', audit: { description: '处理支付对账差异', module: '支付中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(handlePaymentReconItemSchema), required: true } },
    responses: { ...ok(PaymentReconItemDTO, '处理成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await handleReconItem(c.req.valid('param').id, c.req.valid('json')), '处理成功'), 200),
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/batches/{id}', tags: ['支付中心-对账'], summary: '删除对账批次',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:recon:delete', audit: { description: '删除支付对账批次', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getReconBatch(id));
    await deleteReconBatch(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, createBatchRoute, sampleRoute, autoRoute, detailRoute, itemsRoute, handleItemRoute, deleteRoute] as const);

export default router;
