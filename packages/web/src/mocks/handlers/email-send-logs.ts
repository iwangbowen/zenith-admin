import { emailSendLogContract } from '@zenith/shared/messaging';
import type { EmailSendLog } from '@zenith/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockEmailSendLogs, getNextEmailSendLogId } from '@/mocks/data/email-send-logs';
import { mockEmailTemplates } from '@/mocks/data/email-templates';
import { mockDateTime } from '@/mocks/utils/date';

export const emailSendLogsHandlers = [
  mock(emailSendLogContract.list, ({ query, ok, paginate }) => {
    const filtered = mockEmailSendLogs.filter((l) => {
      if (query.keyword && !l.subject.includes(query.keyword) && !l.toEmail.includes(query.keyword)) return false;
      if (query.toEmail && !l.toEmail.includes(query.toEmail)) return false;
      if (query.status && l.status !== query.status) return false;
      if (query.source && l.source !== query.source) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  mock(emailSendLogContract.remove, ({ params, ok }) => {
    const idx = mockEmailSendLogs.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('记录不存在', { status: 404 });
    mockEmailSendLogs.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  mock(emailSendLogContract.testSend, ({ body, ok }) => {
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
      username: '管理员',
      ip: '127.0.0.1',
      sentAt: now,
      createdAt: now,
    };
    mockEmailSendLogs.unshift(log);
    return ok({ logId: log.id, status: log.status, errorMsg: null }, '发送成功');
  }),
];