/**
 * IoT 告警：告警记录 / 告警规则 / 维护窗口
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotAlarmContract, iotAlarmRuleContract, iotMaintenanceWindowContract } from '@zenith/shared/iot';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  acknowledgeIotAlarm, createIotAlarmRule, deleteIotAlarmRule, ensureIotAlarmRuleExists, listIotAlarmRules,
  listIotAlarms, mapIotAlarmRule, resolveIotAlarm, updateIotAlarmRule,
} from '../../services/iot/iot-alarms.service';
import {
  createIotMaintenanceWindow, deleteIotMaintenanceWindow, ensureIotMaintenanceWindowExists,
  listIotMaintenanceWindows, mapIotMaintenanceWindow, updateIotMaintenanceWindow,
} from '../../services/iot/iot-maintenance.service';

const read = [authMiddleware, guard({ permission: 'iot:alarm:list' })] as const;
const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

// ─── 告警记录 ────────────────────────────────────────────────────────────────
export const iotAlarmsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listAlarmsRoute = defineContractRoute(iotAlarmContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listIotAlarms(c.req.valid('query'))), 200),
});

const acknowledgeAlarmRoute = defineContractRoute(iotAlarmContract.acknowledge, {
  middleware: [authMiddleware, guard({
    permission: 'iot:alarm:resolve',
    audit: { description: '认领 IoT 告警', module: 'IoT 告警' },
  })],
  responses: { 404: { content: jsonContent(ErrorResponse), description: '不存在或已被认领/恢复' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await acknowledgeIotAlarm(id), '告警已认领'), 200);
  },
});

const resolveAlarmRoute = defineContractRoute(iotAlarmContract.resolve, {
  middleware: [authMiddleware, guard({
    permission: 'iot:alarm:resolve',
    audit: { description: '处理 IoT 告警', module: 'IoT 告警' },
  })],
  responses: { 404: { content: jsonContent(ErrorResponse), description: '不存在或已恢复' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await resolveIotAlarm(id, body?.note ?? null), '告警已处理'), 200);
  },
});

iotAlarmsRouter.openapiRoutes([listAlarmsRoute, acknowledgeAlarmRoute, resolveAlarmRoute] as const);

// ─── 告警规则 ────────────────────────────────────────────────────────────────
export const iotAlarmRulesRouter = new OpenAPIHono({ defaultHook: validationHook });

const listRulesRoute = defineContractRoute(iotAlarmRuleContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listIotAlarmRules(c.req.valid('query'))), 200),
});

const createRuleRoute = defineContractRoute(iotAlarmRuleContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'iot:alarm:rule:create',
    audit: { description: '创建 IoT 告警规则', module: 'IoT 告警' },
  })],
  handler: async (c) => c.json(okBody(await createIotAlarmRule(c.req.valid('json')), '创建成功'), 200),
});

const updateRuleRoute = defineContractRoute(iotAlarmRuleContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'iot:alarm:rule:update',
    audit: { description: '更新 IoT 告警规则', module: 'IoT 告警' },
  })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotAlarmRule(await ensureIotAlarmRuleExists(id)));
    return c.json(okBody(await updateIotAlarmRule(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteRuleRoute = defineContractRoute(iotAlarmRuleContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'iot:alarm:rule:delete',
    audit: { description: '删除 IoT 告警规则', module: 'IoT 告警' },
  })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotAlarmRule(await ensureIotAlarmRuleExists(id)));
    await deleteIotAlarmRule(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

iotAlarmRulesRouter.openapiRoutes([
  listRulesRoute,
  createRuleRoute,
  updateRuleRoute,
  deleteRuleRoute,
] as const);

// ─── 维护窗口 ────────────────────────────────────────────────────────────────
export const iotMaintenanceWindowsRouter = new OpenAPIHono({ defaultHook: validationHook });

const listWindowsRoute = defineContractRoute(iotMaintenanceWindowContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listIotMaintenanceWindows(c.req.valid('query'))), 200),
});

const createWindowRoute = defineContractRoute(iotMaintenanceWindowContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'iot:alarm:rule:create',
    audit: { description: '创建 IoT 维护窗口', module: 'IoT 告警' },
  })],
  handler: async (c) => c.json(okBody(await createIotMaintenanceWindow(c.req.valid('json')), '创建成功'), 200),
});

const updateWindowRoute = defineContractRoute(iotMaintenanceWindowContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'iot:alarm:rule:update',
    audit: { description: '更新 IoT 维护窗口', module: 'IoT 告警' },
  })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotMaintenanceWindow(await ensureIotMaintenanceWindowExists(id)));
    return c.json(okBody(await updateIotMaintenanceWindow(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteWindowRoute = defineContractRoute(iotMaintenanceWindowContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'iot:alarm:rule:delete',
    audit: { description: '删除 IoT 维护窗口', module: 'IoT 告警' },
  })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotMaintenanceWindow(await ensureIotMaintenanceWindowExists(id)));
    await deleteIotMaintenanceWindow(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

iotMaintenanceWindowsRouter.openapiRoutes([
  listWindowsRoute,
  createWindowRoute,
  updateWindowRoute,
  deleteWindowRoute,
] as const);
