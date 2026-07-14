import { http, HttpResponse } from 'msw';
import { mockWorkflowDataSources, getNextDataSourceId, MOCK_DATA_SOURCE_OPTIONS } from '../data/workflow-data-sources';
import { mockDateTime } from '../utils/date';

interface DataSourceBody {
  name?: string;
  method?: 'GET' | 'POST';
  url?: string;
  headers?: Record<string, string> | null;
  itemsPath?: string | null;
  valueField?: string;
  labelField?: string;
  keywordParam?: string | null;
  status?: 'enabled' | 'disabled';
  remark?: string | null;
}

export const workflowDataSourcesHandlers = [
  // 代理拉取选项（demo 返回示例数据 + 关键词过滤）
  http.get('/api/workflows/data-sources/:id/options', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') || '';
    const list = keyword
      ? MOCK_DATA_SOURCE_OPTIONS.filter((o) => o.label.toLowerCase().includes(keyword.toLowerCase()))
      : MOCK_DATA_SOURCE_OPTIONS;
    return HttpResponse.json({ code: 0, message: 'ok', data: list });
  }),

  // 按选项值取完整记录（demo 按选项合成示例记录）
  http.get('/api/workflows/data-sources/:id/record', ({ request }) => {
    const url = new URL(request.url);
    const value = url.searchParams.get('value') ?? '';
    const hit = MOCK_DATA_SOURCE_OPTIONS.find((o) => o.value === value);
    const record = hit ? { value: hit.value, label: hit.label, code: hit.value, name: hit.label } : null;
    return HttpResponse.json({ code: 0, message: 'ok', data: record });
  }),

  // 分页列表
  http.get('/api/workflows/data-sources', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') || '';
    const status = url.searchParams.get('status') || '';

    let list = [...mockWorkflowDataSources];
    if (keyword) list = list.filter((x) => x.name.includes(keyword) || x.url.includes(keyword));
    if (status) list = list.filter((x) => x.status === status);

    const total = list.length;
    const sliced = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list: sliced, total, page, pageSize } });
  }),

  // 详情
  http.get('/api/workflows/data-sources/:id', ({ params }) => {
    const id = Number(params.id);
    const item = mockWorkflowDataSources.find((x) => x.id === id);
    if (!item) return HttpResponse.json({ code: 404, message: '数据源不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: item });
  }),

  // 创建
  http.post('/api/workflows/data-sources', async ({ request }) => {
    const body = (await request.json()) as DataSourceBody;
    const now = mockDateTime();
    const item = {
      id: getNextDataSourceId(),
      name: body.name ?? '',
      method: body.method ?? 'GET',
      url: body.url ?? '',
      headers: body.headers ?? null,
      itemsPath: body.itemsPath ?? null,
      valueField: body.valueField ?? '',
      labelField: body.labelField ?? '',
      keywordParam: body.keywordParam ?? null,
      status: body.status ?? 'enabled',
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    } satisfies (typeof mockWorkflowDataSources)[number];
    mockWorkflowDataSources.push(item);
    return HttpResponse.json({ code: 0, message: '创建成功', data: item });
  }),

  // 更新
  http.put('/api/workflows/data-sources/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const body = (await request.json()) as DataSourceBody;
    const idx = mockWorkflowDataSources.findIndex((x) => x.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '数据源不存在', data: null }, { status: 404 });
    Object.assign(mockWorkflowDataSources[idx], { ...body, updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: mockWorkflowDataSources[idx] });
  }),

  // 删除
  http.delete('/api/workflows/data-sources/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = mockWorkflowDataSources.findIndex((x) => x.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '数据源不存在', data: null }, { status: 404 });
    mockWorkflowDataSources.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
