import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowTemplateContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listWorkflowTemplates, createWorkflowTemplate, updateWorkflowTemplate, deleteWorkflowTemplate,
  cloneTemplateToDefinition, saveAsTemplate, getWorkflowTemplateBeforeAudit,
} from '../../services/workflow/workflow-templates.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(workflowTemplateContract.list, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
  handler: async (c) => c.json(okBody(await listWorkflowTemplates()), 200),
});

const createRouteDef = defineContractRoute(workflowTemplateContract.create, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '新增流程模板', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await createWorkflowTemplate(c.req.valid('json')), '已新增'), 200),
});

const saveAsRoute = defineContractRoute(workflowTemplateContract.saveAs, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '流程另存为模板', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await saveAsTemplate(c.req.valid('json')), '已保存为模板'), 200),
});

const cloneRoute = defineContractRoute(workflowTemplateContract.clone, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:create', audit: { description: '从模板创建流程', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await cloneTemplateToDefinition(c.req.valid('param').id, c.req.valid('json')), '已创建'), 200),
});

const updateRoute = defineContractRoute(workflowTemplateContract.update, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '更新流程模板', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowTemplateBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateWorkflowTemplate(id, c.req.valid('json')), '已更新'), 200);
  },
});

const deleteRoute = defineContractRoute(workflowTemplateContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '删除流程模板', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowTemplateBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteWorkflowTemplate(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

router.openapiRoutes([listRoute, createRouteDef, saveAsRoute, cloneRoute, updateRoute, deleteRoute] as const);

export default router;
