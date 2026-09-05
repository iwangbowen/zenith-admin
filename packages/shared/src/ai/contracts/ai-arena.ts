import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { arenaChatSchema, arenaVoteSchema } from '../validation';

// ─── 契约：多模型对比（Arena） ────────────────────────────────────────────────

export const aiArenaContract = defineContract('/api/ai/arena', {
  chat: op.post('/chat', {
    body: arenaChatSchema,
    kind: 'sse',
    response: z.string(),
    summary: '多模型对比单栏流式（不落库、不带历史；前端并行调用两次）',
  }),
  vote: op.post('/vote', { body: arenaVoteSchema, summary: '提交多模型对比投票' }),
}, { tags: ['AI'] });
