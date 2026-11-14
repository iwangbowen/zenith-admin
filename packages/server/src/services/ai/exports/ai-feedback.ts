import { aiFeedbackFilterQuery } from '@zenith/shared/ai';
import { listFeedbackMessages } from '../ai-conversations.service';
import { defineExport } from '../../../lib/export-center/registry';
export const aiFeedbackExportDefinition = defineExport({
  entity: 'ai.feedback', moduleName: 'AI反馈', filenamePrefix: 'AI反馈', sourcePath: '/ai/feedback', permissions: { export: 'ai:feedback:view' },
  prepareQuery: async query => aiFeedbackFilterQuery.parse(query),
  columns: [
    { key: 'id', header: '消息ID', type: 'number' }, { key: 'feedback', header: '反馈', enumMap: { '1': '点赞', '-1': '点踩' } },
    { key: 'feedbackStatus', header: '状态', enumMap: { pending: '待处理', resolved: '已处理', ignored: '已忽略' } },
    { key: 'model', header: '模型' }, { key: 'username', header: '用户', sensitive: true }, { key: 'conversationTitle', header: '对话标题', sensitive: true },
    { key: 'question', header: '用户提问', sensitive: true }, { key: 'content', header: 'AI回复', sensitive: true }, { key: 'feedbackReason', header: '原因', sensitive: true },
    { key: 'feedbackRemark', header: '处理备注', sensitive: true }, { key: 'createdAt', header: '反馈时间', type: 'datetime' },
  ],
  countRows: async query => (await listFeedbackMessages({ ...aiFeedbackFilterQuery.parse(query), page: 1, pageSize: 1 })).total,
  streamRows: async function* (query) {
    for (let page = 1; ; page++) {
      const result = await listFeedbackMessages({ ...aiFeedbackFilterQuery.parse(query), page, pageSize: 1000 });
      yield* result.list;
      if (result.list.length < 1000) return;
    }
  },
});

