import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowEngineContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getWorkflowEngineIntrospection } from '../../services/workflow/workflow-engine-introspection.service';
import { getWorkflowEngineHealthHistory, previewWorkflowEngineAction, runWorkflowEngineAction } from '../../services/workflow/workflow-engine-ops.service';
import { listWorkflowJobs, getWorkflowJobDetail, getWorkflowJobChain, retryWorkflowJob, skipWorkflowJob, getWorkflowJobsSummary, batchRetryWorkflowJobs, batchSkipWorkflowJobs, replayDeadJobs, previewReplayJobs, getJobFailureClusters, getWorkflowJobRuntimeStatus } from '../../services/workflow/workflow-jobs.service';
import { exportTraceDiagnosticBundle } from '../../services/workflow/workflow-diagnostics.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const monitor = [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const;

const introspectionRoute = defineContractRoute(workflowEngineContract.introspection, {
  middleware: monitor,
  handler: async (c) => {
    const { thresholdMinutes } = c.req.valid('query');
    return c.json(okBody(await getWorkflowEngineIntrospection(thresholdMinutes ?? 30)), 200);
  },
});

const healthHistoryRoute = defineContractRoute(workflowEngineContract.healthHistory, {
  middleware: monitor,
  handler: async (c) => {
    const { hours } = c.req.valid('query');
    return c.json(okBody(await getWorkflowEngineHealthHistory(hours ?? 24)), 200);
  },
});

const actionRoute = defineContractRoute(workflowEngineContract.runAction, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { module: '流程引擎', description: '执行引擎运维恢复动作' } })] as const,
  handler: async (c) => {
    const { action } = c.req.valid('param');
    return c.json(okBody(await runWorkflowEngineAction(action, c.req.valid('json'))), 200);
  },
});

const actionPreviewRoute = defineContractRoute(workflowEngineContract.previewAction, {
  middleware: monitor,
  handler: async (c) => {
    const { action } = c.req.valid('param');
    return c.json(okBody(await previewWorkflowEngineAction(action, c.req.valid('json'))), 200);
  },
});

const jobsListRoute = defineContractRoute(workflowEngineContract.jobs, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await listWorkflowJobs(c.req.valid('query'))), 200),
});

const jobsSummaryRoute = defineContractRoute(workflowEngineContract.jobsSummary, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await getWorkflowJobsSummary()), 200),
});

const jobChainRoute = defineContractRoute(workflowEngineContract.jobChain, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await getWorkflowJobChain(c.req.valid('param').traceId)), 200),
});

const jobChainBundleRoute = defineContractRoute(workflowEngineContract.jobChainBundle, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await exportTraceDiagnosticBundle(c.req.valid('param').traceId)), 200),
});

const jobDetailRoute = defineContractRoute(workflowEngineContract.jobDetail, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await getWorkflowJobDetail(c.req.valid('param').id)), 200),
});

const jobRetryRoute = defineContractRoute(workflowEngineContract.retryJob, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { module: '流程引擎', description: '重试工作流作业' } })] as const,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await retryWorkflowJob(id, c.req.valid('json').payload), '已重新入队'), 200);
  },
});

const jobSkipRoute = defineContractRoute(workflowEngineContract.skipJob, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { module: '流程引擎', description: '跳过工作流作业' } })] as const,
  handler: async (c) => c.json(okBody(await skipWorkflowJob(c.req.valid('param').id), '已跳过'), 200),
});

const jobsBatchRetryRoute = defineContractRoute(workflowEngineContract.batchRetryJobs, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { module: '流程引擎', description: '批量重试工作流作业' } })] as const,
  handler: async (c) => {
    const { ids, ratePerSecond } = c.req.valid('json');
    const result = await batchRetryWorkflowJobs(ids, { ratePerSecond });
    return c.json(okBody(result, `已重试 ${result.success} 项${result.skipped > 0 ? `，${result.skipped} 项状态不满足已跳过` : ''}`), 200);
  },
});

const jobsBatchSkipRoute = defineContractRoute(workflowEngineContract.batchSkipJobs, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { module: '流程引擎', description: '批量跳过工作流作业' } })] as const,
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const result = await batchSkipWorkflowJobs(ids);
    return c.json(okBody(result, `已跳过 ${result.success} 项${result.skipped > 0 ? `，${result.skipped} 项状态不满足已跳过` : ''}`), 200);
  },
});

const jobsReplayDeadRoute = defineContractRoute(workflowEngineContract.replayDeadJobs, {
  middleware: [authMiddleware, guard({ permission: 'workflow:engine:operate', audit: { module: '流程引擎', description: '重放死信作业' } })] as const,
  handler: async (c) => {
    const r = await replayDeadJobs(c.req.valid('json'));
    const more = r.matched > r.total ? `，剩余 ${r.matched - r.total} 条超单次上限未处理` : '';
    return c.json(okBody(r, `已按 ${r.ratePerSecond} 条/秒错峰重放 ${r.success}/${r.total}（匹配 ${r.matched} 条）${more}`), 200);
  },
});

const jobsReplayPreviewRoute = defineContractRoute(workflowEngineContract.replayPreview, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await previewReplayJobs(c.req.valid('json'))), 200),
});

const jobFailureClustersRoute = defineContractRoute(workflowEngineContract.failureClusters, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await getJobFailureClusters(c.req.valid('query').dimension)), 200),
});

const jobRuntimeStatusRoute = defineContractRoute(workflowEngineContract.jobRuntimeStatus, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await getWorkflowJobRuntimeStatus()), 200),
});

// 静态段路由（/jobs/summary、/jobs/failure-clusters、/jobs/runtime-status 等）必须先于
// 参数化路由 /jobs/{id} 注册，否则 GET /jobs/runtime-status 会被 /jobs/{id} 捕获并按 id 校验失败。
router.openapiRoutes([introspectionRoute, healthHistoryRoute, actionRoute, actionPreviewRoute, jobsListRoute, jobsSummaryRoute, jobChainRoute, jobChainBundleRoute, jobsBatchRetryRoute, jobsBatchSkipRoute, jobsReplayDeadRoute, jobsReplayPreviewRoute, jobFailureClustersRoute, jobRuntimeStatusRoute, jobDetailRoute, jobRetryRoute, jobSkipRoute] as const);

export default router;
