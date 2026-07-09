import { desc } from 'drizzle-orm';
import { USER_FEEDBACK_CATEGORY_LABELS, USER_FEEDBACK_STATUS_LABELS } from '@zenith/shared';
import { db } from '../../../db';
import { userFeedbacks } from '../../../db/schema';
import { defineExport } from '../registry';
import type { ExportColumn } from '../types';

const CATEGORY_LABELS: Record<string, string> = USER_FEEDBACK_CATEGORY_LABELS;

const STATUS_LABELS: Record<string, string> = USER_FEEDBACK_STATUS_LABELS;

const columns: ExportColumn[] = [
  { key: 'id', header: 'ID', width: 8, type: 'number' },
  { key: 'userNickname', header: '提交人', width: 14 },
  { key: 'score', header: '评分', width: 8, type: 'number' },
  { key: 'category', header: '分类', width: 12 },
  { key: 'content', header: '反馈内容', width: 40 },
  { key: 'pagePath', header: '来源页面', width: 20 },
  { key: 'status', header: '状态', width: 10 },
  { key: 'handlerNickname', header: '处理人', width: 14 },
  { key: 'handleRemark', header: '处理备注', width: 24 },
  { key: 'handledAt', header: '处理时间', width: 22, type: 'datetime' },
  { key: 'createdAt', header: '提交时间', width: 22, type: 'datetime' },
];

export const userFeedbacksExportDefinition = defineExport({
  entity: 'system.userFeedbacks',
  moduleName: '意见反馈',
  filenamePrefix: '意见反馈',
  sourcePath: '/system/feedbacks',
  sheetName: '意见反馈',
  permissions: { export: 'system:feedback:list' },
  execution: { mode: 'sync', syncModeOverridesAsyncPolicies: true },
  retention: { normalDays: 7, sensitiveDays: 7, rawDays: 7 },
  columns,
  countRows: async () => db.$count(userFeedbacks),
  streamRows: async () => {
    const rows = await db.query.userFeedbacks.findMany({
      with: {
        user: { columns: { nickname: true } },
        handler: { columns: { nickname: true } },
      },
      orderBy: desc(userFeedbacks.id),
    });
    return rows.map((r) => ({
      ...r,
      userNickname: r.user?.nickname ?? '',
      handlerNickname: r.handler?.nickname ?? '',
      category: CATEGORY_LABELS[r.category] ?? r.category,
      status: STATUS_LABELS[r.status] ?? r.status,
    }));
  },
});
