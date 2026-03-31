import { http, HttpResponse } from 'msw';
import { mockMessageTemplates, getNextMessageTemplateId } from '@/mocks/data/message-templates';
import type { MessageTemplate } from '@zenith/shared';

function interpolate(content: string, vars: Record<string, string>): string {
  return content.replaceAll(/\{\{(\s*[\w.]+\s*)\}\}/g, (_, key: string) => {
    const k = key.trim();
    return Object.hasOwn(vars, k) ? vars[k] : `{{${k}}}`;
  });
}

export const messageTemplatesHandlers = [
  // 列表
  http.get('/api/message-templates', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const channel = url.searchParams.get('channel') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '10');

    const filtered = mockMessageTemplates.filter((t) => {
      if (keyword && !t.name.includes(keyword) && !t.code.includes(keyword)) return false;
      if (channel && t.channel !== channel) return false;
      if (status && t.status !== status) return false;
      return true;
    });

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const list = filtered.slice(start, start + pageSize);

    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 获取单条
  http.get('/api/message-templates/:id', ({ params }) => {
    const item = mockMessageTemplates.find((t) => t.id === Number(params.id));
    if (!item) return HttpResponse.json({ code: 404, message: '模板不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: item });
  }),

  // 新增
  http.post('/api/message-templates', async ({ request }) => {
    const body = await request.json() as Partial<MessageTemplate>;
    if (mockMessageTemplates.some((t) => t.code === body.code)) {
      return HttpResponse.json({ code: 400, message: '模板编码已存在', data: null });
    }
    const newItem: MessageTemplate = {
      id: getNextMessageTemplateId(),
      name: body.name ?? '',
      code: body.code ?? '',
      channel: body.channel ?? 'email',
      subject: body.subject ?? null,
      content: body.content ?? '',
      variables: body.variables ?? null,
      status: body.status ?? 'active',
      remark: body.remark ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockMessageTemplates.push(newItem);
    return HttpResponse.json({ code: 0, message: '创建成功', data: newItem });
  }),

  // 更新
  http.put('/api/message-templates/:id', async ({ params, request }) => {
    const item = mockMessageTemplates.find((t) => t.id === Number(params.id));
    if (!item) return HttpResponse.json({ code: 404, message: '模板不存在', data: null });
    const body = await request.json() as Partial<MessageTemplate>;
    Object.assign(item, body, { updatedAt: new Date().toISOString() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: item });
  }),

  // 删除
  http.delete('/api/message-templates/:id', ({ params }) => {
    const idx = mockMessageTemplates.findIndex((t) => t.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '模板不存在', data: null });
    mockMessageTemplates.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 预览
  http.post('/api/message-templates/:id/preview', async ({ params, request }) => {
    const item = mockMessageTemplates.find((t) => t.id === Number(params.id));
    if (!item) return HttpResponse.json({ code: 404, message: '模板不存在', data: null });
    const body = await request.json() as { variables: Record<string, string> };
    const vars = body?.variables ?? {};
    const renderedSubject = item.subject ? interpolate(item.subject, vars) : null;
    const renderedContent = interpolate(item.content, vars);
    return HttpResponse.json({ code: 0, message: 'ok', data: { subject: renderedSubject, content: renderedContent } });
  }),
];
