// ─── 实例查询与看板读模型（列表/详情/分析/逾期）───
import { workflowInstanceContract, workflowTaskContract } from '@zenith/shared/workflow';
import { defineContractRoute } from '../../../lib/contract-route';
import { inlineOrAttachmentDisposition } from '../../../lib/content-disposition';
import { okBody } from '../../../lib/openapi-schemas';
import { listMyInstances, listPendingMine, listPendingDefinitionOptions, listAllInstances, listMyCc, listMyHandled, getInstanceDetail, countMyCcUnread, countPendingMine, getWorkbenchSummary, listRelationOptions, listAllTasks } from '../../../services/workflow/workflow-instances.service';
import { renderWorkflowInstancePdf, loadPrintVerifyView } from '../../../services/workflow/workflow-print.service';
import { renderPrintVerifyPage } from './print-verify-page';
import { getWorkflowAnalytics, listOverdueTasks } from '../../../services/workflow/workflow-analytics.service';
import { listWorkflowSelectableUsers } from '../../../services/workflow/workflow-selectable-users.service';

/**
 * 工作流协作选人（转办/委派/加签/协办/转发/抄送共用）。
 * 面向普通发起人/审批人开放——不要求 system:user:list（用户管理 `userContract.all` 的权限），
 * 仅返回协作必需的最小字段。
 */
export const selectableUsersRoute = defineContractRoute(workflowInstanceContract.selectableUsers, {
  handler: async (c) => c.json(okBody(await listWorkflowSelectableUsers()), 200),
});

export const listRoute = defineContractRoute(workflowInstanceContract.list, {
  handler: async (c) => c.json(okBody(await listMyInstances(c.req.valid('query'))), 200),
});

export const pendingMineRoute = defineContractRoute(workflowInstanceContract.pendingMine, {
  handler: async (c) => c.json(okBody(await listPendingMine(c.req.valid('query'))), 200),
});

export const pendingMineCountRoute = defineContractRoute(workflowInstanceContract.pendingMineCount, {
  handler: async (c) => c.json(okBody({ count: await countPendingMine() }), 200),
});

export const pendingDefinitionOptionsRoute = defineContractRoute(workflowInstanceContract.pendingDefinitionOptions, {
  handler: async (c) => c.json(okBody(await listPendingDefinitionOptions()), 200),
});

export const allRoute = defineContractRoute(workflowInstanceContract.monitor, {
  handler: async (c) => c.json(okBody(await listAllInstances(c.req.valid('query'))), 200),
});

export const ccMineRoute = defineContractRoute(workflowInstanceContract.ccMine, {
  handler: async (c) => c.json(okBody(await listMyCc(c.req.valid('query'))), 200),
});

export const handledMineRoute = defineContractRoute(workflowInstanceContract.handledMine, {
  handler: async (c) => c.json(okBody(await listMyHandled(c.req.valid('query'))), 200),
});

export const ccUnreadCountRoute = defineContractRoute(workflowInstanceContract.ccUnreadCount, {
  handler: async (c) => c.json(okBody({ count: await countMyCcUnread() }), 200),
});

export const workbenchSummaryRoute = defineContractRoute(workflowInstanceContract.workbenchSummary, {
  handler: async (c) => c.json(okBody(await getWorkbenchSummary()), 200),
});

export const relationOptionsRoute = defineContractRoute(workflowInstanceContract.relationOptions, {
  handler: async (c) => c.json(okBody(await listRelationOptions(c.req.valid('query'))), 200),
});

export const detailRoute = defineContractRoute(workflowInstanceContract.detail, {
  // 发起人（instance:list）/ 审批人（task:handle）/ 监控管理员（instance:monitor）均可进入，
  // service 层再按发起人/参与人/monitor 权限细粒度判定
  handler: async (c) => c.json(okBody(await getInstanceDetail(c.req.valid('param').id)), 200),
});

/**
 * 审批单 PDF：在详情访问口径（发起人 / 参与人 / 监控）之上再要求 workflow:instance:print，
 * 让组织可以把「能看」与「能打印」分开授权；每次打印写操作日志（不记录二进制响应体）。
 */
export const printRoute = defineContractRoute(workflowInstanceContract.print, {
  handler: async (c) => {
    const { buffer, filename, source } = await renderWorkflowInstancePdf(c.req.valid('param').id, c.req.valid('query'));
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': inlineOrAttachmentDisposition('application/pdf', filename),
        'Cache-Control': 'private, no-store',
        'X-Zenith-Print-Source': source,
      },
    });
  },
});

/** 公开验真页：无登录、无脚本；令牌不可识别时同样返回 200 提示页（不给扫描者区分「不存在」与「伪造」的信号） */
export const printVerifyRoute = defineContractRoute(workflowInstanceContract.printVerify, {
  middleware: [],
  handler: async (c) => {
    const view = await loadPrintVerifyView(c.req.valid('param').token);
    return new Response(renderPrintVerifyPage(view), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  },
});

export const analyticsRoute = defineContractRoute(workflowInstanceContract.analytics, {
  handler: async (c) => c.json(okBody(await getWorkflowAnalytics(c.req.valid('query'))), 200),
});

export const overdueRoute = defineContractRoute(workflowInstanceContract.overdue, {
  handler: async (c) => c.json(okBody(await listOverdueTasks(c.req.valid('query'))), 200),
});

export const tasksMonitorRoute = defineContractRoute(workflowTaskContract.taskMonitor, {
  handler: async (c) => c.json(okBody(await listAllTasks(c.req.valid('query'))), 200),
});
