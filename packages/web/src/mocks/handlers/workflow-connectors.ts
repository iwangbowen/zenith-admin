import { http, HttpResponse } from 'msw';
import { mockWorkflowConnectors, getNextConnectorId } from '../data/workflow-connectors';
import { mockDateTime } from '../utils/date';
import type { WorkflowConnector } from '@zenith/shared';

interface ConnectorBody {
  name?: string; code?: string; description?: string | null; type?: WorkflowConnector['type'];
  config?: Record<string, unknown>; credentials?: Record<string, string>; clearCredentials?: boolean;
  timeoutMs?: number; retryMax?: number; circuitBreakerEnabled?: boolean; failureThreshold?: number; cooldownSec?: number;
  status?: 'enabled' | 'disabled';
}

const hasCred = (c?: Record<string, string>) => !!c && Object.values(c).some((v) => v != null && v !== '');

export const workflowConnectorsHandlers = [
  // 分页列表
  http.get('/api/workflows/connectors', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') || '';
    const type = url.searchParams.get('type') || '';
    const status = url.searchParams.get('status') || '';
    let list = [...mockWorkflowConnectors];
    if (keyword) list = list.filter((x) => x.name.includes(keyword) || x.code.includes(keyword));
    if (type) list = list.filter((x) => x.type === type);
    if (status) list = list.filter((x) => x.status === status);
    const total = list.length;
    const sliced = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list: sliced, total, page, pageSize } });
  }),

  // 测试调用（demo 返回成功探测结果）
  http.post('/api/workflows/connectors/:id/test', () =>
    HttpResponse.json({ code: 0, message: 'ok', data: { ok: true, status: 200, durationMs: 42, responseSnippet: '{"demo":true,"args":{}}', error: null } })),

  // 详情
  http.get('/api/workflows/connectors/:id', ({ params }) => {
    const item = mockWorkflowConnectors.find((x) => x.id === Number(params.id));
    if (!item) return HttpResponse.json({ code: 404, message: '连接器不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: item });
  }),

  // 创建
  http.post('/api/workflows/connectors', async ({ request }) => {
    const body = (await request.json()) as ConnectorBody;
    const now = mockDateTime();
    const item: WorkflowConnector = {
      id: getNextConnectorId(), name: body.name ?? '', code: body.code ?? '', description: body.description ?? null,
      type: body.type ?? 'http', config: body.config ?? {}, timeoutMs: body.timeoutMs ?? 10000, retryMax: body.retryMax ?? 0,
      circuitBreakerEnabled: body.circuitBreakerEnabled ?? true, failureThreshold: body.failureThreshold ?? 5, cooldownSec: body.cooldownSec ?? 60,
      status: body.status ?? 'enabled', hasCredentials: hasCred(body.credentials), breakerState: 'closed', tenantId: null, createdBy: null, updatedBy: null,
      createdAt: now, updatedAt: now,
    };
    mockWorkflowConnectors.push(item);
    return HttpResponse.json({ code: 0, message: '创建成功', data: item });
  }),

  // 更新
  http.put('/api/workflows/connectors/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as ConnectorBody;
    const idx = mockWorkflowConnectors.findIndex((x) => x.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '连接器不存在', data: null }, { status: 404 });
    const cur = mockWorkflowConnectors[idx];
    const next: WorkflowConnector = {
      ...cur,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.code !== undefined ? { code: body.code } : {}),
      ...(body.description !== undefined ? { description: body.description ?? null } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
      ...(body.config !== undefined ? { config: body.config } : {}),
      ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}),
      ...(body.retryMax !== undefined ? { retryMax: body.retryMax } : {}),
      ...(body.circuitBreakerEnabled !== undefined ? { circuitBreakerEnabled: body.circuitBreakerEnabled } : {}),
      ...(body.failureThreshold !== undefined ? { failureThreshold: body.failureThreshold } : {}),
      ...(body.cooldownSec !== undefined ? { cooldownSec: body.cooldownSec } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      hasCredentials: body.clearCredentials ? false : (hasCred(body.credentials) || cur.hasCredentials),
      updatedAt: mockDateTime(),
    };
    mockWorkflowConnectors[idx] = next;
    return HttpResponse.json({ code: 0, message: '更新成功', data: next });
  }),

  // 删除
  http.delete('/api/workflows/connectors/:id', ({ params }) => {
    const idx = mockWorkflowConnectors.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '连接器不存在', data: null }, { status: 404 });
    mockWorkflowConnectors.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
