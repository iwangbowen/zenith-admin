import * as z from 'zod';
import { batchIdsBody, dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { USER_FEEDBACK_CATEGORIES, USER_FEEDBACK_STATUSES } from '../constants';
import { createUserFeedbackSchema, handleUserFeedbackSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const userFeedbackSchema = z.object({
  id: z.int(),
  userId: z.int(),
  userNickname: z.string().nullable().meta({ description: '提交人昵称（JOIN 后附加）' }),
  score: z.int().min(1).max(5).nullable().meta({ description: '满意度评分 1-5，可空', example: 5 }),
  category: z.enum(USER_FEEDBACK_CATEGORIES),
  content: z.string().nullable().meta({ example: '希望增加深色模式的自动切换' }),
  pagePath: z.string().nullable().meta({ description: '提交时所在页面路由', example: '/system/users' }),
  replayId: z.string().nullable().meta({ description: '提交时活跃的会话回放 ID（反馈联动）' }),
  status: z.enum(USER_FEEDBACK_STATUSES),
  handleRemark: z.string().nullable(),
  handledBy: z.int().nullable(),
  handlerNickname: z.string().nullable().meta({ description: '处理人昵称（JOIN 后附加）' }),
  handledAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'UserFeedback' });

export type UserFeedback = z.infer<typeof userFeedbackSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const userFeedbackListQuery = paginationQuery.extend({
  keyword: z.string().optional().meta({ description: '按反馈内容模糊匹配' }),
  category: z.enum(USER_FEEDBACK_CATEGORIES).optional(),
  status: z.enum(USER_FEEDBACK_STATUSES).optional(),
  startTime: dateRangeBound('提交时间起'),
  endTime: dateRangeBound('提交时间止'),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const userFeedbackContract = defineContract('/api/feedbacks', {
  submit: op.post('/', { body: createUserFeedbackSchema, response: userFeedbackSchema, summary: '提交意见反馈' }),
  list: op.get('/', { query: userFeedbackListQuery, response: paginated(userFeedbackSchema), summary: '反馈列表' }),
  handle: op.put('/{id}/handle', { params: idParam, body: handleUserFeedbackSchema, response: userFeedbackSchema, summary: '处理反馈' }),
  removeBatch: op.delete('/batch', { body: batchIdsBody, summary: '批量删除反馈' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除反馈' }),
}, { tags: ['意见反馈'] });
