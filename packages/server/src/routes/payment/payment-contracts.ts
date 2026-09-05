/**
 * 签约代扣管理路由：签约协议 + 扣款计划。
 * 扣款计划 CRUD、签约协议列表/详情、创建签约（演示）、解约/暂停/恢复、手动补扣。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentDeductPlanContract, paymentSigningContract } from '@zenith/shared/payment';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  adminCreateContract,
  createDeductPlan,
  deductContractById,
  deleteDeductPlan,
  ensureWritableContract,
  ensureDeductPlan,
  getContract,
  allDeductPlans,
  listContracts,
  listDeductPlans,
  pauseContract,
  recoverContract,
  resumeContract,
  terminateContract,
  updateDeductPlan,
} from '../../services/payment/payment-contract.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

// ─── 扣款计划 ─────────────────────────────────────────────────────────────────

const listPlansRoute = defineContractRoute(paymentDeductPlanContract.deductPlans, {
  middleware: [authMiddleware, guard({ permission: 'payment:contract:list' })],
  handler: async (c) => c.json(okBody(await listDeductPlans(c.req.valid('query'))), 200),
});

const allPlansRoute = defineContractRoute(paymentDeductPlanContract.deductPlansAll, {
  middleware: [authMiddleware, guard({ permission: 'payment:contract:list' })],
  handler: async (c) => c.json(okBody(await allDeductPlans()), 200),
});

const createPlanRoute = defineContractRoute(paymentDeductPlanContract.createDeductPlan, {
  middleware: [authMiddleware, guard({ permission: 'payment:contract:plan', audit: { description: '创建扣款计划', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await createDeductPlan(c.req.valid('json')), '创建成功'), 200),
});

const updatePlanRoute = defineContractRoute(paymentDeductPlanContract.updateDeductPlan, {
  middleware: [authMiddleware, guard({ permission: 'payment:contract:plan', audit: { description: '更新扣款计划', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDeductPlan(id));
    return c.json(okBody(await updateDeductPlan(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deletePlanRoute = defineContractRoute(paymentDeductPlanContract.removeDeductPlan, {
  middleware: [authMiddleware, guard({ permission: 'payment:contract:plan', audit: { description: '删除扣款计划', module: '支付中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDeductPlan(id));
    await deleteDeductPlan(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 签约协议 ─────────────────────────────────────────────────────────────────

const listContractsRoute = defineContractRoute(paymentSigningContract.contracts, {
  middleware: [authMiddleware, guard({ permission: 'payment:contract:list' })],
  handler: async (c) => c.json(okBody(await listContracts(c.req.valid('query'))), 200),
});

const contractDetailRoute = defineContractRoute(paymentSigningContract.contractDetail, {
  middleware: [authMiddleware, guard({ permission: 'payment:contract:list' })],
  handler: async (c) => c.json(okBody(await getContract(c.req.valid('param').id, c.req.valid('query').applicationId)), 200),
});

const createContractRoute = defineContractRoute(paymentSigningContract.createContract, {
  middleware: [
    authMiddleware,
    guard({ permission: 'payment:contract:manage', audit: { description: '创建签约协议', module: '支付中心' } }),
    idempotencyGuard({ ttlSeconds: 10 }),
  ],
  handler: async (c) => c.json(okBody(await adminCreateContract(c.req.valid('json')), '签约完成'), 200),
});

const terminateRoute = defineContractRoute(paymentSigningContract.terminateContract, {
  middleware: [authMiddleware, guard({ permission: 'payment:contract:manage', audit: { description: '解约签约协议', module: '支付中心' } })],
  handler: async (c) => {
    const row = await ensureWritableContract(c.req.valid('param').id, c.req.valid('query').applicationId);
    setAuditBeforeData(c, row);
    return c.json(okBody(await terminateContract(row), '解约成功'), 200);
  },
});

const pauseRoute = defineContractRoute(paymentSigningContract.pauseContract, {
  middleware: [authMiddleware, guard({ permission: 'payment:contract:manage', audit: { description: '暂停签约协议', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await pauseContract(c.req.valid('param').id, c.req.valid('query').applicationId), '已暂停'), 200),
});

const resumeRoute = defineContractRoute(paymentSigningContract.resumeContract, {
  middleware: [authMiddleware, guard({ permission: 'payment:contract:manage', audit: { description: '恢复签约协议', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await resumeContract(c.req.valid('param').id, c.req.valid('query').applicationId), '已恢复'), 200),
});

const deductNowRoute = defineContractRoute(paymentSigningContract.deductContract, {
  middleware: [
    authMiddleware,
    guard({ permission: 'payment:contract:manage', audit: { description: '手动补扣', module: '支付中心' } }),
    idempotencyGuard({ ttlSeconds: 10 }),
  ],
  handler: async (c) => c.json(okBody(await deductContractById(c.req.valid('param').id, c.req.valid('query').applicationId), '扣款执行完成'), 200),
});

const recoverContractRoute = defineContractRoute(paymentSigningContract.recoverContract, {
  middleware: [authMiddleware, guard({ permission: 'payment:contract:manage', audit: { description: '查询恢复签约协议', module: '支付中心' } })],
  handler: async (c) => c.json(okBody(await recoverContract(c.req.valid('param').id, c.req.valid('query').applicationId), '查询完成'), 200),
});

router.openapiRoutes([
  listPlansRoute, allPlansRoute, createPlanRoute, updatePlanRoute, deletePlanRoute,
  listContractsRoute, contractDetailRoute, createContractRoute, terminateRoute, pauseRoute, resumeRoute, deductNowRoute, recoverContractRoute,
] as const);

export default router;
