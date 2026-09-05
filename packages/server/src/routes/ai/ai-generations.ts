import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import type { SSEStreamingApi } from 'hono/streaming';
import { aiGenerationContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { defineContractRoute } from '../../lib/contract-route';
import { errBody, okBody, validationHook } from '../../lib/openapi-schemas';
import { currentUser } from '../../lib/context';
import {
  getGenerationMeta,
  readGenEvents,
  requestCancelGeneration,
} from '../../lib/ai/generation-buffer';

const router = new OpenAPIHono({ defaultHook: validationHook });

const authed = [authMiddleware] as const;

/** tail 轮询间隔（毫秒） */
const POLL_INTERVAL = 150;
/** tail 最长持续时间（毫秒），防孤儿连接 */
const TAIL_MAX_MS = 10 * 60 * 1000;

/**
 * 把生成缓冲中 offset 起的事件透传到 SSE 流，直到生成完成且事件读尽。
 * 客户端断开时静默停止（生成本身不受影响）。
 */
export async function tailGenerationToSSE(stream: SSEStreamingApi, genId: string, startOffset: number, signal?: AbortSignal): Promise<void> {
  let offset = startOffset;
  const deadline = Date.now() + TAIL_MAX_MS;
  let clientGone = false;
  stream.onAbort(() => { clientGone = true; });

  while (!clientGone && !signal?.aborted && Date.now() < deadline) {
    const events = await readGenEvents(genId, offset);
    for (const ev of events) {
      await stream.writeSSE({ event: ev.event, data: ev.data });
    }
    offset += events.length;
    const meta = await getGenerationMeta(genId);
    if (!meta || meta.status !== 'running') {
      // 生成已结束：读尽残余事件后退出
      const rest = await readGenEvents(genId, offset);
      for (const ev of rest) {
        await stream.writeSSE({ event: ev.event, data: ev.data });
      }
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL));
  }
}

/** SSE 恢复流：断线 / 刷新后从指定 offset 继续接收生成事件 */
const stream = defineContractRoute(aiGenerationContract.stream, {
  middleware: authed,
  handler: async (c) => {
    const { genId } = c.req.valid('param');
    const { offset } = c.req.valid('query');
    const meta = await getGenerationMeta(genId);
    const user = currentUser();
    if (!meta || meta.userId !== user.userId) {
      return c.json(errBody('生成任务不存在或已过期', 404), 404);
    }
    return streamSSE(c, async (sse) => {
      await sse.writeSSE({ event: 'gen', data: JSON.stringify({ genId, resumed: true }) });
      await tailGenerationToSSE(sse, genId, offset);
    });
  },
});

/** 停止生成（生成与连接解耦后，前端"停止"按钮走此端点） */
const cancel = defineContractRoute(aiGenerationContract.cancel, {
  middleware: authed,
  handler: async (c) => {
    const { genId } = c.req.valid('param');
    const user = currentUser();
    const ok = await requestCancelGeneration(genId, user.userId);
    if (!ok) {
      return c.json(errBody('生成任务不存在或已结束', 404), 404);
    }
    return c.json(okBody(null, '已停止'), 200);
  },
});

router.openapiRoutes([stream, cancel] as const);

export default router;
