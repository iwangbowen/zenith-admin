import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from '../../middleware/auth';
import { namedRateLimit } from '../../middleware/rate-limit';
import { validationHook } from '../../lib/openapi-schemas';
import {
  ensureConversationOwner,
  getHistoryMessages,
  hasTrailingUserMessage,
  saveAssistantMessage,
  saveMessages,
} from '../../services/ai/ai-conversations.service';
import { generateConversationTitle, streamAiChat } from '../../services/ai/ai-chat.service';
import { recordAiRequest, recordAiError } from '../../lib/ai/reliability';
import { getDailyTokensUsed, addDailyTokensUsed } from '../../lib/ai/quota';
import { getConfigNumber } from '../../lib/system-config';
import { currentUser } from '../../lib/context';
import { z } from 'zod';

const router = new OpenAPIHono({ defaultHook: validationHook });

const SendMessageBody = z.object({
  message: z.string().min(1).max(8192).optional(),
  /** 重新生成模式：不追加/保存新的 user 消息，基于现有历史重新回答（历史末条必须是 user 消息） */
  regenerate: z.boolean().optional(),
  configSource: z.enum(['system', 'user']).optional(),
  configId: z.number().int().positive().optional(),
}).refine((d) => d.regenerate || !!d.message?.trim(), { message: '消息不能为空' });

/**
 * POST /api/ai/conversations/:id/chat
 * SSE 流式对话接口 —— 不走 openapiRoutes，使用原生 Hono streamSSE
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

  const { message, regenerate, configSource, configId } = parsed.data;

  // 验证对话归属
  let conversation: Awaited<ReturnType<typeof ensureConversationOwner>>;
  try {
    conversation = await ensureConversationOwner(id);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status ?? 403;
    const msg = (err as { message?: string }).message ?? '无权访问此对话';
    return c.json({ code: status, message: msg, data: null }, status as 401 | 403 | 404);
  }

  // 重新生成：要求历史末条是 user 消息（旧 assistant 回复应已由前端删除）
  if (regenerate && !(await hasTrailingUserMessage(id))) {
    return c.json({ code: 400, message: '没有可重新生成的用户消息，请先删除旧回复', data: null }, 400);
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

  return streamSSE(c, async (stream) => {
    let assistantContent = '';
    let reasoningContent = '';
    let tokensInput = 0;
    let tokensOutput = 0;
    let snapshot: { provider: string; model: string; configId?: number } | null = null;
    let aborted = false;
    let errored = false;
    const startedAt = Date.now();
    let firstTokenAt: number | null = null;
    recordAiRequest();

    // 客户端断开 / 主动停止生成时，中断上游 LLM 请求（节省 token）
    const ac = new AbortController();
    stream.onAbort(() => { aborted = true; ac.abort(); });
    const rawSignal = c.req.raw.signal;
    if (rawSignal) {
      if (rawSignal.aborted) { aborted = true; ac.abort(); }
      else rawSignal.addEventListener('abort', () => { aborted = true; ac.abort(); });
    }

    try {
      // 加载历史消息（按 token 预算裁剪）；重新生成时历史已含末条 user 消息，不再追加
      const history = await getHistoryMessages(id);
      const messages = regenerate ? history : [...history, { role: 'user' as const, content: message! }];

      for await (const chunk of streamAiChat(messages, configSource, configId, { signal: ac.signal, systemPromptOverride: conversation.systemPromptOverride })) {
        if (chunk.type === 'delta') {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          assistantContent += chunk.content;
          if ('snapshot' in chunk && chunk.snapshot) {
            snapshot = chunk.snapshot;
          }
          await stream.writeSSE({
            event: 'delta',
            data: JSON.stringify({ content: chunk.content }),
          });
        } else if (chunk.type === 'reasoning') {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          reasoningContent += chunk.content;
          await stream.writeSSE({
            event: 'reasoning',
            data: JSON.stringify({ content: chunk.content }),
          });
        } else if (chunk.type === 'done') {
          tokensInput = chunk.tokensInput;
          tokensOutput = chunk.tokensOutput;
          if ('snapshot' in chunk && chunk.snapshot) {
            snapshot = chunk.snapshot;
          }
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({ tokensInput, tokensOutput }),
          });
        } else if (chunk.type === 'error') {
          errored = true;
          recordAiError();
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ message: chunk.error }),
          });
          // 中途出错时跳出循环，已生成的部分内容仍走下方保存逻辑
          break;
        }
      }
    } catch (err: unknown) {
      // 主动中断：静默结束，下方仍会保存已生成的部分内容
      if (!aborted && !ac.signal.aborted) {
        errored = true;
        recordAiError();
        const msg = err instanceof Error ? err.message : '对话失败';
        await stream.writeSSE({ event: 'error', data: JSON.stringify({ message: msg }) }).catch(() => {});
        if (!assistantContent) return;
      }
    }

    // 保存消息 & 更新标题（即使被中断/出错，也保存已生成的部分回复）
    if (assistantContent) {
      const meta = {
        reasoning: reasoningContent || null,
        ttftMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
        durationMs: Date.now() - startedAt,
      };
      const { assistantMsgId } = regenerate
        ? await saveAssistantMessage(id, assistantContent, tokensInput, tokensOutput, snapshot, meta)
        : await saveMessages(id, message!, assistantContent, tokensInput, tokensOutput, snapshot, meta);

      // 累计每日配额用量
      if (tokensInput + tokensOutput > 0) {
        addDailyTokensUsed(user.userId, tokensInput + tokensOutput);
      }

      // 发送包含数据库消息 ID 的 saved 事件，前端用它更新 message.id 以便点赞/点踩调 API
      if (assistantMsgId) {
        await stream.writeSSE({
          event: 'saved',
          data: JSON.stringify({ assistantMsgId }),
        }).catch(() => {});
      }

      // 首轮完成后自动生成对话标题（LLM 总结，失败回退前 30 字），并通知前端
      if (!regenerate && !errored && conversation.title === '新对话') {
        const title = await generateConversationTitle(id, message!, assistantContent).catch(() => null);
        if (title) {
          await stream.writeSSE({
            event: 'title',
            data: JSON.stringify({ title }),
          }).catch(() => {});
        }
      }
    }
  });
});

export default router;
