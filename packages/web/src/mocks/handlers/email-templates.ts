import { http, HttpResponse } from 'msw';
import { mockEmailTemplates, getNextEmailTemplateId } from '@/mocks/data/email-templates';
import { mockDateTime } from '@/mocks/utils/date';
import type { EmailTemplate } from '@zenith/shared';

export const emailTemplatesHandlers = [
  http.get('/api/email-templates', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const filtered = mockEmailTemplates.filter((t) => {
      if (keyword && !t.name.includes(keyword) && !t.code.includes(keyword) && !t.subject.includes(keyword)) return false;
      if (status && t.status !== status) return false;
      return true;
    });
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.get('/api/email-templates/:id', ({ params }) => {
    const t = mockEmailTemplates.find((x) => x.id === Number(params.id));
    if (!t) return HttpResponse.json({ code: 404, message: '邮件模板不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: t });
  }),

  http.post('/api/email-templates', async ({ request }) => {
    const body = await request.json() as Partial<EmailTemplate>;
    if (mockEmailTemplates.some((t) => t.code === body.code)) {
      return HttpResponse.json({ code: 400, message: '模板编码已存在', data: null }, { status: 400 });
    }
    const now = mockDateTime();
    const item: EmailTemplate = {
      id: getNextEmailTemplateId(),
      name: body.name ?? '',
      code: body.code ?? '',
      subject: body.subject ?? '',
      content: body.content ?? '',
      variables: body.variables ?? null,
      status: body.status ?? 'enabled',
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockEmailTemplates.push(item);
    return HttpResponse.json({ code: 0, message: '创建成功', data: item });
  }),

  http.put('/api/email-templates/:id', async ({ params, request }) => {
    const t = mockEmailTemplates.find((x) => x.id === Number(params.id));
    if (!t) return HttpResponse.json({ code: 404, message: '邮件模板不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<EmailTemplate>;
    Object.assign(t, body, { id: t.id, code: t.code, updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: t });
  }),

  http.delete('/api/email-templates/:id', ({ params }) => {
    const idx = mockEmailTemplates.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '邮件模板不存在', data: null }, { status: 404 });
    mockEmailTemplates.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
