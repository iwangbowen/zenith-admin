import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../middleware/guard';
import { ErrorResponse, PaginationQuery, jsonContent, validationHook, commonErrorResponses, ok, okPaginated, okMsg, IdParam, BatchIdsBody, okBody } from '../lib/openapi-schemas';
import { WorkflowDefinitionDTO, WorkflowDefinitionVersionDTO, WorkflowDefinitionExportDTO, WorkflowVersionDiffDTO, WorkflowApproverPreviewNodeDTO, WorkflowSimulationResultDTO } from '../lib/openapi-dtos';
import { importWorkflowDefinitionSchema, previewWorkflowSchema, simulateWorkflowSchema, workflowCustomFormConfigSchema, workflowFormTypeSchema } from '@zenith/shared';
import {
  listDefinitions, listPublishedDefinitions, getDefinition, createDefinition,
  updateDefinition, publishDefinition, disableDefinition, enableDefinition, deleteDefinition, getWorkflowDefinitionBeforeAudit,
  getWorkflowDefinitionsBeforeAudit,
  batchDisableDefinitions, batchEnableDefinitions, batchDeleteDefinitions,
  listVersions, restoreVersion, duplicateDefinition, exportDefinition, importDefinition, diffVersions,
} from '../services/workflow-definitions.service';
import { previewFlow } from '../services/workflow-preview.service';
import { simulateWorkflow } from '../services/workflow-simulation.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const createWorkflowDefinitionSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(500).nullable().optional(),
  categoryId: z.number().int().nullable().optional(),
  initiatorScopeType: z.enum(['all', 'users', 'departments', 'roles']).default('all'),
  initiatorScopeIds: z.array(z.number().int()).nullable().optional(),
  flowData: z.looseObject({}).nullable().optional(),
  formId: z.number().int().nullable().optional(),
  formType: workflowFormTypeSchema.default('designer'),
  customForm: workflowCustomFormConfigSchema.nullable().optional(),
  status: z.enum(['draft', 'published', 'disabled']).default('draft'),
});
const updateWorkflowDefinitionSchema = createWorkflowDefinitionSchema.partial();

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['WorkflowDefinitions'], summary: '流程定义列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
    request: { query: PaginationQuery.extend({ keyword: z.string().optional(), status: z.string().optional(), categoryId: z.coerce.number().int().optional() }) },
    responses: { ...commonErrorResponses, ...okPaginated(WorkflowDefinitionDTO, 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listDefinitions(c.req.valid('query'))), 200),
});

const publishedRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/published', tags: ['WorkflowDefinitions'], summary: '已发布列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create' })] as const,
    responses: { ...commonErrorResponses, ...ok(z.array(WorkflowDefinitionDTO), 'ok') },
  }),
  handler: async (c) => c.json(okBody(await listPublishedDefinitions()), 200),
});

const detailRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}', tags: ['WorkflowDefinitions'], summary: '流程定义详情',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await getDefinition(c.req.valid('param').id)), 200),
});

const createRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['WorkflowDefinitions'], summary: '创建流程定义',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:create', audit: { description: '创建流程定义', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(createWorkflowDefinitionSchema), required: true } },
    responses: { ...commonErrorResponses, ...ok(WorkflowDefinitionDTO, '创建成功') },
  }),
  handler: async (c) => {
    const r = await createDefinition(c.req.valid('json'));
    return c.json(okBody(r, '创建成功'), 200);
  },
});

const updateRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['WorkflowDefinitions'], summary: '更新流程定义',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '更新流程定义', module: '工作流管理' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(updateWorkflowDefinitionSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionDTO, '更新成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await updateDefinition(id, c.req.valid('json'));
    return c.json(okBody(r, '更新成功'), 200);
  },
});

const publishRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/publish', tags: ['WorkflowDefinitions'], summary: '发布流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:publish', audit: { description: '发布流程定义', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionDTO, '发布成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await publishDefinition(id);
    return c.json(okBody(r, '发布成功'), 200);
  },
});

const disableRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/disable', tags: ['WorkflowDefinitions'], summary: '禁用流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:publish', audit: { description: '禁用流程定义', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await disableDefinition(id);
    return c.json(okBody(r, '禁用成功'), 200);
  },
});

const enableRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/enable', tags: ['WorkflowDefinitions'], summary: '启用流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:publish', audit: { description: '启用流程定义', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionDTO, '启用成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await enableDefinition(id);
    return c.json(okBody(r, '启用成功'), 200);
  },
});

