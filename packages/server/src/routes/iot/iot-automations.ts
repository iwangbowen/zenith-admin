/**
 * IoT 场景联动
 *
 * CRUD + 执行记录查询；触发评估在设备接入热路径（见 iot-automations.service）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotAutomationContract } from '@zenith/shared/iot';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createIotAutomation, deleteIotAutomation, ensureIotAutomationExists,
  listIotAutomationRuns, listIotAutomations, mapIotAutomation, updateIotAutomation,
} from '../../services/iot/iot-automations.service';

export const iotAutomationsRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'iot:automation:list' })] as const;
const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

const listRoute = defineContractRoute(iotAutomationContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listIotAutomations(c.req.valid('query'))), 200),
});

const listRunsRoute = defineContractRoute(iotAutomationContract.runs, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listIotAutomationRuns(c.req.valid('query'))), 200),
});

const createAutomationRoute = defineContractRoute(iotAutomationContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'iot:automation:create',
    audit: { description: '创建 IoT 场景联动', module: 'IoT 场景联动' },
  })],
  handler: async (c) => c.json(okBody(await createIotAutomation(c.req.valid('json')), '创建成功'), 200),
});

const updateAutomationRoute = defineContractRoute(iotAutomationContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'iot:automation:update',
    audit: { description: '更新 IoT 场景联动', module: 'IoT 场景联动' },
  })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotAutomation(await ensureIotAutomationExists(id)));
    return c.json(okBody(await updateIotAutomation(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteAutomationRoute = defineContractRoute(iotAutomationContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'iot:automation:delete',
    audit: { description: '删除 IoT 场景联动', module: 'IoT 场景联动' },
  })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotAutomation(await ensureIotAutomationExists(id)));
    await deleteIotAutomation(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

iotAutomationsRouter.openapiRoutes([
  listRoute,
  listRunsRoute,
  createAutomationRoute,
  updateAutomationRoute,
  deleteAutomationRoute,
] as const);
