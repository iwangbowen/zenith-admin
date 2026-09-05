import { smsSendLogContract } from '@zenith/shared/messaging';
import type { SmsSendLog } from '@zenith/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockSmsSendLogs, getNextSmsSendLogId } from '@/mocks/data/sms-send-logs';
import { mockSmsTemplates } from '@/mocks/data/sms-templates';
import { mockDateTime } from '@/mocks/utils/date';

export const smsSendLogsHandlers = [
  mock(smsSendLogContract.list, ({ query, ok, paginate }) => {
    const filtered = mockSmsSendLogs.filter((l) => {
      if (query.keyword && !l.phone.includes(query.keyword) && !(l.templateName ?? '').includes(query.keyword)) return false;
      if (query.phone && !l.phone.includes(query.phone)) return false;
      if (query.provider && l.provider !== query.provider) return false;
      if (query.status && l.status !== query.status) return false;
      if (query.source && l.source !== query.source) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  mock(smsSendLogContract.remove, ({ params, ok }) => {
    const idx = mockSmsSendLogs.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('记录不存在', { status: 404 });
    mockSmsSendLogs.splice(idx, 1);
    return ok(null, '删除成功');
  }),

  mock(smsSendLogContract.testSend, ({ body, ok }) => {
    const tpl = mockSmsTemplates.find((t) => t.id === body.templateId);
    if (!tpl) return notFound('短信模板不存在', { status: 404 });
    const now = mockDateTime();
    const log: SmsSendLog = {
      id: getNextSmsSendLogId(),
      configId: 1,
      configName: '阿里云默认',
      templateId: tpl.id,
      templateName: tpl.name,
      provider: tpl.provider,
      phone: body.phone,
      content: tpl.content,
      status: 'success',
      errorMsg: null,
      bizId: `demo-${Date.now()}`,
      deliveryStatus: 'DELIVRD',
      deliveredAt: now,
      source: 'test',
      userId: 1,
      username: '管理员',
      ip: '127.0.0.1',
      sentAt: now,
      createdAt: now,
    };
    mockSmsSendLogs.unshift(log);
    return ok({ logId: log.id, status: log.status, bizId: log.bizId, errorMsg: null }, '发送成功');
  }),
];