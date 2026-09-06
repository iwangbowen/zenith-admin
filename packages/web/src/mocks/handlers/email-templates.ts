import { emailTemplateContract } from '@zenith/shared/messaging';
import type { EmailTemplate } from '@zenith/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { requireItem, removeByIds } from '@/mocks/utils/crud';
import { badRequest } from '@/mocks/utils/handlers';
import { mockEmailTemplates, getNextEmailTemplateId } from '@/mocks/data/email-templates';
import { mockDateTime } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

export const emailTemplatesHandlers = [
  mock(emailTemplateContract.list, ({ query, ok, paginate }) => {
    const filtered = mockEmailTemplates.filter((t) => {
      if (query.keyword && !includesKeyword(query.keyword, t.name, t.code, t.subject)) return false;
      if (query.status && t.status !== query.status) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  mock(emailTemplateContract.detail, ({ params, ok }) => {
    const t = requireItem(mockEmailTemplates, params.id, '邮件模板不存在', { status: 404 });
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
    const t = requireItem(mockEmailTemplates, params.id, '邮件模板不存在', { status: 404 });
    Object.assign(t, body, { id: t.id, code: t.code, updatedAt: mockDateTime() });
    return ok(t, '更新成功');
  }),

  mock(emailTemplateContract.remove, ({ params, ok }) => {
    requireItem(mockEmailTemplates, params.id, '邮件模板不存在', { status: 404 });
    removeByIds(mockEmailTemplates, [params.id]);
    return ok(null, '删除成功');
  }),
];
