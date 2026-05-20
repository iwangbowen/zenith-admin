import { http, HttpResponse } from 'msw';
import { mockInAppTemplates, getNextInAppTemplateId } from '@/mocks/data/in-app-templates';
import { mockDateTime } from '@/mocks/utils/date';
import type { InAppTemplate } from '@zenith/shared';

export const inAppTemplatesHandlers = [
  http.get('/api/in-app-templates', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const type = url.searchParams.get('type') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const filtered = mockInAppTemplates.filter((t) => {
      if (keyword && !t.name.includes(keyword) && !t.code.includes(keyword) && !t.title.includes(keyword)) return false;
      if (type && t.type !== type) return false;
      if (status && t.status !== status) return false;
      return true;
    });
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.get('/api/in-app-templates/:id', ({ params }) => {
    const t = mockInAppTemplates.find((x) => x.id === Number(params.id));
    if (!t) return HttpResponse.json({ code: 404, message: '站内信模板不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: t });
  }),

  http.post('/api/in-app-templates', async ({ request }) => {
    const body = await request.json() as Partial<InAppTemplate>;
    if (mockInAppTemplates.some((t) => t.code === body.code)) {
      return HttpResponse.json({ code: 400, message: '模板编码已存在', data: null }, { status: 400 });
    }
    const now = mockDateTime();
    const item: InAppTemplate = {
      id: getNextInAppTemplateId(),
      name: body.name ?? '',
      code: body.code ?? '',
      title: body.title ?? '',
      content: body.content ?? '',
      type: body.type ?? 'info',
      variables: body.variables ?? null,
      status: body.status ?? 'enabled',
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockInAppTemplates.push(item);
    return HttpResponse.json({ code: 0, message: '创建成功', data: item });
  }),

  http.put('/api/in-app-templates/:id', async ({ params, request }) => {
    const t = mockInAppTemplates.find((x) => x.id === Number(params.id));
    if (!t) return HttpResponse.json({ code: 404, message: '站内信模板不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<InAppTemplate>;
    Object.assign(t, body, { id: t.id, code: t.code, updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: t });
  }),

  http.delete('/api/in-app-templates/:id', ({ params }) => {
    const idx = mockInAppTemplates.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '站内信模板不存在', data: null }, { status: 404 });
    mockInAppTemplates.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
