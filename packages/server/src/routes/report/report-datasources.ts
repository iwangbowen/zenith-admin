import { OpenAPIHono } from '@hono/zod-openapi';
import { reportDatasourceContract } from '@zenith/shared/report';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listDatasources, getDatasource, createDatasource, updateDatasource,
  deleteDatasource, ensureDatasourceExists, testDatasource,
  batchSetDatasourceStatus, cloneDatasource, listDatasourceLookup,
} from '../../services/report/report-datasource.service';
import { submitDatasourceHealthCheckTask } from '../../services/report/report-datasource-tasks';

const router = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

const listRoute = defineContractRoute(reportDatasourceContract.list, {
  middleware: [authMiddleware, guard({ permission: 'report:datasource:list' })],
  handler: async (c) => c.json(okBody(await listDatasources(c.req.valid('query'))), 200),
});

const lookupRoute = defineContractRoute(reportDatasourceContract.lookup, {
  middleware: [authMiddleware, guard({ permission: 'report:datasource:list' })],
  handler: async (c) => c.json(okBody(await listDatasourceLookup(c.req.valid('query'))), 200),
});

const getOneRoute = defineContractRoute(reportDatasourceContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'report:datasource:list' })],
  responses: notFound,
  handler: async (c) => c.json(okBody(await getDatasource(c.req.valid('param').id)), 200),
});

const createRoute_ = defineContractRoute(reportDatasourceContract.create, {
  middleware: [authMiddleware, guard({ permission: 'report:datasource:create', audit: { description: '创建报表数据源', module: '报表数据源' } })],
  handler: async (c) => c.json(okBody(await createDatasource(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(reportDatasourceContract.update, {
  middleware: [authMiddleware, guard({ permission: 'report:datasource:update', audit: { description: '更新报表数据源', module: '报表数据源' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDatasourceExists(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(await updateDatasource(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineContractRoute(reportDatasourceContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'report:datasource:delete', audit: { description: '删除报表数据源', module: '报表数据源' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDatasourceExists(id);
    setAuditBeforeData(c, before);
    await deleteDatasource(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchStatusRoute = defineContractRoute(reportDatasourceContract.batchStatus, {
  middleware: [authMiddleware, guard({ permission: 'report:datasource:update', audit: { description: '批量更新报表数据源状态', module: '报表数据源' } })],
  handler: async (c) => {
    const { ids, status } = c.req.valid('json');
    const count = await batchSetDatasourceStatus(ids, status);
    return c.json(okBody(null, `已更新 ${count} 个数据源状态`), 200);
  },
});

const testRoute = defineContractRoute(reportDatasourceContract.test, {
  middleware: [authMiddleware, guard({ permission: 'report:datasource:create' })],
  handler: async (c) => c.json(okBody(await testDatasource(c.req.valid('json'))), 200),
});

const testOneRoute = defineContractRoute(reportDatasourceContract.testOne, {
  middleware: [authMiddleware, guard({ permission: 'report:datasource:update', audit: { description: '测试报表数据源连接', module: '报表数据源' } })],
  handler: async (c) => c.json(okBody(await testDatasource({ id: c.req.valid('param').id })), 200),
});

const cloneRoute = defineContractRoute(reportDatasourceContract.clone, {
  middleware: [authMiddleware, guard({ permission: 'report:datasource:create', audit: { description: '复制报表数据源', module: '报表数据源' } })],
  handler: async (c) => c.json(okBody(await cloneDatasource(c.req.valid('param').id, c.req.valid('json')), '复制成功'), 200),
});

const healthCheckRoute = defineContractRoute(reportDatasourceContract.healthCheck, {
  middleware: [authMiddleware, guard({ permission: 'report:datasource:update', audit: { description: '批量检测报表数据源健康状态', module: '报表数据源' } })],
  handler: async (c) => c.json(okBody(await submitDatasourceHealthCheckTask(c.req.valid('json').ids), '任务已提交，可在任务中心查看进度'), 200),
});

router.openapiRoutes([listRoute, lookupRoute, batchStatusRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_, testRoute, testOneRoute, cloneRoute, healthCheckRoute] as const);

export default router;