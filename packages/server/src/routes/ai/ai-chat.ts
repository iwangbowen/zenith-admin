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
import { retrieveKbContext } from '../../services/ai/ai-knowledge.service';
import { recordAiRequest, recordAiError } from '../../lib/ai/reliability';
import { getDailyTokensUsed, addDailyTokensUsed } from '../../lib/ai/quota';
import { checkSensitiveContent } from '../../lib/ai/content-filter';
import { getConfigNumber } from '../../lib/system-config';
import { currentUser } from '../../lib/context';
import type { ChatMessage, ChatMessagePart } from '../../lib/ai/factory';
import { z } from 'zod';

const router = new OpenAPIHono({ defaultHook: validationHook });

const SendMessageBody = z.object({
  message: z.string().min(1).max(8192).optional(),
  /** 重新生成模式：不追加/保存新的 user 消息，基于现有历史重新回答（历史末条必须是 user 消息） */
  regenerate: z.boolean().optional(),
  configSource: z.enum(['system', 'user']).optional(),
  configId: z.number().int().positive().optional(),
  /** 多模型配置下选择的具体模型 */
  model: z.string().max(100).optional(),
  /** vision 图片（data URL，base64），仅当轮上下文生效 */
  images: z.array(z.string().max(4_000_000).regex(/^data:image\//, '仅支持 data:image 格式')).max(3).optional(),
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

  const { message, regenerate, configSource, configId, model, images } = parsed.data;

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

      // 知识库检索：挂载知识库时按提问检索 top 分块注入上下文，并把引用推给前端
      let kbPrefix = '';
      const queryText = message ?? '';
      if (conversation.knowledgeBaseId && queryText) {
        const refs = await retrieveKbContext(conversation.knowledgeBaseId, user.userId, queryText).catch(() => []);
        if (refs.length > 0) {
          kbPrefix = `请优先基于以下知识库内容回答（如无相关内容请如实说明）：\n\n${refs
            .map((r, i) => `【${i + 1}】来自《${r.docName}》：\n${r.content}`)
            .join('\n\n')}\n\n---\n\n`;
          await stream.writeSSE({
            event: 'references',
            data: JSON.stringify({
              references: refs.map((r) => ({ docName: r.docName, content: r.content.slice(0, 200), score: r.score })),
            }),
          });
        }
      }

      // vision：图片 + 文本组成 OpenAI 多模态 content 数组（仅当轮生效，不落库）
      let userContent: ChatMessage['content'] = kbPrefix + queryText;
      if (images && images.length > 0) {
        const parts: ChatMessagePart[] = [
          { type: 'text', text: kbPrefix + queryText },
          ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        ];
        userContent = parts;
      }

      const messages: ChatMessage[] = regenerate ? history : [...history, { role: 'user', content: userContent }];

      for await (const chunk of streamAiChat(messages, configSource, configId, { signal: ac.signal, systemPromptOverride: conversation.systemPromptOverride, model })) {
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
        } else if (chunk.type === 'tool_result') {
          // function calling：把工具执行过程推给前端展示
          await stream.writeSSE({
            event: 'tool_call',
            data: JSON.stringify({ name: chunk.name, arguments: chunk.arguments, result: chunk.result.slice(0, 2000) }),
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
      const { userMsgId, assistantMsgId } = regenerate
        ? { userMsgId: null, ...(await saveAssistantMessage(id, assistantContent, tokensInput, tokensOutput, snapshot, meta)) }
        : await saveMessages(id, (images?.length ? `[图片 ×${images.length}] ` : '') + message!, assistantContent, tokensInput, tokensOutput, snapshot, meta);

      // 累计每日配额用量
      if (tokensInput + tokensOutput > 0) {
        addDailyTokensUsed(user.userId, tokensInput + tokensOutput);
      }

      // 发送包含数据库消息 ID 的 saved 事件，前端用它更新本地消息 ID（点赞/编辑/删除依赖真实 ID）
      if (assistantMsgId) {
        await stream.writeSSE({
          event: 'saved',
          data: JSON.stringify({ assistantMsgId, userMsgId }),
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
