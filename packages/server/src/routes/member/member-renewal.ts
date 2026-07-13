/**
 * 会员自动续费路由（/api/member/renewal/*，memberAuthMiddleware 保护）。
 * 可选计划 / 我的续费状态 / 签约 / 解约 / 手动续费一期。
 */
import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { memberSignRenewalSchema } from '@zenith/shared';
import { memberAuthMiddleware } from '../../middleware/member-auth';
import { idempotencyGuard } from '../../middleware/idempotency';
import { jsonContent, validationHook, commonErrorResponses, ok, okMsg, okBody } from '../../lib/openapi-schemas';
import { MemberRenewalInfoDTO, MemberRenewalPlanDTO, PaymentContractDTO } from '../../lib/openapi-dtos';
import { currentMemberId } from '../../lib/member-context';
import {
  deductMyRenewalNow,
  getMyRenewal,
  listRenewalPlans,
  signRenewal,
  terminateMyRenewal,
} from '../../services/member/member-renewal.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const SignRenewalResultDTO = z.object({
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

const DeductNowResultDTO = z.object({
  orderNo: z.string().nullable().optional(),
  deductStatus: z.enum(['success', 'processing', 'failed']),
  failReason: z.string().nullable().optional(),
});

const plansRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/plans', tags: ['MemberSelf'], summary: '可选自动续费计划',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: { ...ok(z.array(MemberRenewalPlanDTO), '续费计划列表'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const plans = await listRenewalPlans();
    return c.json(okBody(plans.map((p) => ({ id: p.id, name: p.name, period: p.period, customDays: p.customDays ?? null, amount: p.amount, remark: p.remark ?? null }))), 200);
  },
});

const myRenewalRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['MemberSelf'], summary: '我的自动续费状态（VIP 到期/协议/续费记录）',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware] as const,
    responses: { ...ok(MemberRenewalInfoDTO, '自动续费状态'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await getMyRenewal(currentMemberId())), 200),
});

const signRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/sign', tags: ['MemberSelf'], summary: '开通自动续费（签约并首期扣款）',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 10 })] as const,
    request: { body: { content: jsonContent(memberSignRenewalSchema), required: true } },
    responses: { ...ok(SignRenewalResultDTO, '签约完成'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await signRenewal(currentMemberId(), c.req.valid('json')), '签约完成'), 200),
});

const terminateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/terminate', tags: ['MemberSelf'], summary: '关闭自动续费（解约）',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 10 })] as const,
    responses: { ...okMsg('已关闭自动续费'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    await terminateMyRenewal(currentMemberId());
    return c.json(okBody(null, '已关闭自动续费'), 200);
  },
});

const deductNowRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/deduct', tags: ['MemberSelf'], summary: '立即续费一期（手动扣款）',
    security: [{ BearerAuth: [] }],
    middleware: [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 10 })] as const,
    responses: { ...ok(DeductNowResultDTO, '扣款执行完成'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await deductMyRenewalNow(currentMemberId()), '扣款执行完成'), 200),
});

router.openapiRoutes([plansRoute, myRenewalRoute, signRoute, terminateRoute, deductNowRoute] as const);

export default router;
