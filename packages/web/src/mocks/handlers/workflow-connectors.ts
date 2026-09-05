import { workflowConnectorContract } from '@zenith/shared/workflow';
import type { WorkflowConnector, WorkflowConnectorInvocation } from '@zenith/shared/workflow';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockWorkflowConnectors, getNextConnectorId } from '@/mocks/data/workflow-connectors';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';

const hasCred = (c?: Record<string, string | undefined>) => !!c && Object.values(c).some((v) => v != null && v !== '');

export const workflowConnectorsHandlers = [
  mock(workflowConnectorContract.list, ({ query, ok, paginate }) => {
    let list = [...mockWorkflowConnectors];
    if (query.keyword) list = list.filter((x) => x.name.includes(query.keyword!) || x.code.includes(query.keyword!));
    if (query.type) list = list.filter((x) => x.type === query.type);
    if (query.status) list = list.filter((x) => x.status === query.status);
    return ok(paginate(list));
  }),

  // 测试调用（demo 返回成功探测结果）
  mock(workflowConnectorContract.test, ({ ok }) =>
    ok({ ok: true, status: 200, durationMs: 42, responseSnippet: '{"demo":true,"args":{}}', error: null })),

  // 调用统计（demo）
  mock(workflowConnectorContract.stats, ({ params, query, ok }) => {
    const exists = mockWorkflowConnectors.some((x) => x.id === params.id);
    if (!exists) return notFound('连接器不存在', { status: 404 });
    const days = query.days ?? 7;
    const total = 128;
    const success = 121;
    return ok({
      connectorId: params.id, windowDays: days, total, success, failed: total - success,
      successRate: Math.round((success / total) * 1000) / 1000, avgDurationMs: 86,
    });
  }),

  // 最近调用记录（demo）
  mock(workflowConnectorContract.invocations, ({ params, query, ok }) => {
    const exists = mockWorkflowConnectors.some((x) => x.id === params.id);
    if (!exists) return notFound('连接器不存在', { status: 404 });
    const limit = query.limit ?? 20;
    const sources: WorkflowConnectorInvocation['source'][] = ['test', 'trigger', 'external', 'webhook'];
    const rows: WorkflowConnectorInvocation[] = Array.from({ length: Math.min(limit, 12) }, (_, i) => {
      const succeeded = i % 5 !== 0;
      return {
        id: 1000 - i, source: sources[i % sources.length], ok: succeeded,
        status: succeeded ? 200 : 500, durationMs: 40 + ((i * 13) % 200),
        requestUrl: `https://api.example.com/endpoint/${i}`,
        error: succeeded ? null : 'HTTP 500 Internal Server Error',
        createdAt: mockDateTimeOffset(-i * 3_600_000),
      };
    });
    return ok(rows);
  }),

  mock(workflowConnectorContract.detail, ({ params, ok }) => {
    const item = mockWorkflowConnectors.find((x) => x.id === params.id);
    if (!item) return notFound('连接器不存在', { status: 404 });
    return ok(item);
  }),

  mock(workflowConnectorContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const { credentials, ...rest } = body;
    const item: WorkflowConnector = {
      id: getNextConnectorId(),
      ...rest,
      description: rest.description ?? null,
      hasCredentials: hasCred(credentials),
      breakerState: 'closed',
      tenantId: null,
      createdBy: null,
      updatedBy: null,
      createdAt: now,
      updatedAt: now,
    };
    mockWorkflowConnectors.push(item);
    return ok(item, '创建成功');
  }),

  mock(workflowConnectorContract.update, ({ params, body, ok }) => {
    const idx = mockWorkflowConnectors.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('连接器不存在', { status: 404 });
    const cur = mockWorkflowConnectors[idx];
    const { credentials, clearCredentials, ...patch } = body;
    const next: WorkflowConnector = {
      ...cur,
      ...patch,
      description: patch.description !== undefined ? patch.description ?? null : cur.description,
      hasCredentials: clearCredentials ? false : (hasCred(credentials) || cur.hasCredentials),
      updatedAt: mockDateTime(),
    };
    mockWorkflowConnectors[idx] = next;
    return ok(next, '更新成功');
  }),

  mock(workflowConnectorContract.remove, ({ params, ok }) => {
    const idx = mockWorkflowConnectors.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('连接器不存在', { status: 404 });
    mockWorkflowConnectors.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
