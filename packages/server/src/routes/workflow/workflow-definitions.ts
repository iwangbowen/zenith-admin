import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowDefinitionContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listDefinitions, listPublishedDefinitions, getDefinition, createDefinition,
  updateDefinition, publishDefinition, disableDefinition, enableDefinition, deleteDefinition, getWorkflowDefinitionBeforeAudit,
  getWorkflowDefinitionsBeforeAudit,
  batchDisableDefinitions, batchEnableDefinitions, batchDeleteDefinitions,
  listVersions, restoreVersion, duplicateDefinition, exportDefinition, importDefinition, diffVersions,
} from '../../services/workflow/workflow-definitions.service';
import { previewFlow } from '../../services/workflow/workflow-preview.service';
import { simulateWorkflow, checkDefinitionHealth } from '../../services/workflow/workflow-simulation.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const;

const listRoute = defineContractRoute(workflowDefinitionContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listDefinitions(c.req.valid('query'))), 200),
});

const publishedRoute = defineContractRoute(workflowDefinitionContract.published, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:create' })] as const,
  handler: async (c) => c.json(okBody(await listPublishedDefinitions()), 200),
});

const detailRoute = defineContractRoute(workflowDefinitionContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getDefinition(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(workflowDefinitionContract.create, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:create', audit: { description: '创建流程定义', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await createDefinition(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(workflowDefinitionContract.update, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '更新流程定义', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateDefinition(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const publishRoute = defineContractRoute(workflowDefinitionContract.publish, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:publish', audit: { description: '发布流程定义', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await publishDefinition(id), '发布成功'), 200);
  },
});

const disableRoute = defineContractRoute(workflowDefinitionContract.disable, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:publish', audit: { description: '禁用流程定义', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await disableDefinition(id), '禁用成功'), 200);
  },
});

const enableRoute = defineContractRoute(workflowDefinitionContract.enable, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:publish', audit: { description: '启用流程定义', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await enableDefinition(id), '启用成功'), 200);
  },
});

const deleteRouteDef = defineContractRoute(workflowDefinitionContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:delete', audit: { description: '删除流程定义', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteDefinition(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchDisableRoute = defineContractRoute(workflowDefinitionContract.batchDisable, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:publish', audit: { description: '批量禁用流程定义', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getWorkflowDefinitionsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const { updated, skipped } = await batchDisableDefinitions(ids);
    const after = await getWorkflowDefinitionsBeforeAudit(ids);
    if (after.length > 0) setAuditAfterData(c, after);
    const message = skipped > 0 ? `成功禁用 ${updated} 条，${skipped} 条已跳过（非已发布状态）` : `成功禁用 ${updated} 条`;
    return c.json(okBody(null, message), 200);
  },
});

const batchEnableRoute = defineContractRoute(workflowDefinitionContract.batchEnable, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:publish', audit: { description: '批量启用流程定义', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getWorkflowDefinitionsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const { updated, skipped } = await batchEnableDefinitions(ids);
    const after = await getWorkflowDefinitionsBeforeAudit(ids);
    if (after.length > 0) setAuditAfterData(c, after);
    const message = skipped > 0 ? `成功启用 ${updated} 条，${skipped} 条已跳过（非已禁用状态）` : `成功启用 ${updated} 条`;
    return c.json(okBody(null, message), 200);
  },
});

const batchDeleteRoute = defineContractRoute(workflowDefinitionContract.batchDelete, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:delete', audit: { description: '批量删除流程定义', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getWorkflowDefinitionsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const { deleted, skipped } = await batchDeleteDefinitions(ids);
    const message = skipped > 0 ? `成功删除 ${deleted} 条，${skipped} 条已跳过（已发布或存在发起实例）` : `成功删除 ${deleted} 条`;
    return c.json(okBody(null, message), 200);
  },
});

const listVersionsRoute = defineContractRoute(workflowDefinitionContract.versions, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listVersions(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const restoreVersionRoute = defineContractRoute(workflowDefinitionContract.restoreVersion, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '恢复历史版本', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await restoreVersion(id, versionId), '已恢复为草稿'), 200);
  },
});

const duplicateRoute = defineContractRoute(workflowDefinitionContract.duplicate, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:create', audit: { description: '复制流程', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await duplicateDefinition(c.req.valid('param').id), '已复制为新草稿'), 200),
});

const exportRoute = defineContractRoute(workflowDefinitionContract.export, {
  middleware: read,
  handler: async (c) => c.json(okBody(await exportDefinition(c.req.valid('param').id)), 200),
});

const importRoute = defineContractRoute(workflowDefinitionContract.import, {
  middleware: [authMiddleware, guard({ permission: 'workflow:definition:create', audit: { description: '导入流程', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await importDefinition(c.req.valid('json')), '已导入为新草稿'), 200),
});

const diffVersionsRoute = defineContractRoute(workflowDefinitionContract.diff, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { left, right } = c.req.valid('query');
    return c.json(okBody(await diffVersions(id, left, right)), 200);
  },
});

const previewRoute = defineContractRoute(workflowDefinitionContract.preview, {
  middleware: [authMiddleware, guard({ permission: 'workflow:instance:create' })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await previewFlow(id, body.formData ?? null)), 200);
  },
});

const simulateRoute = defineContractRoute(workflowDefinitionContract.simulate, {
  middleware: read,
  handler: async (c) => c.json(okBody(await simulateWorkflow(c.req.valid('json'))), 200),
});

const healthCheckRoute = defineContractRoute(workflowDefinitionContract.healthCheck, {
  middleware: read,
  handler: async (c) => c.json(okBody(await checkDefinitionHealth(c.req.valid('json'))), 200),
});

router.openapiRoutes([listRoute, publishedRoute, importRoute, detailRoute, createRouteDef, updateRouteDef, publishRoute, disableRoute, enableRoute, deleteRouteDef, batchDisableRoute, batchEnableRoute, batchDeleteRoute, listVersionsRoute, restoreVersionRoute, duplicateRoute, exportRoute, diffVersionsRoute, previewRoute, simulateRoute, healthCheckRoute] as const);

export default router;
