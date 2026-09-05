/**
 * 会员自动续费路由（/api/member/renewal/*，memberAuthMiddleware 保护）。
 * 可选计划 / 我的续费状态 / 签约 / 解约 / 手动续费一期。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { memberRenewalContract } from '@zenith/shared/member';
import { memberAuthMiddleware } from '../../middleware/member-auth';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { currentMemberId } from '../../lib/member-context';
import {
  deductMyRenewalNow,
  getMyRenewal,
  listRenewalPlans,
  signRenewal,
  terminateMyRenewal,
} from '../../services/member/member-renewal.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const member = [memberAuthMiddleware] as const;
const memberIdempotent = [memberAuthMiddleware, idempotencyGuard({ ttlSeconds: 10 })] as const;

const plansRoute = defineContractRoute(memberRenewalContract.plans, {
  middleware: member,
  handler: async (c) => {
    const plans = await listRenewalPlans(c.req.valid('query').applicationId, currentMemberId());
    return c.json(okBody(plans.map((p) => ({ id: p.id, name: p.name, period: p.period, customDays: p.customDays ?? null, amount: p.amount, remark: p.remark ?? null }))), 200);
  },
});

const myRenewalRoute = defineContractRoute(memberRenewalContract.info, {
  middleware: member,
  handler: async (c) => c.json(okBody(await getMyRenewal(currentMemberId(), c.req.valid('query').applicationId)), 200),
});

const signRoute = defineContractRoute(memberRenewalContract.sign, {
  middleware: memberIdempotent,
  handler: async (c) => c.json(okBody(await signRenewal(currentMemberId(), c.req.valid('json')), '签约完成'), 200),
});

const terminateRoute = defineContractRoute(memberRenewalContract.terminate, {
  middleware: memberIdempotent,
  handler: async (c) => {
    await terminateMyRenewal(currentMemberId(), c.req.valid('query').applicationId);
    return c.json(okBody(null, '已关闭自动续费'), 200);
  },
});

const deductNowRoute = defineContractRoute(memberRenewalContract.deduct, {
  middleware: memberIdempotent,
  handler: async (c) => c.json(okBody(await deductMyRenewalNow(currentMemberId(), c.req.valid('query').applicationId), '扣款执行完成'), 200),
});

router.openapiRoutes([plansRoute, myRenewalRoute, signRoute, terminateRoute, deductNowRoute] as const);

export default router;
