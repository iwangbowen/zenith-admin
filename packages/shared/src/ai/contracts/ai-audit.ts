import * as z from 'zod';
import { dateRangeBound, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { aiFeedbackContextSchema, aiFeedbackItemSchema, aiMessageIdParam } from './ai-messages';

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const aiAuditMessageQuery = paginationQuery.extend({
  keyword: z.string().max(200).optional().meta({ description: '内容关键词' }),
  userId: z.coerce.number().int().positive().optional().meta({ description: '按用户 ID 筛选' }),
  role: z.enum(['user', 'assistant']).optional().meta({ description: '按消息角色筛选' }),
  startDate: dateRangeBound('时间起（YYYY-MM-DD）'),
  endDate: dateRangeBound('时间止（YYYY-MM-DD）'),
});

// ─── 契约：对话内容合规审计（管理员） ─────────────────────────────────────────

export const aiAuditContract = defineContract('/api/ai/audit', {
  messages: op.get('/messages', { query: aiAuditMessageQuery, response: paginated(aiFeedbackItemSchema), summary: '管理员对话内容合规审计检索' }),
  messageContext: op.get('/messages/{msgId}/context', { params: aiMessageIdParam, response: aiFeedbackContextSchema, summary: '管理员查看审计消息的会话上下文' }),
}, { tags: ['AI'] });
