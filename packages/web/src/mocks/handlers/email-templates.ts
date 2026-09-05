import { emailTemplateContract } from '@zenith/shared/messaging';
import type { EmailTemplate } from '@zenith/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockEmailTemplates, getNextEmailTemplateId } from '@/mocks/data/email-templates';
import { mockDateTime } from '@/mocks/utils/date';

export const emailTemplatesHandlers = [
  mock(emailTemplateContract.list, ({ query, ok, paginate }) => {
    const filtered = mockEmailTemplates.filter((t) => {
      if (query.keyword && !t.name.includes(query.keyword) && !t.code.includes(query.keyword) && !t.subject.includes(query.keyword)) return false;
      if (query.status && t.status !== query.status) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  mock(emailTemplateContract.detail, ({ params, ok }) => {
    const t = mockEmailTemplates.find((x) => x.id === params.id);
    if (!t) return notFound('邮件模板不存在', { status: 404 });
    return ok(t);
  }),

  mock(emailTemplateContract.create, ({ body, ok }) => {
    if (mockEmailTemplates.some((t) => t.code === body.code)) {
      return badRequest('模板编码已存在', { status: 400 });
    }
    const now = mockDateTime();
    const item: EmailTemplate = {
      id: getNextEmailTemplateId(),
      name: body.name,
      code: body.code,
      subject: body.subject,
      content: body.content,
      variables: body.variables ?? null,
      status: body.status,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockEmailTemplates.push(item);
    return ok(item, '创建成功');
  }),

  mock(emailTemplateContract.update, ({ params, body, ok }) => {
    const t = mockEmailTemplates.find((x) => x.id === params.id);
    if (!t) return notFound('邮件模板不存在', { status: 404 });
    Object.assign(t, body, { id: t.id, code: t.code, updatedAt: mockDateTime() });
    return ok(t, '更新成功');
  }),

  mock(emailTemplateContract.remove, ({ params, ok }) => {
    const idx = mockEmailTemplates.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('邮件模板不存在', { status: 404 });
    mockEmailTemplates.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];