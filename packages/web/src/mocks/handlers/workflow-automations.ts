import { workflowAutomationContract } from '@zenith/shared/workflow';
import type { WorkflowAutomation, WorkflowAutomationRun } from '@zenith/shared/workflow';
import { mock } from '@/mocks/utils/contract';
import { requireItem, removeByIds } from '@/mocks/utils/crud';
import { badRequest, conflict, notFound } from '@/mocks/utils/handlers';
import { mockWorkflowDefinitions } from '@/mocks/data/workflow';
import { mockDateTime } from '@/mocks/utils/date';

let nextId = 1;
const automations: WorkflowAutomation[] = [];
export const mockWorkflowAutomationRuns: WorkflowAutomationRun[] = [];

function fillDefinitionName(a: WorkflowAutomation): WorkflowAutomation {
  const def = mockWorkflowDefinitions.find((d) => d.id === a.definitionId);
  return { ...a, definitionName: def?.name ?? null };
}

export const workflowAutomationsHandlers = [
  mock(workflowAutomationContract.runs, ({ query, ok, paginate }) => {
    let list = [...mockWorkflowAutomationRuns];
    if (query.ruleId) list = list.filter((run) => run.ruleId === query.ruleId);
    if (query.instanceId) list = list.filter((run) => run.instanceId === query.instanceId);
    if (query.status) list = list.filter((run) => run.status === query.status);
    return ok(paginate(list.sort((a, b) => b.id - a.id)));
  }),
  mock(workflowAutomationContract.retryRun, ({ params, ok }) => {
    const run = requireItem(mockWorkflowAutomationRuns, params.id, '自动化动作不存在');
    if (!run.canRetry || run.externalOutcomeUncertain) return conflict('仅结果确定的失败或死信动作可以重试', { status: 409 });
    Object.assign(run, { status: 'pending', attempts: 0, error: null, canRetry: false, nextRetryAt: null });
    return ok(run, '已提交动作重试');
  }),
  mock(workflowAutomationContract.list, ({ query, ok, paginate }) => {
    let list = automations.map(fillDefinitionName);
    if (query.definitionId) list = list.filter((a) => a.definitionId === query.definitionId);
    if (query.trigger) list = list.filter((a) => a.trigger === query.trigger);
    if (query.status) list = list.filter((a) => a.status === query.status);
    list.sort((a, b) => a.sort - b.sort || a.id - b.id);
    return ok(paginate(list));
  }),

  mock(workflowAutomationContract.detail, ({ params, ok }) => {
    const row = requireItem(automations, params.id, '自动化规则不存在');
    return ok(fillDefinitionName(row));
  }),

  mock(workflowAutomationContract.create, ({ body, ok }) => {
    if (!body.name.trim()) return badRequest('请输入规则名称');
    const now = mockDateTime();
    const row: WorkflowAutomation = {
      id: nextId++,
      definitionId: body.definitionId,
      name: body.name,
      trigger: body.trigger,
      actions: body.actions,
      status: body.status,
      sort: body.sort,
      tenantId: 1,
      createdAt: now,
      updatedAt: now,
    };
    automations.push(row);
    return ok(fillDefinitionName(row));
  }),

  mock(workflowAutomationContract.update, ({ params, body, ok }) => {
    const idx = automations.findIndex((a) => a.id === params.id);
    if (idx === -1) return notFound('自动化规则不存在');
    automations[idx] = {
      ...automations[idx],
      ...body,
      id: automations[idx].id,
      updatedAt: mockDateTime(),
    };
    return ok(fillDefinitionName(automations[idx]));
  }),

  mock(workflowAutomationContract.remove, ({ params, ok }) => {
    requireItem(automations, params.id, '自动化规则不存在');
    removeByIds(automations, [params.id]);
    return ok(null, '已删除');
  }),

  mock(workflowAutomationContract.batchDelete, ({ body, ok }) => {
    removeByIds(automations, body.ids);
    return ok(null, '已删除');
  }),
];
