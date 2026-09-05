import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { aiConversationContract } from '@zenith/shared/ai';
import { authMiddleware } from '../../middleware/auth';
import { namedRateLimit } from '../../middleware/rate-limit';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, validationHook } from '../../lib/openapi-schemas';
import { ensureConversationOwner, hasTrailingUserMessage } from '../../services/ai/ai-conversations.service';
import { runGeneration } from '../../services/ai/ai-generation.service';
import { newGenerationId, initGeneration, getActiveGeneration } from '../../lib/ai/generation-buffer';
import { tailGenerationToSSE } from './ai-generations';
import { getDailyTokensUsed } from '../../lib/ai/quota';
import { checkSensitiveContent } from '../../lib/ai/content-filter';
import { getSettings } from '../../lib/settings';
import { currentUser } from '../../lib/context';
import logger from '../../lib/logger';

const router = new OpenAPIHono({ defaultHook: validationHook });

/** 同一对话并发生成 / 每日 token 配额用尽 */
const rateLimitedResponse = {
  429: { content: jsonContent(ErrorResponse), description: '该对话正在生成回复，或今日 AI 用量已达上限' },
} as const;

/**
 * SSE 流式对话接口 —— 生成与连接解耦：生成任务后台运行并写入 Redis 缓冲，
 * 本接口启动生成后 tail 缓冲透传；断线后可通过 `aiGenerationContract.stream` 续传。
 */
const chat = defineContractRoute(aiConversationContract.chat, {
  middleware: [authMiddleware, namedRateLimit('ai_chat_send')],
  responses: rateLimitedResponse,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { message, regenerate, parentMsgId, configSource, configId, model, reasoning, images } = c.req.valid('json');

    // 验证对话归属（不存在 404 / 非本人 403，由全局错误处理转标准信封）
    const conversation = await ensureConversationOwner(id);

    // 同一对话同时只允许一个生成任务
    const running = await getActiveGeneration(id);
    if (running) {
      return c.json(errBody('该对话正在生成回复，请先停止或等待完成', 429), 429);
    }

    // 重新生成：要求激活路径末条是 user 消息
    if (regenerate && !(await hasTrailingUserMessage(id, conversation.activeLeafMsgId))) {
      return c.json(errBody('没有可重新生成的用户消息'), 400);
    }

    // 输入侧敏感词过滤（开关 + 字典词库）
    if (message) {
      const hit = await checkSensitiveContent(message);
      if (hit) {
        return c.json(errBody('消息包含敏感内容，已被拦截'), 400);
      }
    }

    // 每用户每日 token 配额（0 = 不限制）
    const user = currentUser();
    const dailyQuota = (await getSettings('ai')).dailyTokenQuota;
    if (dailyQuota > 0) {
      const used = await getDailyTokensUsed(user.userId);
      if (used >= dailyQuota) {
        return c.json(errBody(`今日 AI 用量已达上限（${dailyQuota.toLocaleString()} tokens），请明天再试`, 429), 429);
      }
    }

    // 启动解耦生成任务（不随响应结束而中断）
    const genId = newGenerationId();
    await initGeneration(genId, id, user.userId);
    void runGeneration({
      genId,
      conversation,
      userId: user.userId,
      message,
      regenerate,
      parentMsgId,
      configSource,
      configId,
      model,
      reasoning,
      images,
    }).catch((err) => logger.error('[ai-chat] generation crashed', err));

    return streamSSE(c, async (stream) => {
      // 先下发 genId，前端据此实现停止（cancel）与断线续传（resume）
      await stream.writeSSE({ event: 'gen', data: JSON.stringify({ genId }) });
      await tailGenerationToSSE(stream, genId, 0);
    });
  },
});

router.openapiRoutes([chat] as const);

export default router;
