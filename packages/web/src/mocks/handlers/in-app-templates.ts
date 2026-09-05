import { inAppTemplateContract } from '@zenith/shared/messaging';
import type { InAppTemplate } from '@zenith/shared/messaging';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockInAppTemplates, getNextInAppTemplateId } from '@/mocks/data/in-app-templates';
import { mockDateTime } from '@/mocks/utils/date';

export const inAppTemplatesHandlers = [
  mock(inAppTemplateContract.list, ({ query, ok, paginate }) => {
    const filtered = mockInAppTemplates.filter((t) => {
      if (query.keyword && !t.name.includes(query.keyword) && !t.code.includes(query.keyword) && !t.title.includes(query.keyword)) return false;
      if (query.type && t.type !== query.type) return false;
      if (query.status && t.status !== query.status) return false;
      return true;
    });
    return ok(paginate(filtered));
  }),

  mock(inAppTemplateContract.detail, ({ params, ok }) => {
    const t = mockInAppTemplates.find((x) => x.id === params.id);
    if (!t) return notFound('站内信模板不存在', { status: 404 });
    return ok(t);
  }),

  mock(inAppTemplateContract.create, ({ body, ok }) => {
    if (mockInAppTemplates.some((t) => t.code === body.code)) {
      return badRequest('模板编码已存在', { status: 400 });
    }
    const now = mockDateTime();
    const item: InAppTemplate = {
      id: getNextInAppTemplateId(),
      name: body.name,
      code: body.code,
      title: body.title,
      content: body.content,
      type: body.type,
      variables: body.variables ?? null,
      status: body.status,
      remark: body.remark ?? null,
      createdAt: now,
      updatedAt: now,
    };
    mockInAppTemplates.push(item);
    return ok(item, '创建成功');
  }),

  mock(inAppTemplateContract.update, ({ params, body, ok }) => {
    const t = mockInAppTemplates.find((x) => x.id === params.id);
    if (!t) return notFound('站内信模板不存在', { status: 404 });
    Object.assign(t, body, { id: t.id, code: t.code, updatedAt: mockDateTime() });
    return ok(t, '更新成功');
  }),

  mock(inAppTemplateContract.remove, ({ params, ok }) => {
    const idx = mockInAppTemplates.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('站内信模板不存在', { status: 404 });
    mockInAppTemplates.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];