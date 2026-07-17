import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from '../../middleware/auth';
import { namedRateLimit } from '../../middleware/rate-limit';
import { validationHook, okBody, jsonContent, commonErrorResponses, okMsg } from '../../lib/openapi-schemas';
import { createRoute, defineOpenAPIRoute } from '@hono/zod-openapi';
import { streamAiChat } from '../../services/ai/ai-chat.service';
import { recordArenaVote } from '../../services/ai/ai-arena.service';
import { recordAiRequest, recordAiError } from '../../lib/ai/reliability';
import { addDailyTokensUsed, getDailyTokensUsed } from '../../lib/ai/quota';
import { checkSensitiveContent } from '../../lib/ai/content-filter';
import { getConfigNumber } from '../../lib/system-config';
import { currentUser } from '../../lib/context';
import { arenaVoteSchema } from '@zenith/shared';
import { z } from 'zod';

const router = new OpenAPIHono({ defaultHook: validationHook });

const ArenaChatBody = z.object({
  message: z.string().min(1).max(8192),
  configId: z.number().int().positive(),
  model: z.string().max(100).optional(),
});

/**
 * POST /api/ai/arena/chat —— 多模型对比单栏流式（不落库、不带历史；前端并行调用两次）
 */
router.post('/chat', authMiddleware, namedRateLimit('ai_chat_send'), async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: '请求体格式错误', data: null }, 400);
  }
  const parsed = ArenaChatBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 400, message: '参数错误', data: null }, 400);
  }
  const { message, configId, model } = parsed.data;

  const hit = await checkSensitiveContent(message);
  if (hit) return c.json({ code: 400, message: '消息包含敏感内容，已被拦截', data: null }, 400);

  const user = currentUser();
  const dailyQuota = await getConfigNumber('ai_daily_token_quota', 0);
  if (dailyQuota > 0 && (await getDailyTokensUsed(user.userId)) >= dailyQuota) {
    return c.json({ code: 429, message: '今日 AI 用量已达上限，请明天再试', data: null }, 429);
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
});

const vote = defineOpenAPIRoute({
  route: createRoute({
    method: 'post',
    path: '/vote',
    tags: ['AI'],
    summary: '提交多模型对比投票',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware] as const,
    request: { body: { content: jsonContent(arenaVoteSchema), required: true } },
    responses: { ...commonErrorResponses, ...okMsg('投票成功') },
  }),
  handler: async (c) => {
    await recordArenaVote(c.req.valid('json'));
    return c.json(okBody(null, '感谢投票'), 200);
  },
});

router.openapiRoutes([vote] as const);

export default router;
