import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowDataSourceContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listDataSources, getDataSource, createDataSource, updateDataSource,
  deleteDataSource, ensureDataSourceExists, fetchDataSourceOptions, fetchDataSourceRecord,
} from '../../services/workflow/workflow-data-source.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'workflow:datasource:list' })] as const;

const listRoute = defineContractRoute(workflowDataSourceContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listDataSources(c.req.valid('query'))), 200),
});

// 代理拉取选项（运行时填表用，仅需登录态）
const optionsRoute = defineContractRoute(workflowDataSourceContract.options, {
  middleware: [authMiddleware] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { keyword } = c.req.valid('query');
    return c.json(okBody(await fetchDataSourceOptions(id, keyword)), 200);
  },
});

// 按选项值取完整记录（联动赋值回填用，仅需登录态）
const recordRoute = defineContractRoute(workflowDataSourceContract.record, {
  middleware: [authMiddleware] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { value } = c.req.valid('query');
    return c.json(okBody(await fetchDataSourceRecord(id, value)), 200);
  },
});

const getOneRoute = defineContractRoute(workflowDataSourceContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getDataSource(c.req.valid('param').id)), 200),
});

const createRoute_ = defineContractRoute(workflowDataSourceContract.create, {
  middleware: [authMiddleware, guard({ permission: 'workflow:datasource:create', audit: { description: '创建远程数据源', module: '远程数据源' } })] as const,
  handler: async (c) => c.json(okBody(await createDataSource(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(workflowDataSourceContract.update, {
  middleware: [authMiddleware, guard({ permission: 'workflow:datasource:update', audit: { description: '更新远程数据源', module: '远程数据源' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDataSourceExists(id));
    return c.json(okBody(await updateDataSource(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineContractRoute(workflowDataSourceContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:datasource:delete', audit: { description: '删除远程数据源', module: '远程数据源' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await ensureDataSourceExists(id));
    await deleteDataSource(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, optionsRoute, recordRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_] as const);

export default router;
