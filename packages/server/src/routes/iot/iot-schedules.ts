/**
 * IoT 设备计划任务
 *
 * CRUD + 执行记录；到期调度由系统任务 iot-schedule-dispatch 每分钟执行。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotScheduleContract } from '@zenith/shared/iot';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createIotSchedule, deleteIotSchedule, ensureIotScheduleExists,
  listIotScheduleRuns, listIotSchedules, mapIotSchedule, updateIotSchedule,
} from '../../services/iot/iot-schedules.service';

export const iotSchedulesRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'iot:schedule:list' })] as const;
const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

const listRoute = defineContractRoute(iotScheduleContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listIotSchedules(c.req.valid('query'))), 200),
});

const listRunsRoute = defineContractRoute(iotScheduleContract.runs, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listIotScheduleRuns(c.req.valid('query'))), 200),
});

const createScheduleRoute = defineContractRoute(iotScheduleContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'iot:schedule:create',
    audit: { description: '创建 IoT 计划任务', module: 'IoT 计划任务' },
  })],
  handler: async (c) => c.json(okBody(await createIotSchedule(c.req.valid('json')), '创建成功'), 200),
});

const updateScheduleRoute = defineContractRoute(iotScheduleContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'iot:schedule:update',
    audit: { description: '更新 IoT 计划任务', module: 'IoT 计划任务' },
  })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotSchedule(await ensureIotScheduleExists(id)));
    return c.json(okBody(await updateIotSchedule(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteScheduleRoute = defineContractRoute(iotScheduleContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'iot:schedule:delete',
    audit: { description: '删除 IoT 计划任务', module: 'IoT 计划任务' },
  })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotSchedule(await ensureIotScheduleExists(id)));
    await deleteIotSchedule(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

iotSchedulesRouter.openapiRoutes([
  listRoute,
  listRunsRoute,
  createScheduleRoute,
  updateScheduleRoute,
  deleteScheduleRoute,
] as const);
