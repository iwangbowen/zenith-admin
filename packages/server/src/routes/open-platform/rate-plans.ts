import { OpenAPIHono } from '@hono/zod-openapi';
import { ratePlanContract } from '@zenith/shared/open-platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  listRatePlans,
  listEnabledRatePlans,
  getRatePlan,
  getRatePlanBeforeAudit,
  createRatePlan,
  updateRatePlan,
  deleteRatePlan,
} from '../../services/open-platform/rate-plans.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const MODULE = '开放平台-限流套餐';
const read = [authMiddleware, guard({ permission: 'open:rate-plan:view' })] as const;

const list = defineContractRoute(ratePlanContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listRatePlans(c.req.valid('query'))), 200),
});

const options = defineContractRoute(ratePlanContract.options, {
  middleware: [authMiddleware],
  handler: async (c) => c.json(okBody(await listEnabledRatePlans()), 200),
});

const detail = defineContractRoute(ratePlanContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getRatePlan(c.req.valid('param').id)), 200),
});

const create = defineContractRoute(ratePlanContract.create, {
  middleware: [authMiddleware, guard({ permission: 'open:rate-plan:manage', audit: { description: '创建限流套餐', module: MODULE } })],
  handler: async (c) => c.json(okBody(await createRatePlan(c.req.valid('json')), '创建成功'), 200),
});

const update = defineContractRoute(ratePlanContract.update, {
  middleware: [authMiddleware, guard({ permission: 'open:rate-plan:manage', audit: { description: '更新限流套餐', module: MODULE } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getRatePlanBeforeAudit(id));
    return c.json(okBody(await updateRatePlan(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineContractRoute(ratePlanContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'open:rate-plan:manage', audit: { description: '删除限流套餐', module: MODULE } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getRatePlanBeforeAudit(id));
    await deleteRatePlan(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([list, options, detail, create, update, remove] as const);

export default router;
