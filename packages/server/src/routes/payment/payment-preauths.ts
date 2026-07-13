/**
 * 预授权管理路由（/api/payment/preauths）。
 * 发起冻结（沙箱即时生效）、转支付（生成正式交易并履约）、解冻、列表。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { capturePaymentPreauthSchema, createPaymentPreauthSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, IdParam, okBody } from '../../lib/openapi-schemas';
import { PaymentPreauthDTO } from '../../lib/openapi-dtos';
import {
  capturePreauth,
  createPreauth,
  ensurePreauth,
  listPreauths,
  releasePreauth,
} from '../../services/payment/payment-preauth.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const channelEnum = z.enum(['wechat', 'alipay', 'unionpay']);
const preauthStatusEnum = z.enum(['pending', 'frozen', 'captured', 'released', 'failed']);

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['支付中心-预授权'], summary: '预授权单列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:preauth:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: preauthStatusEnum.optional(),
        channel: channelEnum.optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...okPaginated(PaymentPreauthDTO, '预授权单列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listPreauths(c.req.valid('query'))), 200),
});

const createPreauthRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['支付中心-预授权'], summary: '发起预授权冻结（沙箱即时生效）',
    description: '资金冻结接口，挂幂等防重复提交；真实渠道需商户开通资金授权产品权限。',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'payment:preauth:manage', audit: { description: '发起预授权冻结', module: '支付中心' } }),
      idempotencyGuard({ ttlSeconds: 10 }),
    ] as const,
    request: { body: { content: jsonContent(createPaymentPreauthSchema), required: true } },
    responses: { ...ok(PaymentPreauthDTO, '冻结完成'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createPreauth(c.req.valid('json')), '冻结完成'), 200),
});

const captureRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/capture', tags: ['支付中心-预授权'], summary: '转支付（冻结资金转正式交易，剩余自动解冻）',
    description: '资金操作接口，挂幂等防重复提交；生成支付订单并走完整履约链。',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'payment:preauth:manage', audit: { description: '预授权转支付', module: '支付中心' } }),
      idempotencyGuard({ ttlSeconds: 10 }),
    ] as const,
    request: { params: IdParam, body: { content: jsonContent(capturePaymentPreauthSchema), required: false } },
    responses: { ...ok(PaymentPreauthDTO, '转支付完成'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensurePreauth(id));
    const body = (c.req.valid('json') ?? {}) as { captureAmount?: number; remark?: string };
    return c.json(okBody(await capturePreauth(id, body), '转支付完成'), 200);
  },
});

const releaseRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/release', tags: ['支付中心-预授权'], summary: '解冻（全额释放冻结资金）',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'payment:preauth:manage', audit: { description: '预授权解冻', module: '支付中心' } }),
      idempotencyGuard({ ttlSeconds: 10 }),
    ] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentPreauthDTO, '已解冻'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensurePreauth(id));
    return c.json(okBody(await releasePreauth(c.req.valid('param').id), '已解冻'), 200);
  },
});

router.openapiRoutes([listRoute, createPreauthRoute, captureRoute, releaseRoute] as const);

export default router;
