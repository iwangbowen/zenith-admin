import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowScheduleContract } from '@zenith/shared/workflow';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { listSchedules, createSchedule, updateSchedule, deleteSchedule, runScheduleNow, getWorkflowSchedule } from '../../services/workflow/workflow-schedules.service';
import { mountCrud } from '../_crud';
import { listScheduleRuns, getScheduleRun, retryScheduleRun } from '../../services/workflow/workflow-schedule-runs.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const runNowRoute = defineContractRoute(workflowScheduleContract.run, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getWorkflowSchedule(id));
    return c.json(okBody(await runScheduleNow(id), '已触发一次执行'), 200);
  },
});

const runsRoute = defineContractRoute(workflowScheduleContract.runs, {
  handler: async (c) => c.json(okBody(await listScheduleRuns(c.req.valid('param').id, c.req.valid('query'))), 200),
});
const runDetailRoute = defineContractRoute(workflowScheduleContract.runDetail, {
  handler: async (c) => {
    const { id, jobId } = c.req.valid('param');
    return c.json(okBody(await getScheduleRun(id, jobId)), 200);
  },
});
const retryRunRoute = defineContractRoute(workflowScheduleContract.retryRun, {
  handler: async (c) => {
    const { id, jobId } = c.req.valid('param');
    setAuditBeforeData(c, await getScheduleRun(id, jobId));
    return c.json(okBody(await retryScheduleRun(id, jobId), '已补发原周期'), 200);
  },
});

mountCrud(router, workflowScheduleContract,
  {
    list: listSchedules,
    get: getWorkflowSchedule,
    create: createSchedule,
    update: updateSchedule,
    remove: deleteSchedule,
  },
  {
    messages: { create: '已创建', update: '已更新', remove: '已删除' },
  },
  [runNowRoute, runsRoute, runDetailRoute, retryRunRoute],
);

export default router;
