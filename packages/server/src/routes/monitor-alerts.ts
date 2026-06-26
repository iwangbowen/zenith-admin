import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { authMiddleware } from '../middleware/auth';
import { guard, setAuditBeforeData } from '../middleware/guard';
import {
  jsonContent, validationHook, commonErrorResponses, ok, okMsg, okPaginated, IdParam, PaginationQuery, okBody,
} from '../lib/openapi-schemas';
import {
  MonitorAlertRuleDTO, MonitorAlertEventDTO, CreateMonitorAlertRuleDTO, UpdateMonitorAlertRuleDTO,
} from '../lib/openapi-dtos';
import {
  listRules, createRule, updateRule, deleteRule, setRuleEnabled, listEvents, getMonitorAlertRuleBeforeAudit,
} from '../services/monitor-alert.service';

const monitorAlertsRouter = new OpenAPIHono({ defaultHook: validationHook });

const MANAGE_PERM = 'system:monitor:alert:manage';
const VIEW_PERM = 'system:monitor:alert';

const EventQuery = PaginationQuery.extend({
  metric: z.enum(['cpu', 'memory', 'disk', 'swap', 'load1', 'procCpu', 'heap', 'loopLag', 'qps', 'errorRate', 'netRxBps', 'netTxBps', 'diskReadBps', 'diskWriteBps']).optional(),
  level: z.enum(['info', 'warning', 'critical']).optional(),
  status: z.enum(['firing', 'resolved']).optional(),
  ruleId: z.coerce.number().int().positive().optional(),
});

const EnabledBody = z.object({ enabled: z.boolean() });

// ─── 告警记录（先于 /{id} 注册，避免冲突）──────────────────────────────────
const eventsList = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/events', tags: ['MonitorAlerts'], summary: '获取监控告警记录列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: VIEW_PERM })] as const,
    request: { query: EventQuery },
    responses: { ...okPaginated(MonitorAlertEventDTO, '告警记录'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listEvents(c.req.valid('query'))), 200),
});

// ─── 告警规则 CRUD ─────────────────────────────────────────────────────────
const rulesList = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['MonitorAlerts'], summary: '获取监控告警规则列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: VIEW_PERM })] as const,
    request: { query: PaginationQuery },
    responses: { ...okPaginated(MonitorAlertRuleDTO, '告警规则'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await listRules(c.req.valid('query'))), 200),
});

const ruleCreate = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/', tags: ['MonitorAlerts'], summary: '创建监控告警规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: MANAGE_PERM, audit: { description: '创建监控告警规则', module: '系统运维' } })] as const,
    request: { body: { content: jsonContent(CreateMonitorAlertRuleDTO), required: true } },
    responses: { ...ok(MonitorAlertRuleDTO, '创建成功'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(await createRule(c.req.valid('json')), '创建成功'), 200),
});

const ruleUpdate = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/{id}', tags: ['MonitorAlerts'], summary: '更新监控告警规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: MANAGE_PERM, audit: { description: '更新监控告警规则', module: '系统运维' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(UpdateMonitorAlertRuleDTO), required: true } },
    responses: { ...ok(MonitorAlertRuleDTO, '更新成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMonitorAlertRuleBeforeAudit(id));
    return c.json(okBody(await updateRule(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const ruleToggle = defineOpenAPIRoute({
  route: createRoute({
    method: 'patch', path: '/{id}/enabled', tags: ['MonitorAlerts'], summary: '启用/禁用监控告警规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: MANAGE_PERM, audit: { description: '切换监控告警规则状态', module: '系统运维' } })] as const,
    request: { params: IdParam, body: { content: jsonContent(EnabledBody), required: true } },
    responses: { ...ok(MonitorAlertRuleDTO, '操作成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMonitorAlertRuleBeforeAudit(id));
    return c.json(okBody(await setRuleEnabled(id, c.req.valid('json').enabled), '操作成功'), 200);
  },
});

const ruleDelete = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/{id}', tags: ['MonitorAlerts'], summary: '删除监控告警规则',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: MANAGE_PERM, audit: { description: '删除监控告警规则', module: '系统运维' } })] as const,
    request: { params: IdParam },
    responses: { ...okMsg('删除成功'), ...commonErrorResponses },
  }),
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getMonitorAlertRuleBeforeAudit(id));
    await deleteRule(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

monitorAlertsRouter.openapiRoutes([eventsList, rulesList, ruleCreate, ruleUpdate, ruleToggle, ruleDelete] as const);

export default monitorAlertsRouter;
