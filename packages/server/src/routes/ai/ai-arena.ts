import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { aiArenaContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { namedRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { streamAiChat } from '../../services/ai/ai-chat.service';
import { recordArenaVote } from '../../services/ai/ai-arena.service';
import { recordAiRequest, recordAiError } from '../../lib/ai/reliability';
import { addDailyTokensUsed, getDailyTokensUsed } from '../../lib/ai/quota';
import { checkSensitiveContent } from '../../lib/ai/content-filter';
import { getSettings } from '../../lib/settings';
import { currentUser } from '../../lib/context';

const router = new OpenAPIHono({ defaultHook: validationHook });

const authed = [authMiddleware] as const;

const rateLimitedResponse = {
  429: { content: jsonContent(ErrorResponse), description: '今日 AI 用量已达上限' },
} as const;

/** 多模型对比单栏流式（不落库、不带历史；前端并行调用两次） */
const chat = defineContractRoute(aiArenaContract.chat, {
  middleware: [authMiddleware, namedRateLimit('ai_chat_send')],
  responses: rateLimitedResponse,
  handler: async (c) => {
    const { message, configId, model } = c.req.valid('json');

    const hit = await checkSensitiveContent(message);
    if (hit) return c.json(errBody('消息包含敏感内容，已被拦截'), 400);

    const user = currentUser();
    const dailyQuota = (await getSettings('ai')).dailyTokenQuota;
    if (dailyQuota > 0 && (await getDailyTokensUsed(user.userId)) >= dailyQuota) {
      return c.json(errBody('今日 AI 用量已达上限，请明天再试', 429), 429);
    }

    return streamSSE(c, async (stream) => {
      recordAiRequest();
      const ac = new AbortController();
      stream.onAbort(() => ac.abort());
      let tokens = 0;
      try {
        for await (const chunk of streamAiChat(
          [{ role: 'user', content: message }],
          'system',
          configId,
          { signal: ac.signal, model, enableTools: false },
        )) {
          if (chunk.type === 'delta') {
            await stream.writeSSE({ event: 'delta', data: JSON.stringify({ content: chunk.content }) });
          } else if (chunk.type === 'reasoning') {
            await stream.writeSSE({ event: 'reasoning', data: JSON.stringify({ content: chunk.content }) });
          } else if (chunk.type === 'done') {
            tokens = chunk.tokensInput + chunk.tokensOutput;
            await stream.writeSSE({ event: 'done', data: JSON.stringify({ tokensInput: chunk.tokensInput, tokensOutput: chunk.tokensOutput }) });
          } else if (chunk.type === 'error') {
            recordAiError();
            await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: chunk.error }) });
            return;
          }
        }
      } catch (err) {
        if (!ac.signal.aborted) {
          recordAiError();
          const msg = err instanceof Error ? err.message : '对话失败';
          await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: msg }) }).catch(() => {});
        }
      } finally {
        if (tokens > 0) addDailyTokensUsed(user.userId, tokens);
      }
    });
  },
});

const vote = defineContractRoute(aiArenaContract.vote, {
  middleware: authed,
  handler: async (c) => {
    await recordArenaVote(c.req.valid('json'));
    return c.json(okBody(null, '感谢投票'), 200);
  },
});

router.openapiRoutes([chat, vote] as const);

export default router;
