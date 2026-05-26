import { http, HttpResponse } from 'msw';
import type { WorkflowAutomation } from '@zenith/shared';
import { mockWorkflowDefinitions } from '@/mocks/data/workflow';
import { mockDateTime } from '@/mocks/utils/date';

function ok<T>(data: T) {
  return HttpResponse.json({ code: 0, message: 'ok', data });
}
function err(message: string, code = 400) {
  return HttpResponse.json({ code, message });
}

let nextId = 1;
const automations: WorkflowAutomation[] = [];

function fillDefinitionName(a: WorkflowAutomation): WorkflowAutomation {
  const def = mockWorkflowDefinitions.find((d) => d.id === a.definitionId);
  return { ...a, definitionName: def?.name ?? null };
}

export const workflowAutomationsHandlers = [
  http.get('/api/workflows/automations', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const definitionId = url.searchParams.get('definitionId');
    const trigger = url.searchParams.get('trigger');
    const status = url.searchParams.get('status');

    let list = automations.map(fillDefinitionName);
    if (definitionId) list = list.filter((a) => a.definitionId === Number(definitionId));
    if (trigger) list = list.filter((a) => a.trigger === trigger);
    if (status) list = list.filter((a) => a.status === status);
    list.sort((a, b) => a.sort - b.sort || a.id - b.id);

    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    return ok({ list: paged, total, page, pageSize });
  }),

  http.get('/api/workflows/automations/:id', ({ params }) => {
    const row = automations.find((a) => a.id === Number(params.id));
    if (!row) return err('自动化规则不存在', 404);
    return ok(fillDefinitionName(row));
  }),

  http.post('/api/workflows/automations', async ({ request }) => {
    const body = await request.json() as Partial<WorkflowAutomation>;
    if (!body.definitionId) return err('请选择所属流程');
    if (!body.name?.trim()) return err('请输入规则名称');
    if (!body.trigger) return err('请选择触发时机');
    if (!body.actions || body.actions.length === 0) return err('至少配置一个动作');
    const now = mockDateTime();
    const row: WorkflowAutomation = {
      id: nextId++,
      definitionId: body.definitionId,
      name: body.name,
      trigger: body.trigger,
      actions: body.actions,
      status: body.status ?? 'enabled',
      sort: body.sort ?? 0,
      tenantId: 1,
      createdAt: now,
      updatedAt: now,
    };
    automations.push(row);
    return ok(fillDefinitionName(row));
  }),

  http.put('/api/workflows/automations/:id', async ({ params, request }) => {
    const idx = automations.findIndex((a) => a.id === Number(params.id));
    if (idx === -1) return err('自动化规则不存在', 404);
    const body = await request.json() as Partial<WorkflowAutomation>;
    automations[idx] = {
      ...automations[idx],
      ...body,
      id: automations[idx].id,
      updatedAt: mockDateTime(),
    };
    return ok(fillDefinitionName(automations[idx]));
  }),

  http.delete('/api/workflows/automations/:id', ({ params }) => {
    const idx = automations.findIndex((a) => a.id === Number(params.id));
    if (idx === -1) return err('自动化规则不存在', 404);
    automations.splice(idx, 1);
    return ok({ message: '已删除' });
  }),

  http.post('/api/workflows/automations/batch-delete', async ({ request }) => {
    const body = await request.json() as { ids: number[] };
    for (const id of body.ids ?? []) {
      const i = automations.findIndex((a) => a.id === id);
      if (i !== -1) automations.splice(i, 1);
    }
    return ok({ message: '已删除' });
  }),
];
