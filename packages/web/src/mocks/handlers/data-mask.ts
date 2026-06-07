import { http, HttpResponse } from 'msw';
import { mockDataMaskConfigs, createMockDataMaskConfig } from '@/mocks/data/data-mask';
import { mockDateTime } from '@/mocks/utils/date';
import type { DataMaskConfig } from '@zenith/shared';

export const dataMaskHandlers = [
  // 列表（分页+关键词）
  http.get('/api/data-mask-configs', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const keyword = url.searchParams.get('keyword') ?? '';

    let list = [...mockDataMaskConfigs];
    if (keyword) {
      const kw = keyword.toLowerCase();
      list = list.filter((r) =>
        r.entity.toLowerCase().includes(kw) || r.field.toLowerCase().includes(kw) || r.label.toLowerCase().includes(kw),
      );
    }
    const total = list.length;
    const paged = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list: paged, total, page, pageSize } });
  }),

  // 创建
  http.post('/api/data-mask-configs', async ({ request }) => {
    const body = await request.json() as Partial<DataMaskConfig>;
    const dup = mockDataMaskConfigs.find((r) => r.entity === body.entity && r.field === body.field);
    if (dup) {
      return HttpResponse.json({ code: 400, message: `实体 ${body.entity} 的字段 ${body.field} 脱敏规则已存在`, data: null }, { status: 400 });
    }
    const created = createMockDataMaskConfig(body);
    mockDataMaskConfigs.push(created);
    return HttpResponse.json({ code: 0, message: '创建成功', data: created });
  }),

  // 更新
  http.put('/api/data-mask-configs/:id', async ({ params, request }) => {
    const id = Number(params.id);
    const idx = mockDataMaskConfigs.findIndex((r) => r.id === id);
    if (idx < 0) return HttpResponse.json({ code: 404, message: '规则不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<DataMaskConfig>;
    mockDataMaskConfigs[idx] = { ...mockDataMaskConfigs[idx], ...body, id, updatedAt: mockDateTime() };
    return HttpResponse.json({ code: 0, message: '更新成功', data: mockDataMaskConfigs[idx] });
  }),

  // 删除
  http.delete('/api/data-mask-configs/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = mockDataMaskConfigs.findIndex((r) => r.id === id);
    if (idx < 0) return HttpResponse.json({ code: 404, message: '规则不存在', data: null }, { status: 404 });
    mockDataMaskConfigs.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
