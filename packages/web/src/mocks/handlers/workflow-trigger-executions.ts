import { workflowTriggerExecutionContract } from '@zenith/shared/workflow';
import type { WorkflowTriggerExecution } from '@zenith/shared/workflow';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';

export const mockWorkflowTriggerExecutions: WorkflowTriggerExecution[] = [
  {
    id: 1,
    instanceId: 1,
    instanceTitle: '请假审批测试 - 管理员',
    taskId: 1,
    nodeKey: 'approve_1',
    nodeName: '直属主管审批',
    triggerType: 'webhook',
    status: 'success',
    attempt: 1,
    requestUrl: 'https://example.com/workflow/webhook',
    requestMethod: 'POST',
    requestBody: '{"instanceId":1,"nodeKey":"approve_1"}',
    responseStatus: 200,
    responseBody: '{"ok":true}',
    errorMessage: null,
    durationMs: 142,
    tenantId: 1,
    createdAt: mockDateTimeOffset(-2 * 60 * 60 * 1000),
  },
  {
    id: 2,
    instanceId: 2,
    instanceTitle: '差旅报销 - 8200 元 - 张三',
    taskId: 3,
    nodeKey: 'approve_2',
    nodeName: '财务审批',
    triggerType: 'callback',
    status: 'failed',
    attempt: 2,
    requestUrl: 'https://api.example.com/workflow/callback',
    requestMethod: 'POST',
    requestBody: '{"instanceId":2,"taskId":3}',
    responseStatus: 504,
    responseBody: '{"message":"timeout"}',
    errorMessage: '回调请求超时',
    durationMs: 30000,
    tenantId: 1,
    createdAt: mockDateTimeOffset(-30 * 60 * 1000),
  },
  {
    id: 3,
    instanceId: 2,
    instanceTitle: '差旅报销 - 8200 元 - 张三',
    taskId: null,
    nodeKey: 'update_form_data',
    nodeName: '字段回写',
    triggerType: 'updateData',
    status: 'retrying',
    attempt: 3,
    requestUrl: null,
    requestMethod: null,
    requestBody: '{"status":"approved"}',
    responseStatus: null,
    responseBody: null,
    errorMessage: '等待下一次重试',
    durationMs: null,
    tenantId: 1,
    createdAt: mockDateTime(),
  },
];

export const workflowTriggerExecutionsHandlers = [
  mock(workflowTriggerExecutionContract.list, ({ query, ok, paginate }) => {
    const nodeKey = (query.nodeKey ?? '').trim();
    let list = [...mockWorkflowTriggerExecutions];
    if (query.instanceId) list = list.filter((item) => item.instanceId === query.instanceId);
    if (nodeKey) list = list.filter((item) => item.nodeKey.includes(nodeKey));
    if (query.status) list = list.filter((item) => item.status === query.status);
    list.sort((a, b) => b.id - a.id);
    return ok(paginate(list));
  }),

  mock(workflowTriggerExecutionContract.detail, ({ params, ok }) => {
    const row = mockWorkflowTriggerExecutions.find((item) => item.id === params.id);
    if (!row) return notFound('触发器执行记录不存在');
    return ok(row);
  }),
];
