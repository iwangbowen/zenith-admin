import { OpenAPIHono } from '@hono/zod-openapi';
import { retentionPolicyContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listPolicies,
  previewPolicyPending,
  runPolicyNow,
  updatePolicy,
} from '../../services/ops/retention.service';

const retentionRouter = new OpenAPIHono({ defaultHook: validationHook });

const VIEW_PERM = 'system:retention:view';
const EDIT_PERM = 'system:retention:edit';
const RUN_PERM = 'system:retention:run';

const listRoute = defineContractRoute(retentionPolicyContract.list, {
  middleware: [authMiddleware, guard({ permission: VIEW_PERM })],
  handler: async (c) => c.json(okBody(await listPolicies()), 200),
});

const updateRoute = defineContractRoute(retentionPolicyContract.update, {
  middleware: [authMiddleware, guard({
    permission: EDIT_PERM,
    audit: { description: '更新数据保留策略', module: '数据保留' },
  })],
  handler: async (c) => {
    const { key } = c.req.valid('param');
    const list = await listPolicies();
    setAuditBeforeData(c, list.find((item) => item.key === key));
    const updated = await updatePolicy(key, c.req.valid('json'));
    setAuditAfterData(c, updated);
    return c.json(okBody(updated), 200);
  },
});

const previewRoute = defineContractRoute(retentionPolicyContract.preview, {
  middleware: [authMiddleware, guard({ permission: VIEW_PERM })],
  handler: async (c) => c.json(okBody(await previewPolicyPending(c.req.valid('param').key)), 200),
});

const runRoute = defineContractRoute(retentionPolicyContract.run, {
  middleware: [authMiddleware, guard({
    permission: RUN_PERM,
    audit: { description: '手动执行数据保留策略', module: '数据保留' },
  })],
  handler: async (c) => {
    const { key } = c.req.valid('param');
    setAuditBeforeData(c, await previewPolicyPending(key));
    const deleted = await runPolicyNow(key);
    setAuditAfterData(c, { key, deleted });
    return c.json(okBody({ key, deleted }, `已清理 ${deleted} 行`), 200);
  },
});

retentionRouter.openapiRoutes([listRoute, updateRoute, previewRoute, runRoute] as const);

export default retentionRouter;
