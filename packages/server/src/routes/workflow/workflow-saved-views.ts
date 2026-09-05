import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowSavedViewContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listSavedViews, createSavedView, updateSavedView, deleteSavedView, getSavedViewBeforeAudit } from '../../services/workflow/workflow-saved-views.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(workflowSavedViewContract.list, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const,
  handler: async (c) => c.json(okBody(await listSavedViews(c.req.valid('query').pageKey)), 200),
});

const createRouteDef = defineContractRoute(workflowSavedViewContract.create, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:list', audit: { description: '保存工作流视图', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await createSavedView(c.req.valid('json')), '已保存'), 200),
});

const updateRouteDef = defineContractRoute(workflowSavedViewContract.update, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:list', audit: { description: '更新工作流视图', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSavedViewBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateSavedView(id, c.req.valid('json')), '已更新'), 200);
  },
});

const deleteRouteDef = defineContractRoute(workflowSavedViewContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:list', audit: { description: '删除工作流视图', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getSavedViewBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteSavedView(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

router.openapiRoutes([listRoute, createRouteDef, updateRouteDef, deleteRouteDef] as const);

export default router;
