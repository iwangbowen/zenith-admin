import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowDefinitionContract } from '@zenith/shared/workflow';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listDefinitions,
  listDefinitionOptions,
  listPublishedDefinitions,
  getDefinition,
  createDefinition,
  updateDefinition,
  publishDefinition,
  disableDefinition,
  enableDefinition,
  deleteDefinition,
  getWorkflowDefinitionBeforeAudit,
  getWorkflowDefinitionsBeforeAudit,
  batchDisableDefinitions,
  batchEnableDefinitions,
  batchDeleteDefinitions,
  listVersions,
  restoreVersion,
  duplicateDefinition,
  exportDefinition,
  importDefinition,
  diffVersions,
} from '../../services/workflow/workflow-definitions.service';
import { previewFlow } from '../../services/workflow/workflow-preview.service';
import { simulateWorkflow, checkDefinitionHealth } from '../../services/workflow/workflow-simulation.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const optionsRoute = defineContractRoute(workflowDefinitionContract.all, {
  handler: async (c) => c.json(okBody(await listDefinitionOptions()), 200),
});

const publishedRoute = defineContractRoute(workflowDefinitionContract.published, {
  handler: async (c) => c.json(okBody(await listPublishedDefinitions()), 200),
});
const publishRoute = defineContractRoute(workflowDefinitionContract.publish, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await publishDefinition(id), '发布成功'), 200);
  },
});

const disableRoute = defineContractRoute(workflowDefinitionContract.disable, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await disableDefinition(id), '禁用成功'), 200);
  },
});

const enableRoute = defineContractRoute(workflowDefinitionContract.enable, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await enableDefinition(id), '启用成功'), 200);
  },
});
const batchDisableRoute = defineContractRoute(workflowDefinitionContract.batchDisable, {
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
  handler: async (c) => c.json(okBody(await listVersions(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const restoreVersionRoute = defineContractRoute(workflowDefinitionContract.restoreVersion, {
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    const before = await getWorkflowDefinitionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await restoreVersion(id, versionId), '已恢复为草稿'), 200);
  },
});

const duplicateRoute = defineContractRoute(workflowDefinitionContract.duplicate, {
  handler: async (c) => c.json(okBody(await duplicateDefinition(c.req.valid('param').id), '已复制为新草稿'), 200),
});

const exportRoute = defineContractRoute(workflowDefinitionContract.export, {
  handler: async (c) => c.json(okBody(await exportDefinition(c.req.valid('param').id)), 200),
});

const importRoute = defineContractRoute(workflowDefinitionContract.import, {
  handler: async (c) => c.json(okBody(await importDefinition(c.req.valid('json')), '已导入为新草稿'), 200),
});

const diffVersionsRoute = defineContractRoute(workflowDefinitionContract.diff, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { left, right } = c.req.valid('query');
    return c.json(okBody(await diffVersions(id, left, right)), 200);
  },
});

const previewRoute = defineContractRoute(workflowDefinitionContract.preview, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await previewFlow(id, body.formData ?? null)), 200);
  },
});

const simulateRoute = defineContractRoute(workflowDefinitionContract.simulate, {
  handler: async (c) => c.json(okBody(await simulateWorkflow(c.req.valid('json'))), 200),
});

const healthCheckRoute = defineContractRoute(workflowDefinitionContract.healthCheck, {
  handler: async (c) => c.json(okBody(await checkDefinitionHealth(c.req.valid('json'))), 200),
});

mountCrud(router, workflowDefinitionContract,
  {
    list: listDefinitions,
    get: getDefinition,
    create: createDefinition,
    update: updateDefinition,
    remove: deleteDefinition,
  },
  {},
  [
    optionsRoute,
    publishedRoute,
    importRoute,
    publishRoute,
    disableRoute,
    enableRoute,
    batchDisableRoute,
    batchEnableRoute,
    batchDeleteRoute,
    listVersionsRoute,
    restoreVersionRoute,
    duplicateRoute,
    exportRoute,
    diffVersionsRoute,
    previewRoute,
    simulateRoute,
    healthCheckRoute,
  ],
);

export default router;
