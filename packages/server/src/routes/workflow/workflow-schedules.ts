import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowScheduleContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow, getWorkflowScheduleBeforeAudit } from '../../services/workflow/workflow-schedules.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineContractRoute(workflowScheduleContract.list, {
  middleware: [authMiddleware, guard({ permission: 'workflow:schedule:list' })] as const,
  handler: async (c) => c.json(okBody(await listSchedules(c.req.valid('query'))), 200),
});

const createRouteDef = defineContractRoute(workflowScheduleContract.create, {
  middleware: [authMiddleware, guard({ permission: 'workflow:schedule:create', audit: { description: '新建定时发起', module: '工作流管理' } })] as const,
  handler: async (c) => c.json(okBody(await createSchedule(c.req.valid('json')), '已创建'), 200),
});

const updateRouteDef = defineContractRoute(workflowScheduleContract.update, {
  middleware: [authMiddleware, guard({ permission: 'workflow:schedule:edit', audit: { description: '更新定时发起', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowScheduleBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateSchedule(id, c.req.valid('json')), '已更新'), 200);
  },
});

const deleteRouteDef = defineContractRoute(workflowScheduleContract.remove, {
  middleware: [authMiddleware, guard({ permission: 'workflow:schedule:delete', audit: { description: '删除定时发起', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowScheduleBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await deleteSchedule(id);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const runNowRoute = defineContractRoute(workflowScheduleContract.run, {
  middleware: [authMiddleware, guard({ permission: 'workflow:schedule:edit', audit: { description: '手动触发定时发起', module: '工作流管理' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getWorkflowScheduleBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await runScheduleNow(id), '已触发一次执行'), 200);
  },
});

router.openapiRoutes([listRoute, createRouteDef, updateRouteDef, deleteRouteDef, runNowRoute] as const);

export default router;
