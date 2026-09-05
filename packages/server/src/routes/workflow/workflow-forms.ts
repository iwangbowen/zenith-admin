import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowFormContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { conflictResponse, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listWorkflowForms,
  listEnabledWorkflowForms,
  getWorkflowForm,
  createWorkflowForm,
  duplicateWorkflowForm,
  updateWorkflowForm,
  deleteWorkflowForm,
} from '../../services/workflow/workflow-forms.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'workflow:form:list' })] as const;

const listRoute = defineContractRoute(workflowFormContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listWorkflowForms(c.req.valid('query'))), 200),
});

const enabledRoute = defineContractRoute(workflowFormContract.enabled, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listEnabledWorkflowForms()), 200),
});

const getRoute = defineContractRoute(workflowFormContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getWorkflowForm(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(workflowFormContract.create, {
  middleware: [authMiddleware, guard({ permission: 'workflow:form:create', audit: { description: '创建表单', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await createWorkflowForm(c.req.valid('json')), '创建成功'), 200),
});

const duplicateRoute = defineContractRoute(workflowFormContract.duplicate, {
  middleware: [authMiddleware, guard({ permission: 'workflow:form:create', audit: { description: '复制表单', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await duplicateWorkflowForm(c.req.valid('param').id), '已复制为新表单'), 200),
});

const updateRoute = defineContractRoute(workflowFormContract.update, {
  middleware: [authMiddleware, guard({ permission: 'workflow:form:edit', audit: { description: '更新表单', module: '工作流管理' } })] as const,
  // 乐观锁：expectedRevision 与当前不一致时返回 409
  responses: conflictResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowForm(id).catch(() => null);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateWorkflowForm(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(workflowFormContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:form:delete', audit: { description: '删除表单', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowForm(id).catch(() => null);
    if (before) setAuditBeforeData(c, before);
    await deleteWorkflowForm(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, enabledRoute, getRoute, createRouteDef, duplicateRoute, updateRoute, deleteRoute] as const);

export default router;