const deleteRouteDef = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['WorkflowDefinitions'], summary: '删除流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:delete', audit: { description: '删除流程定义', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...okMsg('删除成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteDefinition(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchDisableRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/batch-disable', tags: ['WorkflowDefinitions'], summary: '批量禁用流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:publish', audit: { description: '批量禁用流程定义', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('禁用成功') },
  }),
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

const batchEnableRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/batch-enable', tags: ['WorkflowDefinitions'], summary: '批量启用流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:publish', audit: { description: '批量启用流程定义', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('启用成功') },
  }),
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

const batchDeleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/batch-delete', tags: ['WorkflowDefinitions'], summary: '批量删除流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:delete', audit: { description: '批量删除流程定义', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(BatchIdsBody), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getWorkflowDefinitionsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const { deleted, skipped } = await batchDeleteDefinitions(ids);
    const message = skipped > 0 ? `成功删除 ${deleted} 条，${skipped} 条已跳过（已发布或存在发起实例）` : `成功删除 ${deleted} 条`;
    return c.json(okBody(null, message), 200);
  },
});

const VersionParam = z.object({
  id: z.coerce.number().int().positive(),
  versionId: z.coerce.number().int().positive(),
});

const listVersionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/versions', tags: ['WorkflowDefinitions'], summary: '历史版本列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(WorkflowDefinitionVersionDTO), 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await listVersions(c.req.valid('param').id)), 200),
});

const restoreVersionRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/versions/{versionId}/restore', tags: ['WorkflowDefinitions'], summary: '恢复历史版本',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:edit', audit: { description: '恢复历史版本', module: '工作流管理' } })] as const,
    request: { params: VersionParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionDTO, '恢复成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const r = await restoreVersion(id, versionId);
    return c.json(okBody(r, '已恢复为草稿'), 200);
  },
});

const duplicateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/duplicate', tags: ['WorkflowDefinitions'], summary: '复制流程',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:create', audit: { description: '复制流程', module: '工作流管理' } })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionDTO, '复制成功'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await duplicateDefinition(c.req.valid('param').id), '已复制为新草稿'), 200),
});

const exportRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/export', tags: ['WorkflowDefinitions'], summary: '导出流程定义',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
    request: { params: IdParam },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionExportDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await exportDefinition(c.req.valid('param').id)), 200),
});

const importRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/import', tags: ['WorkflowDefinitions'], summary: '导入流程定义',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:create', audit: { description: '导入流程', module: '工作流管理' } })] as const,
    request: { body: { content: jsonContent(importWorkflowDefinitionSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowDefinitionDTO, '导入成功'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
    },
  }),
  handler: async (c) => c.json(okBody(await importDefinition(c.req.valid('json')), '已导入为新草稿'), 200),
});

const diffVersionsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/{id}/diff', tags: ['WorkflowDefinitions'], summary: '版本对比',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
    request: { params: IdParam, query: z.object({ left: z.coerce.number().int().nonnegative().default(0), right: z.coerce.number().int().nonnegative().default(0) }) },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowVersionDiffDTO, 'ok'),
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { left, right } = c.req.valid('query');
    return c.json(okBody(await diffVersions(id, left, right)), 200);
  },
});

const previewRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/{id}/preview', tags: ['WorkflowDefinitions'], summary: '提交前审批链路预览',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:instance:create' })] as const,
    request: { params: IdParam, body: { content: jsonContent(previewWorkflowSchema), required: false } },
    responses: {
      ...commonErrorResponses,
      ...ok(z.array(WorkflowApproverPreviewNodeDTO), 'ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await previewFlow(id, body?.formData ?? null)), 200);
  },
});

const simulateRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/simulate', tags: ['WorkflowDefinitions'], summary: '流程仿真',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'workflow:definition:list' })] as const,
    request: { body: { content: jsonContent(simulateWorkflowSchema), required: true } },
    responses: {
      ...commonErrorResponses,
      ...ok(WorkflowSimulationResultDTO, 'ok'),
      400: { content: jsonContent(ErrorResponse), description: '参数错误' },
      404: { content: jsonContent(ErrorResponse), description: '不存在' },
    },
  }),
  handler: async (c) => c.json(okBody(await simulateWorkflow(c.req.valid('json'))), 200),
});

router.openapiRoutes([listRoute, publishedRoute, importRoute, detailRoute, createRouteDef, updateRouteDef, publishRoute, disableRoute, enableRoute, deleteRouteDef, batchDisableRoute, batchEnableRoute, batchDeleteRoute, listVersionsRoute, restoreVersionRoute, duplicateRoute, exportRoute, diffVersionsRoute, previewRoute, simulateRoute] as const);

export default router;
