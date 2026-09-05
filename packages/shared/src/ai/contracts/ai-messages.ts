import * as z from 'zod';
import { AI_FEEDBACK_STATUSES, AI_MESSAGE_ROLES, AI_TRACE_STEP_TYPES } from '../constants';

/**
 * 对话消息实体与其嵌套值对象；管理端反馈 / 审计列表复用消息实体并附加会话与用户信息。
 */

/** 生成调用链 trace 步骤（检索 / 工具执行 / LLM 轮次 / 降级切换耗时明细） */
export const aiTraceStepSchema = z.object({
  type: z.enum(AI_TRACE_STEP_TYPES).meta({ description: '步骤类型' }),
  label: z.string().meta({ description: '步骤说明' }),
  durationMs: z.number().meta({ description: '耗时（毫秒）' }),
  meta: z.record(z.string(), z.unknown()).optional().meta({ description: '附加信息' }),
}).meta({ id: 'AiTraceStep' });

export type AiTraceStep = z.infer<typeof aiTraceStepSchema>;

/** assistant 消息的工具调用记录（展示用途,与 SSE tool_call 事件同构） */
export const aiToolCallRecordSchema = z.object({
  name: z.string(),
  arguments: z.string(),
  result: z.string(),
}).meta({ id: 'AiToolCallRecord' });

export type AiToolCallRecord = z.infer<typeof aiToolCallRecordSchema>;

/** 知识库检索引用（展示用途,与 SSE references 事件同构） */
export const aiKbReferenceSchema = z.object({
  docName: z.string(),
  content: z.string(),
  score: z.number(),
}).meta({ id: 'AiKbReference' });

export type AiKbReference = z.infer<typeof aiKbReferenceSchema>;

export const aiMessageSchema = z.object({
  id: z.int(),
  conversationId: z.int(),
  parentId: z.int().nullable().meta({ description: '分支树父消息 ID（null = 根消息）' }),
  role: z.enum(AI_MESSAGE_ROLES),
  content: z.string(),
  reasoning: z.string().nullable().meta({ description: '推理模型的思维链内容（reasoning_content）' }),
  model: z.string().nullable().meta({ description: '生成所用模型' }),
  tokensInput: z.int(),
  tokensOutput: z.int(),
  ttftMs: z.int().nullable().meta({ description: '首字延迟（毫秒）' }),
  durationMs: z.int().nullable().meta({ description: '本次生成总耗时（毫秒）' }),
  feedback: z.int().nullable().meta({ description: '用户反馈：1 = 点赞, -1 = 点踩, null = 未反馈' }),
  feedbackReason: z.string().nullable().meta({ description: '点踩原因' }),
  feedbackStatus: z.enum(AI_FEEDBACK_STATUSES).nullable().meta({ description: '反馈处理状态' }),
  feedbackRemark: z.string().nullable().meta({ description: '处理备注' }),
  feedbackHandledAt: z.string().nullable().meta({ description: '处理时间' }),
  trace: z.array(aiTraceStepSchema).nullable().meta({ description: '生成调用链 trace（assistant 消息）' }),
  toolCalls: z.array(aiToolCallRecordSchema).nullable().meta({ description: '工具调用过程（assistant 消息,刷新后仍可展示）' }),
  references: z.array(aiKbReferenceSchema).nullable().meta({ description: '知识库检索引用（assistant 消息,刷新后仍可展示）' }),
  images: z.array(z.string()).nullable().meta({ description: '用户消息附带的图片（managed file id 数组，经 /api/files/{id}/content 访问）' }),
  createdAt: z.string(),
}).meta({ id: 'AiMessage' });

export type AiMessage = z.infer<typeof aiMessageSchema>;

/** 管理端反馈 / 审计列表条目：消息 + 反馈人 / 会话 / 前置提问上下文 */
export const aiFeedbackItemSchema = aiMessageSchema.extend({
  userId: z.int().nullable().meta({ description: '反馈用户 ID' }),
  username: z.string().nullable().meta({ description: '反馈用户名' }),
  nickname: z.string().nullable().meta({ description: '反馈用户昵称' }),
  conversationTitle: z.string().nullable().meta({ description: '所属对话标题' }),
  question: z.string().nullable().meta({ description: '该条 AI 回复之前最近一条用户提问（审计列表不返回，恒为 null）' }),
}).meta({ id: 'AiFeedbackItem' });

export type AiFeedbackItem = z.infer<typeof aiFeedbackItemSchema>;

/** 反馈 / 审计消息的会话上下文（目标消息前后若干条） */
export const aiFeedbackContextSchema = z.object({
  conversationId: z.int(),
  conversationTitle: z.string().nullable(),
  targetMsgId: z.int(),
  user: z.object({
    id: z.int(),
    username: z.string(),
    nickname: z.string().nullable(),
    avatar: z.string().nullable(),
  }).nullable().meta({ description: '会话属主（发送人）' }),
  messages: z.array(aiMessageSchema).meta({ description: '目标消息前后的上下文消息' }),
}).meta({ id: 'AiFeedbackContext' });

export type AiFeedbackContext = z.infer<typeof aiFeedbackContextSchema>;

// ─── 路径参数 ────────────────────────────────────────────────────────────────

/** `{msgId}` 消息 ID（管理端反馈 / 审计上下文） */
export const aiMessageIdParam = z.object({
  msgId: z.coerce.number().int().positive().meta({ description: '消息 ID', example: 1 }),
});
