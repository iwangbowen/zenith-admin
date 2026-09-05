import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { AI_MESSAGE_ROLES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 分享页只读消息（不暴露用户信息与反馈字段） */
export const aiSharedMessageSchema = z.object({
  id: z.int(),
  role: z.enum(AI_MESSAGE_ROLES),
  content: z.string(),
  reasoning: z.string().nullable(),
  model: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'AiSharedMessage' });

export type AiSharedMessage = z.infer<typeof aiSharedMessageSchema>;

/** 按分享 token 读取的只读对话 */
export const aiSharedConversationSchema = z.object({
  title: z.string().meta({ description: '对话标题' }),
  sharedAt: z.string().meta({ description: '分享时间' }),
  messages: z.array(aiSharedMessageSchema).meta({ description: '只读消息列表' }),
}).meta({ id: 'AiSharedConversation' });

export type AiSharedConversation = z.infer<typeof aiSharedConversationSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const aiShareTokenParam = z.object({
  token: z.string().min(8).max(64).meta({ description: '分享 token' }),
});

// ─── 契约：公开访问（无需登录） ────────────────────────────────────────────────

export const aiPublicContract = defineContract('/api/ai/public', {
  sharedConversation: op.get('/chat/{token}', {
    params: aiShareTokenParam,
    response: aiSharedConversationSchema,
    public: true,
    summary: '按分享 token 读取只读对话（公开，无需登录）',
  }),
}, { tags: ['AI'] });
