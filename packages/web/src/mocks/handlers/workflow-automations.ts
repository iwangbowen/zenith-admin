import { workflowAutomationContract } from '@zenith/shared/workflow';
import type { WorkflowAutomation } from '@zenith/shared/workflow';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockWorkflowDefinitions } from '@/mocks/data/workflow';
import { mockDateTime } from '@/mocks/utils/date';

let nextId = 1;
const automations: WorkflowAutomation[] = [];

function fillDefinitionName(a: WorkflowAutomation): WorkflowAutomation {
  const def = mockWorkflowDefinitions.find((d) => d.id === a.definitionId);
  return { ...a, definitionName: def?.name ?? null };
}

export const workflowAutomationsHandlers = [
  mock(workflowAutomationContract.list, ({ query, ok, paginate }) => {
    let list = automations.map(fillDefinitionName);
    if (query.definitionId) list = list.filter((a) => a.definitionId === query.definitionId);
    if (query.trigger) list = list.filter((a) => a.trigger === query.trigger);
    if (query.status) list = list.filter((a) => a.status === query.status);
    list.sort((a, b) => a.sort - b.sort || a.id - b.id);
    return ok(paginate(list));
  }),

  mock(workflowAutomationContract.detail, ({ params, ok }) => {
    const row = automations.find((a) => a.id === params.id);
    if (!row) return notFound('自动化规则不存在');
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
    const idx = automations.findIndex((a) => a.id === params.id);
    if (idx === -1) return notFound('自动化规则不存在');
    automations.splice(idx, 1);
    return ok(null, '已删除');
  }),

  mock(workflowAutomationContract.batchDelete, ({ body, ok }) => {
    for (const id of body.ids) {
      const i = automations.findIndex((a) => a.id === id);
      if (i !== -1) automations.splice(i, 1);
    }
    return ok(null, '已删除');
  }),
];
