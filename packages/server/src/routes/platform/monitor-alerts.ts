import { OpenAPIHono } from '@hono/zod-openapi';
import { monitorAlertContract } from '@zenith/shared/platform';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listRules, createRule, updateRule, deleteRule, deleteRules, setRuleEnabled, setRulesEnabled, listEvents,
  handleEvent, handleEvents, getAlertOverview, testRule,
  getMonitorAlertRuleBeforeAudit, getMonitorAlertEventBeforeAudit,
} from '../../services/platform/monitor-alert.service';

const monitorAlertsRouter = new OpenAPIHono({ defaultHook: validationHook });

// ─── 告警概览 ──────────────────────────────────────────────────────────────
const overview = defineContractRoute(monitorAlertContract.overview, {
  middleware: [authMiddleware, guard({ permission: 'alert:overview:list' })],
  handler: async (c) => c.json(okBody(await getAlertOverview(c.req.valid('query').range)), 200),
});

// ─── 告警事件（先于 /{id} 注册，避免冲突）──────────────────────────────────
const eventsList = defineContractRoute(monitorAlertContract.events, {
  middleware: [authMiddleware, guard({ permission: 'alert:event:list' })],
  handler: async (c) => c.json(okBody(await listEvents(c.req.valid('query'))), 200),
});

// 批量必须先于 `/events/{id}/handle` 注册，否则 `batch` 会被当成事件 id
const eventBatchHandle = defineContractRoute(monitorAlertContract.handleEventsBatch, {
  middleware: [authMiddleware, guard({ permission: 'alert:event:handle', audit: { description: '批量处理告警事件', module: '告警中心' } })],
  handler: async (c) => {
    const { ids, ...input } = c.req.valid('json');
    const count = await handleEvents(ids, input);
    return c.json(okBody(null, `已处理 ${count} 条告警`), 200);
  },
});

const eventHandle = defineContractRoute(monitorAlertContract.handleEvent, {
  middleware: [authMiddleware, guard({ permission: 'alert:event:handle', audit: { description: '处理告警事件', module: '告警中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMonitorAlertEventBeforeAudit(id));
    return c.json(okBody(await handleEvent(id, c.req.valid('json')), '操作成功'), 200);
  },
});

// ─── 告警规则 CRUD ─────────────────────────────────────────────────────────
const rulesList = defineContractRoute(monitorAlertContract.list, {
  middleware: [authMiddleware, guard({ permission: 'alert:rule:list' })],
  handler: async (c) => c.json(okBody(await listRules(c.req.valid('query'))), 200),
});

const ruleCreate = defineContractRoute(monitorAlertContract.create, {
  middleware: [authMiddleware, guard({ permission: 'alert:rule:create', audit: { description: '创建告警规则', module: '告警中心' } })],
  handler: async (c) => c.json(okBody(await createRule(c.req.valid('json')), '创建成功'), 200),
});

const ruleUpdate = defineContractRoute(monitorAlertContract.update, {
  middleware: [authMiddleware, guard({ permission: 'alert:rule:update', audit: { description: '更新告警规则', module: '告警中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMonitorAlertRuleBeforeAudit(id));
    return c.json(okBody(await updateRule(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const ruleToggle = defineContractRoute(monitorAlertContract.setEnabled, {
  middleware: [authMiddleware, guard({ permission: 'alert:rule:update', audit: { description: '切换告警规则状态', module: '告警中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMonitorAlertRuleBeforeAudit(id));
    return c.json(okBody(await setRuleEnabled(id, c.req.valid('json').enabled), '操作成功'), 200);
  },
});

const ruleBatchToggle = defineContractRoute(monitorAlertContract.setEnabledBatch, {
  middleware: [authMiddleware, guard({ permission: 'alert:rule:update', audit: { description: '批量切换告警规则状态', module: '告警中心' } })],
  handler: async (c) => {
    const { ids, enabled } = c.req.valid('json');
    const count = await setRulesEnabled(ids, enabled);
    return c.json(okBody(null, `已${enabled ? '启用' : '停用'} ${count} 条规则`), 200);
  },
});

// `DELETE /batch` 必须注册在 `DELETE /{id}` 之前，否则会被匹配成 id="batch"
const ruleBatchDelete = defineContractRoute(monitorAlertContract.removeBatch, {
  middleware: [authMiddleware, guard({ permission: 'alert:rule:delete', audit: { description: '批量删除告警规则', module: '告警中心' } })],
  handler: async (c) => {
    await deleteRules(c.req.valid('json').ids);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const ruleDelete = defineContractRoute(monitorAlertContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'alert:rule:delete', audit: { description: '删除告警规则', module: '告警中心' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMonitorAlertRuleBeforeAudit(id));
    await deleteRule(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const ruleTest = defineContractRoute(monitorAlertContract.test, {
  middleware: [authMiddleware, guard({ permission: 'alert:rule:test', audit: { description: '试发告警通知', module: '告警中心' } })],
  handler: async (c) => c.json(okBody(await testRule(c.req.valid('param').id), '测试通知已发送'), 200),
});

monitorAlertsRouter.openapiRoutes([
  // 批量路由必须先于 `/{id}` 系列注册，否则 `/batch` 会被匹配成 id="batch"
  overview, eventsList, eventBatchHandle, eventHandle,
  rulesList, ruleCreate, ruleBatchToggle, ruleBatchDelete, ruleTest, ruleUpdate, ruleToggle, ruleDelete,
] as const);

export default monitorAlertsRouter;
