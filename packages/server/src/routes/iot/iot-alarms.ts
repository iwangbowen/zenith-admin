/**
 * IoT 告警：告警记录 / 告警规则 / 维护窗口
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotAlarmContract, iotAlarmRuleContract, iotMaintenanceWindowContract } from '@zenith/shared/iot';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  acknowledgeIotAlarm,
  createIotAlarmRule,
  deleteIotAlarmRule,
  ensureIotAlarmRuleExists,
  getIotAlarm,
  listIotAlarmRules,
  listIotAlarms,
  mapIotAlarmRule,
  resolveIotAlarm,
  updateIotAlarmRule,
} from '../../services/iot/iot-alarms.service';
import {
  createIotMaintenanceWindow,
  deleteIotMaintenanceWindow,
  ensureIotMaintenanceWindowExists,
  listIotMaintenanceWindows,
  mapIotMaintenanceWindow,
  updateIotMaintenanceWindow,
} from '../../services/iot/iot-maintenance.service';
import { mountCrud } from '../_crud';

const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

// ─── 告警记录 ────────────────────────────────────────────────────────────────
export const iotAlarmsRouter = new OpenAPIHono({ defaultHook: validationHook });

const acknowledgeAlarmRoute = defineContractRoute(iotAlarmContract.acknowledge, {
  responses: { 404: { content: jsonContent(ErrorResponse), description: '不存在或已被认领/恢复' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await acknowledgeIotAlarm(id), '告警已认领'), 200);
  },
});

const resolveAlarmRoute = defineContractRoute(iotAlarmContract.resolve, {
  responses: { 404: { content: jsonContent(ErrorResponse), description: '不存在或已恢复' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    return c.json(okBody(await resolveIotAlarm(id, body?.note ?? null), '告警已处理'), 200);
  },
});

mountCrud(iotAlarmsRouter, iotAlarmContract,
  { list: listIotAlarms, get: getIotAlarm },
  { responses: { detail: notFound } },
  [acknowledgeAlarmRoute, resolveAlarmRoute],
);

// ─── 告警规则 ────────────────────────────────────────────────────────────────
export const iotAlarmRulesRouter = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(iotAlarmRulesRouter, iotAlarmRuleContract,
  {
    list: listIotAlarmRules,
    get: async (id: number) => mapIotAlarmRule(await ensureIotAlarmRuleExists(id)),
    create: createIotAlarmRule,
    update: updateIotAlarmRule,
    remove: deleteIotAlarmRule,
  },
  {
    responses: { update: notFound, remove: notFound },
  },
);

// ─── 维护窗口 ────────────────────────────────────────────────────────────────
export const iotMaintenanceWindowsRouter = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(iotMaintenanceWindowsRouter, iotMaintenanceWindowContract,
  {
    list: listIotMaintenanceWindows,
    get: async (id: number) => mapIotMaintenanceWindow(await ensureIotMaintenanceWindowExists(id)),
    create: createIotMaintenanceWindow,
    update: updateIotMaintenanceWindow,
    remove: deleteIotMaintenanceWindow,
  },
  {
    responses: { update: notFound, remove: notFound },
  },
);
