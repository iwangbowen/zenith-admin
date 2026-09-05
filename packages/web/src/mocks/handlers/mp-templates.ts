import { mpTemplateContract, type MpTemplateSendLog } from '@zenith/shared/mp';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockMpTemplates, mockMpTemplateLogs, getNextMpTemplateLogId } from '@/mocks/data/mp-templates';
import { mockDateTime } from '@/mocks/utils/date';

export const mpTemplatesHandlers = [
  mock(mpTemplateContract.logs, ({ query, ok, paginate }) => {
    const filtered = mockMpTemplateLogs.filter((l) => l.accountId === query.accountId && (!query.status || l.status === query.status));
    return ok(paginate([...filtered].sort((a, b) => b.id - a.id)));
  }),

  mock(mpTemplateContract.industry, ({ ok }) =>
    ok({ primaryIndustry: { firstClass: 'IT科技', secondClass: '互联网/电子商务' }, secondaryIndustry: { firstClass: 'IT科技', secondClass: 'IT软件与服务' } })),

  mock(mpTemplateContract.setIndustry, ({ ok }) => ok(null, '设置成功')),

  mock(mpTemplateContract.batchSend, ({ body, ok }) => {
    for (const openid of body.openids) {
      mockMpTemplateLogs.push({
        id: getNextMpTemplateLogId(), accountId: body.accountId, templateId: body.templateId, openid,
        data: body.data, url: body.url ?? null, status: 'success', errorMsg: null, msgId: `mock_${Date.now()}_${openid.slice(-4)}`, createdAt: mockDateTime(),
      });
    }
    return ok({ success: body.openids.length, failed: 0, total: body.openids.length }, '已提交批量发送');
  }),

  mock(mpTemplateContract.list, ({ query, ok, paginate }) => {
    const filtered = mockMpTemplates.filter((t) => t.accountId === query.accountId && (!query.keyword || t.title.includes(query.keyword)));
    return ok(paginate(filtered));
  }),

  mock(mpTemplateContract.sync, ({ body, ok }) => {
    const total = mockMpTemplates.filter((t) => t.accountId === body.accountId).length;
    return ok({ success: true, created: 0, updated: total, total }, '同步完成');
  }),

  mock(mpTemplateContract.send, ({ body, ok }) => {
    const log: MpTemplateSendLog = {
      id: getNextMpTemplateLogId(), accountId: body.accountId, templateId: body.templateId, openid: body.openid,
      data: body.data, url: body.url ?? null, status: 'success', errorMsg: null, msgId: `mock_${Date.now()}`, createdAt: mockDateTime(),
    };
    mockMpTemplateLogs.push(log);
    return ok(log, '发送成功');
  }),

  mock(mpTemplateContract.remove, ({ params, ok }) => {
    const idx = mockMpTemplates.findIndex((x) => x.id === params.id);
    if (idx === -1) return notFound('模板不存在', { status: 404 });
    mockMpTemplates.splice(idx, 1);
    return ok(null, '删除成功');
  }),
];
