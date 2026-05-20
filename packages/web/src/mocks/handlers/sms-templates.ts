import { http, HttpResponse } from 'msw';
import { mockSmsTemplates, getNextSmsTemplateId } from '@/mocks/data/sms-templates';
import { mockDateTime } from '@/mocks/utils/date';
import type { SmsTemplate } from '@zenith/shared';

export const smsTemplatesHandlers = [
  http.get('/api/sms-templates', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const provider = url.searchParams.get('provider') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const filtered = mockSmsTemplates.filter((t) => {
      if (keyword && !t.name.includes(keyword) && !t.code.includes(keyword) && !t.templateCode.includes(keyword)) return false;
      if (provider && t.provider !== provider) return false;
      if (status && t.status !== status) return false;
      return true;
    });
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.get('/api/sms-templates/:id', ({ params }) => {
    const t = mockSmsTemplates.find((x) => x.id === Number(params.id));
    if (!t) return HttpResponse.json({ code: 404, message: '短信模板不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: t });
  }),

  http.post('/api/sms-templates', async ({ request }) => {
    const body = await request.json() as Partial<SmsTemplate>;
    if (mockSmsTemplates.some((t) => t.code === body.code)) {
      return HttpResponse.json({ code: 400, message: '模板编码已存在', data: null }, { status: 400 });
    }
    const now = mockDateTime();
    const item: SmsTemplate = {
      id: getNextSmsTemplateId(),
      name: body.name ?? '',
      code: body.code ?? '',
      templateCode: body.templateCode ?? '',
      signName: body.signName ?? '',
      content: body.content ?? '',
      variables: body.variables ?? null,
      provider: body.provider ?? 'aliyun',
      status: body.status ?? 'enabled',
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockSmsTemplates.push(item);
    return HttpResponse.json({ code: 0, message: '创建成功', data: item });
  }),

  http.put('/api/sms-templates/:id', async ({ params, request }) => {
    const t = mockSmsTemplates.find((x) => x.id === Number(params.id));
    if (!t) return HttpResponse.json({ code: 404, message: '短信模板不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<SmsTemplate>;
    Object.assign(t, body, { id: t.id, code: t.code, updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: t });
  }),

  http.delete('/api/sms-templates/:id', ({ params }) => {
    const idx = mockSmsTemplates.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '短信模板不存在', data: null }, { status: 404 });
    mockSmsTemplates.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
