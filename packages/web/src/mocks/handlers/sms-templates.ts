import { smsTemplateContract } from '@zenith/shared/messaging';
import type { SmsTemplate } from '@zenith/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockSmsTemplates, getNextSmsTemplateId } from '@/mocks/data/sms-templates';
import { mockDateTime } from '@/mocks/utils/date';

export const smsTemplatesHandlers = [
  mock(smsTemplateContract.list, ({ query, ok, paginate }) => {
    const filtered = mockSmsTemplates.filter((t) => {
      if (query.keyword && !t.name.includes(query.keyword) && !t.code.includes(query.keyword) && !t.templateCode.includes(query.keyword)) return false;
      if (query.provider && t.provider !== query.provider) return false;
      if (query.status && t.status !== query.status) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  mock(smsTemplateContract.detail, ({ params, ok }) => {
    const t = mockSmsTemplates.find((x) => x.id === params.id);
    if (!t) return notFound('短信模板不存在', { status: 404 });
    return ok(t);
  }),

  mock(smsTemplateContract.create, ({ body, ok }) => {
    if (mockSmsTemplates.some((t) => t.code === body.code)) {
      return badRequest('模板编码已存在', { status: 400 });
    }
    const now = mockDateTime();
    const item: SmsTemplate = {
      id: getNextSmsTemplateId(),
      name: body.name,
      code: body.code,
      templateCode: body.templateCode,
      signName: body.signName ?? null,
      content: body.content,
      variables: body.variables ?? null,
      provider: body.provider,
      status: body.status,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockSmsTemplates.push(item);
    return ok(item, '创建成功');
  }),

  mock(smsTemplateContract.update, ({ params, body, ok }) => {
    const t = mockSmsTemplates.find((x) => x.id === params.id);
    if (!t) return notFound('短信模板不存在', { status: 404 });
    Object.assign(t, body, { id: t.id, code: t.code, updatedAt: mockDateTime() });
    return ok(t, '更新成功');
  }),

  mock(smsTemplateContract.remove, ({ params, ok }) => {
    const idx = mockSmsTemplates.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('短信模板不存在', { status: 404 });
    mockSmsTemplates.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];