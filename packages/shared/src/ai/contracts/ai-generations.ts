import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const aiGenerationIdParam = z.object({
  genId: z.string().min(1).meta({ description: '生成任务 ID（由 SSE gen 事件下发）' }),
});

export const aiGenerationStreamQuery = z.object({
  offset: z.coerce.number().int().min(0).default(0).meta({ description: '已接收的事件数，从该偏移继续接收' }),
});

// ─── 契约：生成任务（生成与连接解耦） ──────────────────────────────────────────

export const aiGenerationContract = defineContract('/api/ai/generations', {
  stream: op.get('/{genId}/stream', {
    params: aiGenerationIdParam,
    query: aiGenerationStreamQuery,
    kind: 'sse',
    response: z.string(),
    summary: 'SSE 恢复流：断线 / 刷新后从指定 offset 继续接收生成事件',
  }),
  cancel: op.post('/{genId}/cancel', { params: aiGenerationIdParam, summary: '停止生成（保存已生成部分）' }),
}, { tags: ['AI'] });
