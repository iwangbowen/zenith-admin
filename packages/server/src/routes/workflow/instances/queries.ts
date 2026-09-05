// ─── 实例查询与看板读模型（列表/详情/分析/逾期）───
import { workflowInstanceContract, workflowTaskContract } from '@zenith/shared/workflow';
import { authMiddleware } from '../../../middleware/auth';
import { guard } from '../../../middleware/guard';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { listMyInstances, listPendingMine, listAllInstances, listMyCc, listMyHandled, getInstanceDetail, countMyCcUnread, countPendingMine, listRelationOptions, listAllTasks } from '../../../services/workflow/workflow-instances.service';
import { getWorkflowAnalytics, listOverdueTasks } from '../../../services/workflow/workflow-analytics.service';
import { listWorkflowSelectableUsers } from '../../../services/workflow/workflow-selectable-users.service';

const instanceList = [authMiddleware, guard({ permission: 'workflow:instance:list' })] as const;
const taskHandle = [authMiddleware, guard({ permission: 'workflow:task:handle' })] as const;
const monitor = [authMiddleware, guard({ permission: 'workflow:instance:monitor' })] as const;

/**
 * 工作流协作选人（转办/委派/加签/协办/转发/抄送共用）。
 * 面向普通发起人/审批人开放——不要求 system:user:list（管理接口 /api/users/all 的权限），
 * 仅返回协作必需的最小字段。
 */
export const selectableUsersRoute = defineContractRoute(workflowInstanceContract.selectableUsers, {
  middleware: [authMiddleware, guard({ permission: ['workflow:instance:create', 'workflow:task:handle', 'workflow:instance:list'] })] as const,
  handler: async (c) => c.json(okBody(await listWorkflowSelectableUsers()), 200),
});

export const listRoute = defineContractRoute(workflowInstanceContract.list, {
  middleware: instanceList,
  handler: async (c) => c.json(okBody(await listMyInstances(c.req.valid('query'))), 200),
});

export const pendingMineRoute = defineContractRoute(workflowInstanceContract.pendingMine, {
  middleware: taskHandle,
  handler: async (c) => c.json(okBody(await listPendingMine(c.req.valid('query'))), 200),
});

export const pendingMineCountRoute = defineContractRoute(workflowInstanceContract.pendingMineCount, {
  middleware: taskHandle,
  handler: async (c) => c.json(okBody({ count: await countPendingMine() }), 200),
});

export const allRoute = defineContractRoute(workflowInstanceContract.monitor, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await listAllInstances(c.req.valid('query'))), 200),
});

export const ccMineRoute = defineContractRoute(workflowInstanceContract.ccMine, {
  middleware: instanceList,
  handler: async (c) => c.json(okBody(await listMyCc(c.req.valid('query'))), 200),
});

export const handledMineRoute = defineContractRoute(workflowInstanceContract.handledMine, {
  middleware: taskHandle,
  handler: async (c) => c.json(okBody(await listMyHandled(c.req.valid('query'))), 200),
});

export const ccUnreadCountRoute = defineContractRoute(workflowInstanceContract.ccUnreadCount, {
  middleware: instanceList,
  handler: async (c) => c.json(okBody({ count: await countMyCcUnread() }), 200),
});

export const relationOptionsRoute = defineContractRoute(workflowInstanceContract.relationOptions, {
  middleware: instanceList,
  handler: async (c) => c.json(okBody(await listRelationOptions(c.req.valid('query'))), 200),
});

export const detailRoute = defineContractRoute(workflowInstanceContract.detail, {
  // 发起人（instance:list）/ 审批人（task:handle）/ 监控管理员（instance:monitor）均可进入，
  // service 层再按发起人/参与人/monitor 权限细粒度判定
  middleware: [authMiddleware, guard({ permission: ['workflow:instance:list', 'workflow:task:handle', 'workflow:instance:monitor'] })] as const,
  handler: async (c) => c.json(okBody(await getInstanceDetail(c.req.valid('param').id)), 200),
});

export const analyticsRoute = defineContractRoute(workflowInstanceContract.analytics, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await getWorkflowAnalytics(c.req.valid('query'))), 200),
});

export const overdueRoute = defineContractRoute(workflowInstanceContract.overdue, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await listOverdueTasks(c.req.valid('query'))), 200),
});

export const tasksMonitorRoute = defineContractRoute(workflowTaskContract.taskMonitor, {
  middleware: monitor,
  handler: async (c) => c.json(okBody(await listAllTasks(c.req.valid('query'))), 200),
});
