/**
 * IoT 数据流转规则
 *
 * CRUD + 投递日志查询；运行时派发见 iot-forward.service（挂在遥测/事件/告警/生命周期）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotForwardRuleContract } from '@zenith/shared/iot';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createIotForwardRule, deleteIotForwardRule, ensureIotForwardRuleExists,
  listIotForwardLogs, listIotForwardRules, mapIotForwardRule, updateIotForwardRule,
} from '../../services/iot/iot-forward.service';

export const iotForwardRulesRouter = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'iot:forward:list' })] as const;
const notFound = { 404: { content: jsonContent(ErrorResponse), description: '不存在' } } as const;

const listRoute = defineContractRoute(iotForwardRuleContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listIotForwardRules(c.req.valid('query'))), 200),
});

const listLogsRoute = defineContractRoute(iotForwardRuleContract.logs, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listIotForwardLogs(c.req.valid('query'))), 200),
});

const createForwardRoute = defineContractRoute(iotForwardRuleContract.create, {
  middleware: [authMiddleware, guard({
    permission: 'iot:forward:create',
    audit: { description: '创建 IoT 流转规则', module: 'IoT 数据流转' },
  })],
  handler: async (c) => c.json(okBody(await createIotForwardRule(c.req.valid('json')), '创建成功'), 200),
});

const updateForwardRoute = defineContractRoute(iotForwardRuleContract.update, {
  middleware: [authMiddleware, guard({
    permission: 'iot:forward:update',
    audit: { description: '更新 IoT 流转规则', module: 'IoT 数据流转' },
  })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotForwardRule(await ensureIotForwardRuleExists(id)));
    return c.json(okBody(await updateIotForwardRule(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteForwardRoute = defineContractRoute(iotForwardRuleContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'iot:forward:delete',
    audit: { description: '删除 IoT 流转规则', module: 'IoT 数据流转' },
  })],
  responses: notFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, mapIotForwardRule(await ensureIotForwardRuleExists(id)));
    await deleteIotForwardRule(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

iotForwardRulesRouter.openapiRoutes([
  listRoute,
  listLogsRoute,
  createForwardRoute,
  updateForwardRoute,
  deleteForwardRoute,
] as const);
