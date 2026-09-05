import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowCategoryContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listWorkflowCategories,
  listAllWorkflowCategories,
  getWorkflowCategory,
  createWorkflowCategory,
  updateWorkflowCategory,
  deleteWorkflowCategory,
  getWorkflowCategoryBeforeAudit,
} from '../../services/workflow/workflow-categories.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const;

const listRoute = defineContractRoute(workflowCategoryContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listWorkflowCategories(c.req.valid('query'))), 200),
});

const allRoute = defineContractRoute(workflowCategoryContract.all, {
  // 发起工作台分组/待办筛选也要读取分类，放行发起与审批权限，避免非管理角色每次 ['workflow'] 缓存广播后 403 toast
  middleware: [authMiddleware, guard({ permission: ['workflow:definition:list', 'workflow:instance:create', 'workflow:task:handle'] })] as const,
  handler: async (c) => c.json(okBody(await listAllWorkflowCategories()), 200),
});

const getRoute = defineContractRoute(workflowCategoryContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getWorkflowCategory(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(workflowCategoryContract.create, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '创建流程分类', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await createWorkflowCategory(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute = defineContractRoute(workflowCategoryContract.update, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '更新流程分类', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowCategoryBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateWorkflowCategory(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute = defineContractRoute(workflowCategoryContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '删除流程分类', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowCategoryBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteWorkflowCategory(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, allRoute, getRoute, createRouteDef, updateRoute, deleteRoute] as const);

export default router;
