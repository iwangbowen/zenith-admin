import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { AI_FEEDBACK_STATUSES } from '../constants';
import {
  createAiConversationSchema,
  renameAiConversationSchema,
  sendAiChatMessageSchema,
  setAiActiveLeafSchema,
  setAiConversationKnowledgeBaseSchema,
  setConversationSystemPromptSchema,
  shareAiConversationSchema,
  submitAiFeedbackSchema,
  updateAiConversationTagsSchema,
  updateAiFeedbackStatusSchema,
} from '../validation';
import { aiFeedbackContextSchema, aiFeedbackItemSchema, aiMessageIdParam, aiMessageSchema } from './ai-messages';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const aiConversationSchema = z.object({
  id: z.int(),
  userId: z.int(),
  tenantId: z.int().nullable(),
  title: z.string(),
  providerSnapshot: z.object({
    providerId: z.string(),
    model: z.string(),
    configId: z.int().optional(),
  }).nullable().meta({ description: '供应商快照' }),
  isArchived: z.boolean(),
  isPinned: z.boolean(),
  systemPromptOverride: z.string().nullable().meta({ description: '对话级提示词（角色模板）' }),
  knowledgeBaseId: z.int().nullable().meta({ description: '挂载的知识库 ID' }),
  agentId: z.int().nullable().meta({ description: '关联的智能体 ID' }),
  tags: z.array(z.string()).meta({ description: '用户自定义标签' }),
  activeLeafMsgId: z.int().nullable().meta({ description: '分支树当前激活叶子消息 ID（null = 线性对话）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AiConversation' });

export type AiConversation = z.infer<typeof aiConversationSchema>;

/** 对话分享信息 */
export const aiConversationShareSchema = z.object({
  token: z.string().meta({ description: '分享 token' }),
  url: z.string().meta({ description: '分享页相对路径' }),
  expiresAt: z.string().nullable().meta({ description: '过期时间，null = 永久' }),
  createdAt: z.string(),
}).meta({ id: 'AiConversationShare' });

export type AiConversationShare = z.infer<typeof aiConversationShareSchema>;

export const aiConversationPinStateSchema = z.object({ isPinned: z.boolean() }).meta({ id: 'AiConversationPinState' });

export const aiConversationArchiveStateSchema = z.object({ isArchived: z.boolean() }).meta({ id: 'AiConversationArchiveState' });

export const aiConversationSystemPromptSchema = z.object({
  systemPromptOverride: z.string().nullable(),
}).meta({ id: 'AiConversationSystemPrompt' });

export const aiConversationTagsSchema = z.object({ tags: z.array(z.string()) }).meta({ id: 'AiConversationTags' });

export const aiConversationActiveBranchSchema = z.object({ activeLeafMsgId: z.int() }).meta({ id: 'AiConversationActiveBranch' });

/** 对话进行中的生成任务（刷新后续传入口）；无进行中任务为 null */
export const aiActiveGenerationSchema = z.object({ genId: z.string().nullable() }).meta({ id: 'AiActiveGeneration' });

export type AiActiveGeneration = z.infer<typeof aiActiveGenerationSchema>;

// ─── 路径 / 查询参数 ─────────────────────────────────────────────────────────

/** `{id}` 对话 + `{msgId}` 消息 */
export const aiConversationMessageParams = idParam.extend({
  msgId: z.coerce.number().int().positive().meta({ description: '消息 ID', example: 1 }),
});

export const aiConversationListQuery = z.object({
  archived: z.enum(['true', 'false']).optional().meta({ description: '是否查看已归档对话' }),
  keyword: z.string().max(100).optional().meta({ description: '搜索关键词（匹配标题或消息内容）' }),
  tag: z.string().max(20).optional().meta({ description: '按标签过滤' }),
  limit: z.coerce.number().int().min(1).max(100).optional().meta({ description: '返回条数上限（分页加载）' }),
  offset: z.coerce.number().int().min(0).optional().meta({ description: '偏移量（分页加载）' }),
});

export const aiConversationExportQuery = z.object({
  format: z.enum(['md', 'json']).default('md'),
});

/** 管理端反馈筛选条件（列表与 CSV 导出共用） */
export const aiFeedbackFilterQuery = z.object({
  feedback: z.enum(['1', '-1']).optional().meta({ description: '反馈类型：1=点赞, -1=点踩' }),
  status: z.enum(AI_FEEDBACK_STATUSES).optional().meta({ description: '处理状态筛选' }),
  model: z.string().max(100).optional().meta({ description: '按模型筛选' }),
  startDate: dateRangeBound('反馈时间起（YYYY-MM-DD）'),
  endDate: dateRangeBound('反馈时间止（YYYY-MM-DD）'),
});

export const aiFeedbackListQuery = paginationQuery.extend(aiFeedbackFilterQuery.shape);

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const aiConversationContract = defineContract('/api/ai/conversations', {
  // 对话
  list: op.get('/', { query: aiConversationListQuery, response: z.array(aiConversationSchema), summary: '获取对话列表' }),
  create: op.post('/', { body: createAiConversationSchema, response: aiConversationSchema, summary: '新建对话' }),
  detail: op.get('/{id}', { params: idParam, response: aiConversationSchema, summary: '获取对话详情' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除对话' }),
  messages: op.get('/{id}/messages', { params: idParam, response: z.array(aiMessageSchema), summary: '获取对话消息历史' }),
  rename: op.put('/{id}/rename', { params: idParam, body: renameAiConversationSchema, summary: '重命名对话' }),
  pin: op.put('/{id}/pin', { params: idParam, response: aiConversationPinStateSchema, summary: '置顶/取消置顶对话' }),
  archive: op.put('/{id}/archive', { params: idParam, response: aiConversationArchiveStateSchema, summary: '归档/取消归档对话' }),
  setSystemPrompt: op.put('/{id}/system-prompt', { params: idParam, body: setConversationSystemPromptSchema, response: aiConversationSystemPromptSchema, summary: '设置对话级提示词（角色模板）' }),
  exportFile: op.get('/{id}/export', { params: idParam, query: aiConversationExportQuery, kind: 'file', summary: '导出对话（Markdown / JSON）' }),
  submitFeedback: op.put('/{id}/messages/{msgId}/feedback', { params: aiConversationMessageParams, body: submitAiFeedbackSchema, summary: '提交消息反馈（点赞/点踩）' }),
  removeMessage: op.delete('/{id}/messages/{msgId}', { params: aiConversationMessageParams, summary: '删除 assistant 消息（用于重新生成）' }),
  removeMessageCascade: op.delete('/{id}/messages/{msgId}/cascade', { params: aiConversationMessageParams, summary: '删除消息及其之后所有消息' }),

  // 流式对话：生成与连接解耦，断线后经 /api/ai/generations/{genId}/stream 续传
  chat: op.post('/{id}/chat', {
    params: idParam,
    body: sendAiChatMessageSchema,
    kind: 'sse',
    response: z.string(),
    summary: 'SSE 流式对话（先下发 gen 事件携带 genId，随后透传生成事件）',
  }),

  // 分享 / 知识库挂载 / 标签 / 分支 / 生成续传
  share: op.post('/{id}/share', { params: idParam, body: shareAiConversationSchema, response: aiConversationShareSchema, summary: '创建（或重建）对话分享链接' }),
  shareInfo: op.get('/{id}/share', { params: idParam, response: aiConversationShareSchema.nullable(), summary: '查询对话分享状态（未分享为 null）' }),
  revokeShare: op.delete('/{id}/share', { params: idParam, summary: '取消对话分享' }),
  setKnowledgeBase: op.put('/{id}/knowledge-base', { params: idParam, body: setAiConversationKnowledgeBaseSchema, summary: '设置 / 清除对话挂载的知识库（kbId 传 null 清除）' }),
  setTags: op.put('/{id}/tags', { params: idParam, body: updateAiConversationTagsSchema, response: aiConversationTagsSchema, summary: '更新对话标签' }),
  switchBranch: op.put('/{id}/active-branch', { params: idParam, body: setAiActiveLeafSchema, response: aiConversationActiveBranchSchema, summary: '切换消息分支（以指定消息为起点沿最新子分支下探到叶子并激活）' }),
  activeGeneration: op.get('/{id}/active-generation', { params: idParam, response: aiActiveGenerationSchema, summary: '查询对话进行中的生成任务（刷新后续传入口）' }),

  // 管理端：消息反馈处理
  feedbackList: op.get('/admin/feedback', { query: aiFeedbackListQuery, response: paginated(aiFeedbackItemSchema), summary: '管理员获取消息反馈列表' }),
  feedbackExport: op.get('/admin/feedback/export', { query: aiFeedbackFilterQuery, kind: 'csv', summary: '管理员导出反馈列表 CSV' }),
  feedbackContext: op.get('/admin/feedback/{msgId}/context', { params: aiMessageIdParam, response: aiFeedbackContextSchema, summary: '管理员查看反馈消息的会话上下文' }),
  handleFeedback: op.put('/admin/feedback/{msgId}', { params: aiMessageIdParam, body: updateAiFeedbackStatusSchema, summary: '管理员处理消息反馈（更新状态/备注）' }),
}, { tags: ['AI'] });
