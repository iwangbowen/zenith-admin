import { isWorkflowHttpConnector, validateWorkflowConnectorConfig, workflowConnectorContract } from '@zenith/shared/workflow';
import type { WorkflowConnector, WorkflowConnectorInvocation } from '@zenith/shared/workflow';
import { mock } from '@/mocks/utils/contract';
import { requireItem } from '@/mocks/utils/crud';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockWorkflowConnectors, getNextConnectorId } from '@/mocks/data/workflow-connectors';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';
import { mockResource } from '@/mocks/utils/resource';

const hasCred = (c?: Record<string, string | undefined>) => !!c && Object.values(c).some((v) => v != null && v !== '');

export const workflowConnectorsHandlers = [
  mock(workflowConnectorContract.list, ({ query, ok, paginate }) => {
    let list = [...mockWorkflowConnectors];
    if (query.keyword) list = filterByKeyword(list, query.keyword, [(x) => x.name, (x) => x.code]);
    if (query.type) list = list.filter((x) => x.type === query.type);
    if (query.status) list = list.filter((x) => x.status === query.status);
    return ok(paginate(list));
  }),

  // 测试调用（demo 返回成功探测结果）
  mock(workflowConnectorContract.test, ({ params, ok }) => {
    const connector = requireItem(mockWorkflowConnectors, params.id, '连接器不存在', { status: 404 });
    if (connector.status !== 'enabled') return ok({ ok: false, status: null, durationMs: 0, responseSnippet: null, error: '连接器已禁用' });
    const config = validateWorkflowConnectorConfig(connector.type, connector.config);
    if (!config.success) return ok({ ok: false, status: null, durationMs: 0, responseSnippet: null, error: config.error.issues[0].message });
    return ok({ ok: true, status: 200, durationMs: 42, responseSnippet: '{"demo":true,"args":{}}', error: null });
  }),

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
  ...mockResource(workflowConnectorContract, {
    store: mockWorkflowConnectors,
    notFound: '连接器不存在',
    exclude: ['list', 'create', 'update'],
  }),

  mock(workflowConnectorContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const { credentials, ...rest } = body;
    const config = validateWorkflowConnectorConfig(rest.type, rest.config);
    if (!config.success) return badRequest(config.error.issues[0].message, { status: 400 });
    const item: WorkflowConnector = {
      id: getNextConnectorId(),
      ...rest,
      config: config.data,
      description: rest.description ?? null,
      hasCredentials: isWorkflowHttpConnector(rest.type) && hasCred(credentials),
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
    const cur = requireItem(mockWorkflowConnectors, params.id, '连接器不存在', { status: 404 });
    const { credentials, clearCredentials, ...patch } = body;
    const type = patch.type ?? cur.type;
    const changedConfig = patch.config !== undefined || patch.type !== undefined;
    const parsed = changedConfig || patch.status === 'enabled' ? validateWorkflowConnectorConfig(type, patch.config ?? cur.config) : null;
    if (parsed && !parsed.success) return badRequest(parsed.error.issues[0].message, { status: 400 });
    const next: WorkflowConnector = {
      ...cur,
      ...patch,
      config: changedConfig && parsed?.success ? parsed.data : cur.config,
      description: patch.description !== undefined ? patch.description ?? null : cur.description,
      hasCredentials: !isWorkflowHttpConnector(type) || clearCredentials ? false : (hasCred(credentials) || cur.hasCredentials),
      updatedAt: mockDateTime(),
    };
    Object.assign(cur, next);
    return ok(cur, '更新成功');
  }),
];
