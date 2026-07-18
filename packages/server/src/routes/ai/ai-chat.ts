import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from '../../middleware/auth';
import { namedRateLimit } from '../../middleware/rate-limit';
import { validationHook } from '../../lib/openapi-schemas';
import { ensureConversationOwner, hasTrailingUserMessage } from '../../services/ai/ai-conversations.service';
import { runGeneration } from '../../services/ai/ai-generation.service';
import { newGenerationId, initGeneration, getActiveGeneration } from '../../lib/ai/generation-buffer';
import { tailGenerationToSSE } from './ai-generations';
import { getDailyTokensUsed } from '../../lib/ai/quota';
import { checkSensitiveContent } from '../../lib/ai/content-filter';
import { getConfigNumber } from '../../lib/system-config';
import { currentUser } from '../../lib/context';
import logger from '../../lib/logger';
import { z } from 'zod';

const router = new OpenAPIHono({ defaultHook: validationHook });

const SendMessageBody = z.object({
  message: z.string().min(1).max(8192).optional(),
  /** 重新生成模式：不追加/保存新的 user 消息，基于激活路径重新回答（生成 assistant 兄弟分支） */
  regenerate: z.boolean().optional(),
  /** 编辑重发：新 user 消息挂到该父节点形成兄弟分支（null = 作为根消息） */
  parentMsgId: z.number().int().positive().nullable().optional(),
  configSource: z.enum(['system', 'user']).optional(),
  configId: z.number().int().positive().optional(),
  /** 多模型配置下选择的具体模型 */
  model: z.string().max(100).optional(),
  /** vision 图片（data URL，base64），仅当轮上下文生效 */
  images: z.array(z.string().max(4_000_000).regex(/^data:image\//, '仅支持 data:image 格式')).max(3).optional(),
}).refine((d) => d.regenerate || !!d.message?.trim(), { message: '消息不能为空' });

/**
 * POST /api/ai/conversations/:id/chat
 * SSE 流式对话接口 —— 生成与连接解耦：生成任务后台运行并写入 Redis 缓冲，
 * 本接口启动生成后 tail 缓冲透传；断线后可通过 /api/ai/generations/:genId/stream 续传。
 */
router.post('/:id/chat', authMiddleware, namedRateLimit('ai_chat_send'), async (c) => {
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) {
    return c.json({ code: 400, message: '无效的对话 ID', data: null }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ code: 400, message: '请求体格式错误', data: null }, 400);
  }

  const parsed = SendMessageBody.safeParse(body);
  if (!parsed.success) {
    return c.json({ code: 400, message: '消息不能为空', data: null }, 400);
  }

  const { message, regenerate, parentMsgId, configSource, configId, model, images } = parsed.data;

  // 验证对话归属
  let conversation: Awaited<ReturnType<typeof ensureConversationOwner>>;
  try {
    conversation = await ensureConversationOwner(id);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 403;
    const msg = (err as { message?: string }).message ?? '无权访问此对话';
    return c.json({ code: status, message: msg, data: null }, status as 401 | 403 | 404);
  }

  // 同一对话同时只允许一个生成任务
  const running = await getActiveGeneration(id);
  if (running) {
    return c.json({ code: 429, message: '该对话正在生成回复，请先停止或等待完成', data: null }, 429);
  }

  // 重新生成：要求激活路径末条是 user 消息
  if (regenerate && !(await hasTrailingUserMessage(id, conversation.activeLeafMsgId))) {
    return c.json({ code: 400, message: '没有可重新生成的用户消息', data: null }, 400);
  }

  // 输入侧敏感词过滤（开关 + 字典词库）
  if (message) {
    const hit = await checkSensitiveContent(message);
    if (hit) {
      return c.json({ code: 400, message: '消息包含敏感内容，已被拦截', data: null }, 400);
    }
  }

  // 每用户每日 token 配额（0 = 不限制）
  const user = currentUser();
  const dailyQuota = await getConfigNumber('ai_daily_token_quota', 0);
  if (dailyQuota > 0) {
    const used = await getDailyTokensUsed(user.userId);
    if (used >= dailyQuota) {
      return c.json({ code: 429, message: `今日 AI 用量已达上限（${dailyQuota.toLocaleString()} tokens），请明天再试`, data: null }, 429);
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
    images,
  }).catch((err) => logger.error('[ai-chat] generation crashed', err));

  return streamSSE(c, async (stream) => {
    // 先下发 genId，前端据此实现停止（cancel）与断线续传（resume）
    await stream.writeSSE({ event: 'gen', data: JSON.stringify({ genId }) });
    await tailGenerationToSSE(stream, genId, 0);
  });
});

export default router;
