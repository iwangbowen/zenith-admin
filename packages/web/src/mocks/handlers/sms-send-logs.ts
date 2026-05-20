import { http, HttpResponse } from 'msw';
import { mockSmsSendLogs, getNextSmsSendLogId } from '@/mocks/data/sms-send-logs';
import { mockSmsTemplates } from '@/mocks/data/sms-templates';
import { mockDateTime } from '@/mocks/utils/date';
import type { SmsSendLog } from '@zenith/shared';

export const smsSendLogsHandlers = [
  http.get('/api/sms-send-logs', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const phone = url.searchParams.get('phone') ?? '';
    const provider = url.searchParams.get('provider') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const source = url.searchParams.get('source') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const filtered = mockSmsSendLogs.filter((l) => {
      if (keyword && !l.phone.includes(keyword) && !(l.templateName ?? '').includes(keyword)) return false;
      if (phone && !l.phone.includes(phone)) return false;
      if (provider && l.provider !== provider) return false;
      if (status && l.status !== status) return false;
      if (source && l.source !== source) return false;
      return true;
    });
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.get('/api/sms-send-logs/:id', ({ params }) => {
    const l = mockSmsSendLogs.find((x) => x.id === Number(params.id));
    if (!l) return HttpResponse.json({ code: 404, message: '记录不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: l });
  }),

  http.delete('/api/sms-send-logs/:id', ({ params }) => {
    const idx = mockSmsSendLogs.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '记录不存在', data: null }, { status: 404 });
    mockSmsSendLogs.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  http.delete('/api/sms-send-logs/batch', async ({ request }) => {
    const body = await request.json() as { ids: number[] };
    const ids = new Set(body.ids ?? []);
    let count = 0;
    for (let i = mockSmsSendLogs.length - 1; i >= 0; i--) {
      if (ids.has(mockSmsSendLogs[i].id)) {
        mockSmsSendLogs.splice(i, 1);
        count++;
      }
    }
    return HttpResponse.json({ code: 0, message: `已删除 ${count} 条记录`, data: null });
  }),

  http.post('/api/sms-send-logs/test', async ({ request }) => {
    const body = await request.json() as { templateId?: number; phone: string; variables?: Record<string, string> };
    const tpl = body.templateId ? mockSmsTemplates.find((t) => t.id === body.templateId) : null;
    const now = mockDateTime();
    const log: SmsSendLog = {
      id: getNextSmsSendLogId(),
      configId: 1,
      templateId: tpl?.id ?? null,
      templateName: tpl?.name ?? null,
      provider: tpl?.provider ?? 'aliyun',
      phone: body.phone,
      content: tpl?.content ?? '测试短信',
      status: 'success',
      errorMsg: null,
      bizId: `demo-${Date.now()}`,
      deliveryStatus: 'DELIVRD',
      deliveredAt: now,
      source: 'test',
      userId: 1,
      userName: '管理员',
      ip: '127.0.0.1',
      sentAt: now,
      createdAt: now,
    };
    mockSmsSendLogs.unshift(log);
    return HttpResponse.json({ code: 0, message: '测试发送成功', data: { success: true, status: 'success', logId: log.id } });
  }),

  http.get('/api/sms-send-logs/export', () => {
    return HttpResponse.json({ code: 0, message: '演示模式不支持导出', data: null });
  }),
];
