/**
 * 签约代扣管理路由（/api/payment/contracts + /api/payment/deduct-plans）。
 * 扣款计划 CRUD、签约协议列表/详情、创建签约（演示）、解约/暂停/恢复、手动补扣。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { createPaymentContractSchema, createPaymentDeductPlanSchema, updatePaymentDeductPlanSchema } from '@zenith/shared';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, okBody } from '../../lib/openapi-schemas';
import { PaymentContractDTO, PaymentDeductPlanDTO, PaymentDeductResultDTO } from '../../lib/openapi-dtos';
import {
  adminCreateContract,
  createDeductPlan,
  deductContractById,
  deleteDeductPlan,
  ensureContract,
  ensureDeductPlan,
  getContract,
  allDeductPlans,
  listContracts,
  listDeductPlans,
  pauseContract,
  resumeContract,
  terminateContract,
  updateDeductPlan,
} from '../../services/payment/payment-contract.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const channelEnum = z.enum(['wechat', 'alipay', 'unionpay']);
const contractStatusEnum = z.enum(['pending', 'signed', 'paused', 'terminated']);

const SignResultDTO = z
  .object({
    contract: PaymentContractDTO,
    firstDeduct: z
      .object({
        orderNo: z.string().nullable().optional(),
        deductStatus: z.enum(['success', 'processing', 'failed']),
        failReason: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  });

// ─── 扣款计划 ─────────────────────────────────────────────────────────────────

const listPlansRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/deduct-plans', tags: ['支付中心-签约代扣'], summary: '扣款计划列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:contract:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: z.enum(['enabled', 'disabled']).optional(),
      }),
    },
    responses: { ...okPaginated(PaymentDeductPlanDTO, '扣款计划列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listDeductPlans(c.req.valid('query'))), 200),
});

const allPlansRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/deduct-plans/all', tags: ['支付中心-签约代扣'], summary: '全量启用扣款计划（下拉）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:contract:list' })] as const,
    responses: { ...ok(z.array(PaymentDeductPlanDTO), '计划下拉'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await allDeductPlans()), 200),
});

const createPlanRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/deduct-plans', tags: ['支付中心-签约代扣'], summary: '创建扣款计划',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:contract:plan', audit: { description: '创建扣款计划', module: '支付中心' } })] as const,
    request: { body: { content: jsonContent(createPaymentDeductPlanSchema), required: true } },
    responses: { ...ok(PaymentDeductPlanDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createDeductPlan(c.req.valid('json')), '创建成功'), 200),
});

const updatePlanRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/deduct-plans/{id}', tags: ['支付中心-签约代扣'], summary: '更新扣款计划',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:contract:plan', audit: { description: '更新扣款计划', module: '支付中心' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updatePaymentDeductPlanSchema), required: true } },
    responses: { ...ok(PaymentDeductPlanDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDeductPlan(id));
    return c.json(okBody(await updateDeductPlan(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deletePlanRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/deduct-plans/{id}', tags: ['支付中心-签约代扣'], summary: '删除扣款计划（无协议引用时）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:contract:plan', audit: { description: '删除扣款计划', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDeductPlan(id));
    await deleteDeductPlan(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 签约协议 ─────────────────────────────────────────────────────────────────

const listContractsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/contracts', tags: ['支付中心-签约代扣'], summary: '签约协议列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:contract:list' })] as const,
    request: {
      query: PaginationQuery.extend({
        keyword: z.string().optional(),
        status: contractStatusEnum.optional(),
        channel: channelEnum.optional(),
        planId: z.coerce.number().int().positive().optional(),
        bizType: z.string().optional(),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      }),
    },
    responses: { ...okPaginated(PaymentContractDTO, '签约协议列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listContracts(c.req.valid('query'))), 200),
});

const contractDetailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/contracts/{id}', tags: ['支付中心-签约代扣'], summary: '签约协议详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:contract:list' })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentContractDTO, '协议详情'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getContract(c.req.valid('param').id)), 200),
});

const createContractRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/contracts', tags: ['支付中心-签约代扣'], summary: '创建签约协议（演示/测试，沙箱即时生效）',
    description: '管理端手工签约，可选签约后立即执行首期扣款；真实渠道需商户开通代扣产品权限。',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'payment:contract:manage', audit: { description: '创建签约协议', module: '支付中心' } }),
      idempotencyGuard({ ttlSeconds: 10 }),
    ] as const,
    request: { body: { content: jsonContent(createPaymentContractSchema), required: true } },
    responses: { ...ok(SignResultDTO, '签约完成'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await adminCreateContract(c.req.valid('json')), '签约完成'), 200),
});

const terminateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/contracts/{id}/terminate', tags: ['支付中心-签约代扣'], summary: '解约',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:contract:manage', audit: { description: '解约签约协议', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentContractDTO, '解约成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const row = await ensureContract(c.req.valid('param').id);
    setAuditBeforeData(c, row);
    return c.json(okBody(await terminateContract(row), '解约成功'), 200);
  },
});

const pauseRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/contracts/{id}/pause', tags: ['支付中心-签约代扣'], summary: '暂停扣款',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:contract:manage', audit: { description: '暂停签约协议', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentContractDTO, '已暂停'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await pauseContract(c.req.valid('param').id), '已暂停'), 200),
});

const resumeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/contracts/{id}/resume', tags: ['支付中心-签约代扣'], summary: '恢复扣款（重置失败计数并尽快补扣）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'payment:contract:manage', audit: { description: '恢复签约协议', module: '支付中心' } })] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentContractDTO, '已恢复'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await resumeContract(c.req.valid('param').id), '已恢复'), 200),
});

const deductNowRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/contracts/{id}/deduct', tags: ['支付中心-签约代扣'], summary: '手动补扣一期',
    description: '资金扣款接口，挂幂等防重复提交；并发下由活跃业务单唯一索引兜底。',
    security: [{ BearerAuth: [] }],
    middleware: [
      authMiddleware,
      guard({ permission: 'payment:contract:manage', audit: { description: '手动补扣', module: '支付中心' } }),
      idempotencyGuard({ ttlSeconds: 10 }),
    ] as const,
    request: { params: IdParam },
    responses: { ...ok(PaymentDeductResultDTO, '扣款执行完成'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await deductContractById(c.req.valid('param').id), '扣款执行完成'), 200),
});

router.openapiRoutes([
  listPlansRoute, allPlansRoute, createPlanRoute, updatePlanRoute, deletePlanRoute,
  listContractsRoute, contractDetailRoute, createContractRoute, terminateRoute, pauseRoute, resumeRoute, deductNowRoute,
] as const);

export default router;
