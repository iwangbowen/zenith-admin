import * as z from 'zod';
import { paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { sendMpMessageSchema } from '../../messaging/validation';
import { MP_MESSAGE_DIRECTIONS, MP_MESSAGE_STATUSES, MP_MESSAGE_TYPES } from '../constants';
import { mpAccountIdQuery } from './common';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const mpMessageSchema = z.object({
  id: z.int(),
  accountId: z.int(),
  openid: z.string(),
  direction: z.enum(MP_MESSAGE_DIRECTIONS),
  msgType: z.enum(MP_MESSAGE_TYPES),
  content: z.string().nullable(),
  mediaId: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  event: z.string().nullable().meta({ description: '事件消息的事件类型（subscribe / SCAN 等）' }),
  msgId: z.string().nullable().meta({ description: '微信消息 ID（入站去重键）' }),
  status: z.enum(MP_MESSAGE_STATUSES),
  errorMsg: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'MpMessage' });

export type MpMessage = z.infer<typeof mpMessageSchema>;

/** 会话（按 openid 聚合，含最后一条消息摘要） */
export const mpConversationSchema = z.object({
  openid: z.string(),
  nickname: z.string().nullable(),
  avatar: z.string().nullable(),
  lastContent: z.string().nullable(),
  lastMsgType: z.enum(MP_MESSAGE_TYPES),
  lastDirection: z.enum(MP_MESSAGE_DIRECTIONS),
  lastTime: z.string(),
  messageCount: z.int(),
}).meta({ id: 'MpConversation' });

export type MpConversation = z.infer<typeof mpConversationSchema>;

// ─── 查询参数 ────────────────────────────────────────────────────────────────

export const mpMessageListQuery = paginationQuery.extend({
  ...mpAccountIdQuery.shape,
  openid: z.string().optional().meta({ description: '只看某个粉丝的会话' }),
  direction: z.enum(MP_MESSAGE_DIRECTIONS).optional(),
  msgType: z.enum(MP_MESSAGE_TYPES).optional(),
  keyword: z.string().optional().meta({ description: '按消息内容模糊匹配' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const mpMessageContract = defineContract('/api/mp/messages', {
  conversations: op.get('/conversations', { query: mpAccountIdQuery, response: z.array(mpConversationSchema), summary: '会话列表' }),
  list: op.get('/', { query: mpMessageListQuery, response: paginated(mpMessageSchema), summary: '消息列表' }),
  send: op.post('/send', {
    body: sendMpMessageSchema,
    response: mpMessageSchema,
    summary: '发送客服消息',
    description: '向粉丝下发客服文本消息（需用户最近 48 小时内有交互），成功后落库为出站消息。',
  }),
}, { tags: ['公众号消息'] });
