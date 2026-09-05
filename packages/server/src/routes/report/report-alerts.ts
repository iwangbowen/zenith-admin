import { OpenAPIHono } from '@hono/zod-openapi';
import { reportAlertContract } from '@zenith/shared/report';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listAlerts, getAlert, createAlert, updateAlert, deleteAlert, ensureAlertExists, batchSetAlertEnabled,
} from '../../services/report/report-alert.service';
import { submitAlertEvaluateTask } from '../../services/report/report-delivery-tasks';

const router = new OpenAPIHono({ defaultHook: validationHook });

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

const listRoute = defineContractRoute(reportAlertContract.list, {
  middleware: [authMiddleware, guard({ permission: 'report:alert:list' })],
  handler: async (c) => c.json(okBody(await listAlerts(c.req.valid('query'))), 200),
});

const getOneRoute = defineContractRoute(reportAlertContract.detail, {
  middleware: [authMiddleware, guard({ permission: 'report:alert:list' })],
  responses: notFound,
  handler: async (c) => c.json(okBody(await getAlert(c.req.valid('param').id)), 200),
});

const createRoute_ = defineContractRoute(reportAlertContract.create, {
  middleware: [authMiddleware, guard({ permission: 'report:alert:create', audit: { description: '创建报表预警', module: '报表预警' } })],
  handler: async (c) => c.json(okBody(await createAlert(c.req.valid('json')), '创建成功'), 200),
});

const updateRoute_ = defineContractRoute(reportAlertContract.update, {
  middleware: [authMiddleware, guard({ permission: 'report:alert:update', audit: { description: '更新报表预警', module: '报表预警' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureAlertExists(id);
    setAuditBeforeData(c, before);
    return c.json(okBody(await updateAlert(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRoute_ = defineContractRoute(reportAlertContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'report:alert:delete', audit: { description: '删除报表预警', module: '报表预警' } })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureAlertExists(id);
    setAuditBeforeData(c, before);
    await deleteAlert(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const batchStatusRoute = defineContractRoute(reportAlertContract.batchStatus, {
  middleware: [authMiddleware, guard({ permission: 'report:alert:update', audit: { description: '批量更新报表预警状态', module: '报表预警' } })],
  handler: async (c) => {
    const { ids, enabled } = c.req.valid('json');
    const count = await batchSetAlertEnabled(ids, enabled);
    return c.json(okBody(null, `已更新 ${count} 条预警状态`), 200);
  },
});

const evalRoute = defineContractRoute(reportAlertContract.evaluate, {
  middleware: [authMiddleware, guard({ permission: 'report:alert:list' })],
  responses: notFound,
  handler: async (c) => c.json(okBody(await submitAlertEvaluateTask(c.req.valid('param').id), '任务已提交，可在任务中心查看进度'), 200),
});

router.openapiRoutes([listRoute, batchStatusRoute, getOneRoute, createRoute_, updateRoute_, deleteRoute_, evalRoute] as const);

export default router;
