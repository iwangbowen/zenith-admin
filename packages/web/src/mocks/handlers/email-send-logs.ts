import { http, HttpResponse } from 'msw';
import { mockEmailSendLogs, getNextEmailSendLogId } from '@/mocks/data/email-send-logs';
import { mockEmailTemplates } from '@/mocks/data/email-templates';
import { mockDateTime } from '@/mocks/utils/date';
import type { EmailSendLog } from '@zenith/shared';

export const emailSendLogsHandlers = [
  http.get('/api/email-send-logs', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const toEmail = url.searchParams.get('toEmail') ?? '';
    const status = url.searchParams.get('status') ?? '';
    const source = url.searchParams.get('source') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const filtered = mockEmailSendLogs.filter((l) => {
      if (keyword && !l.subject.includes(keyword) && !l.toEmail.includes(keyword)) return false;
      if (toEmail && !l.toEmail.includes(toEmail)) return false;
      if (status && l.status !== status) return false;
      if (source && l.source !== source) return false;
      return true;
    });
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.get('/api/email-send-logs/:id', ({ params }) => {
    const l = mockEmailSendLogs.find((x) => x.id === Number(params.id));
    if (!l) return HttpResponse.json({ code: 404, message: '记录不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: l });
  }),

  http.delete('/api/email-send-logs/:id', ({ params }) => {
    const idx = mockEmailSendLogs.findIndex((x) => x.id === Number(params.id));
    if (idx === -1) return HttpResponse.json({ code: 404, message: '记录不存在', data: null }, { status: 404 });
    mockEmailSendLogs.splice(idx, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  http.delete('/api/email-send-logs/batch', async ({ request }) => {
    const body = await request.json() as { ids: number[] };
    const ids = new Set(body.ids ?? []);
    let count = 0;
    for (let i = mockEmailSendLogs.length - 1; i >= 0; i--) {
      if (ids.has(mockEmailSendLogs[i].id)) {
        mockEmailSendLogs.splice(i, 1);
        count++;
      }
    }
    return HttpResponse.json({ code: 0, message: `已删除 ${count} 条记录`, data: null });
  }),

  http.post('/api/email-send-logs/test', async ({ request }) => {
    const body = await request.json() as { templateId?: number; toEmail: string; subject?: string; content?: string };
    const tpl = body.templateId ? mockEmailTemplates.find((t) => t.id === body.templateId) : null;
    const now = mockDateTime();
    const log: EmailSendLog = {
      id: getNextEmailSendLogId(),
      templateId: tpl?.id ?? null,
      templateName: tpl?.name ?? null,
      toEmail: body.toEmail,
      subject: body.subject ?? tpl?.subject ?? '测试邮件',
      content: body.content ?? tpl?.content ?? '',
      status: 'success',
      errorMsg: null,
      source: 'test',
      userId: 1,
      userName: '管理员',
      ip: '127.0.0.1',
      sentAt: now,
      createdAt: now,
    };
    mockEmailSendLogs.unshift(log);
    return HttpResponse.json({ code: 0, message: '测试发送成功', data: { success: true, status: 'success', logId: log.id } });
  }),

  http.get('/api/email-send-logs/export', () => {
    return HttpResponse.json({ code: 0, message: '演示模式不支持导出', data: null });
  }),
];
