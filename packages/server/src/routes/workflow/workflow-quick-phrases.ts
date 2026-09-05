import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowQuickPhraseContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMyQuickPhrases, createMyQuickPhrase, updateMyQuickPhrase, deleteMyQuickPhrase,
  getQuickPhraseBeforeAudit,
} from '../../services/workflow/workflow-quick-phrases.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(workflowQuickPhraseContract.list, {
  middleware: [authMiddleware, guard({})] as const,
  handler: async (c) => c.json(okBody(await listMyQuickPhrases()), 200),
});

const createRouteDef = defineContractRoute(workflowQuickPhraseContract.create, {
  middleware: [authMiddleware, guard({ audit: { description: '新增审批常用语', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await createMyQuickPhrase(c.req.valid('json')), '已新增'), 200),
});

const updateRoute = defineContractRoute(workflowQuickPhraseContract.update, {
  middleware: [authMiddleware, guard({ audit: { description: '更新审批常用语', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getQuickPhraseBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateMyQuickPhrase(id, c.req.valid('json')), '已更新'), 200);
  },
});

const deleteRoute = defineContractRoute(workflowQuickPhraseContract.remove, {
  middleware: [authMiddleware, guard({ audit: { description: '删除审批常用语', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getQuickPhraseBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteMyQuickPhrase(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

router.openapiRoutes([listRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default router;
