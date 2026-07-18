import {
  pushGenEvent,
  finishGeneration,
  isCancelRequested,
} from '../../lib/ai/generation-buffer';
import {
  getHistoryMessages,
  saveAssistantMessage,
  saveMessages,
  getActivePathLeafId,
  getActivePathLastUserId,
} from './ai-conversations.service';
import { generateConversationTitle, streamAiChat } from './ai-chat.service';
import { retrieveKbContext } from './ai-knowledge.service';
import { resolveAgentForChat } from './ai-agents.service';
import { recordAiRequest, recordAiError } from '../../lib/ai/reliability';
import { addDailyTokensUsed } from '../../lib/ai/quota';
import logger from '../../lib/logger';
import type { ChatMessage, ChatMessagePart } from '../../lib/ai/factory';
import type { AiConversationRow, AiTraceStep } from '../../db/schema';

export interface StartGenerationParams {
  genId: string;
  conversation: AiConversationRow;
  userId: number;
  message?: string;
  regenerate?: boolean;
  /** 编辑重发：新 user 消息挂到该父节点形成兄弟分支（null = 根；undefined = 普通追加） */
  parentMsgId?: number | null;
  configSource?: 'system' | 'user';
  configId?: number;
  model?: string;
  images?: string[];
}

/** 取消标记轮询节流（毫秒） */
const CANCEL_CHECK_INTERVAL = 800;

/**
 * 执行一次 AI 生成（与客户端连接解耦）：
 * 所有 SSE 事件写入 Redis 缓冲，客户端通过 tail / resume 端点消费；
 * 客户端断开不影响生成，通过 cancel 端点显式停止。
 */
export async function runGeneration(params: StartGenerationParams): Promise<void> {
  const { genId, conversation, userId, message, regenerate, parentMsgId, configSource, configId, model, images } = params;
  const push = (event: string, data: unknown) => pushGenEvent(genId, event, JSON.stringify(data));

  let assistantContent = '';
  let reasoningContent = '';
  let tokensInput = 0;
  let tokensOutput = 0;
  let snapshot: { provider: string; model: string; configId?: number } | null = null;
  let errored = false;
  let cancelled = false;
  const trace: AiTraceStep[] = [];
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  recordAiRequest();

  const ac = new AbortController();
  let lastCancelCheck = 0;
  // 分支树定位：新 user 消息的父节点 & 重新生成时 assistant 的父节点
  let userParentId: number | null = null;
  let regenerateParentId: number | null = null;
  const checkCancel = async () => {
    const now = Date.now();
    if (now - lastCancelCheck < CANCEL_CHECK_INTERVAL) return;
    lastCancelCheck = now;
    if (await isCancelRequested(genId)) {
      cancelled = true;
      ac.abort();
    }
  };
  // 上游停滞时的取消兜底轮询
  const cancelTimer = setInterval(() => { void checkCancel(); }, 1000);

  try {
    // 智能体：解析预设（提示词 / 模型 / 知识库 / 工具集）
    const agent = conversation.agentId ? await resolveAgentForChat(conversation.agentId, userId) : null;

    if (regenerate) {
      regenerateParentId = await getActivePathLastUserId(conversation.id, conversation.activeLeafMsgId);
    } else if (parentMsgId !== undefined) {
      userParentId = parentMsgId;
    } else {
      userParentId = await getActivePathLeafId(conversation.id, conversation.activeLeafMsgId);
    }

    // 加载历史消息（激活路径；编辑重发时取被编辑消息父节点的祖先链）
    const history = await getHistoryMessages(conversation.id, {
      activeLeafMsgId: conversation.activeLeafMsgId,
      upToMsgId: parentMsgId ?? undefined,
    });

    // 知识库检索：优先智能体绑定，其次对话挂载
    let kbPrefix = '';
    const queryText = message ?? '';
    const kbId = agent?.knowledgeBaseId ?? conversation.knowledgeBaseId;
    if (kbId && queryText) {
      const kbStart = Date.now();
      const refs = await retrieveKbContext(kbId, userId, queryText).catch(() => []);
      if (refs.length > 0) {
        trace.push({ type: 'retrieval', label: '知识库检索', durationMs: Date.now() - kbStart, meta: { chunks: refs.length, topScore: refs[0]?.score } });
        kbPrefix = `请优先基于以下知识库内容回答（如无相关内容请如实说明）：\n\n${refs
          .map((r, i) => `【${i + 1}】来自《${r.docName}》：\n${r.content}`)
          .join('\n\n')}\n\n---\n\n`;
        await push('references', {
          references: refs.map((r) => ({ docName: r.docName, content: r.content.slice(0, 200), score: r.score })),
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

    const llmStart = Date.now();
    let toolRounds = 0;
    for await (const chunk of streamAiChat(messages, configSource, agent?.configId ?? configId, {
      signal: ac.signal,
      systemPromptOverride: conversation.systemPromptOverride ?? agent?.systemPrompt ?? null,
      model: agent?.model ?? model,
      temperatureOverride: agent?.temperature ?? null,
      toolFilter: agent ? (agent.tools ?? []) : undefined,
    })) {
      await checkCancel();
      if (cancelled) break;
      if (chunk.type === 'delta') {
        if (firstTokenAt === null) firstTokenAt = Date.now();
        assistantContent += chunk.content;
        if ('snapshot' in chunk && chunk.snapshot) snapshot = chunk.snapshot;
        await push('delta', { content: chunk.content });
      } else if (chunk.type === 'reasoning') {
        if (firstTokenAt === null) firstTokenAt = Date.now();
        reasoningContent += chunk.content;
        await push('reasoning', { content: chunk.content });
      } else if (chunk.type === 'tool_result') {
        toolRounds += 1;
        trace.push({ type: 'tool_call', label: `工具 ${chunk.name}`, durationMs: chunk.durationMs, meta: { arguments: chunk.arguments.slice(0, 500) } });
        await push('tool_call', { name: chunk.name, arguments: chunk.arguments, result: chunk.result.slice(0, 2000) });
      } else if (chunk.type === 'failover') {
        trace.push({ type: 'failover', label: `主备切换 ${chunk.from} → ${chunk.to}`, durationMs: Date.now() - llmStart });
        await push('failover', { from: chunk.from, to: chunk.to });
      } else if (chunk.type === 'done') {
        tokensInput = chunk.tokensInput;
        tokensOutput = chunk.tokensOutput;
        if ('snapshot' in chunk && chunk.snapshot) snapshot = chunk.snapshot;
        await push('done', { tokensInput, tokensOutput });
      } else if (chunk.type === 'error') {
        errored = true;
        recordAiError();
        await push('error', { message: chunk.error });
        // 中途出错时跳出循环，已生成的部分内容仍走下方保存逻辑
        break;
      }
    }
    trace.push({
      type: 'llm_round',
      label: 'LLM 生成',
      durationMs: Date.now() - llmStart,
      meta: { model: snapshot?.model ?? model ?? null, toolCalls: toolRounds, tokensInput, tokensOutput },
    });
  } catch (err: unknown) {
    if (!cancelled && !ac.signal.aborted) {
      errored = true;
      recordAiError();
      const msg = err instanceof Error ? err.message : '对话失败';
      await push('error', { message: msg });
    }
  } finally {
    clearInterval(cancelTimer);
  }

  try {
    // 保存消息 & 更新标题（即使被中断/出错，也保存已生成的部分回复）
    if (assistantContent) {
      const meta = {
        reasoning: reasoningContent || null,
        ttftMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
        durationMs: Date.now() - startedAt,
        trace,
      };
      let userMsgId: number | null = null;
      let assistantMsgId: number | null = null;
      if (regenerate) {
        const saved = await saveAssistantMessage(conversation.id, assistantContent, tokensInput, tokensOutput, snapshot, meta, regenerateParentId);
        assistantMsgId = saved.assistantMsgId;
      } else {
        const saved = await saveMessages(
          conversation.id,
          (images?.length ? `[图片 ×${images.length}] ` : '') + (message ?? ''),
          assistantContent,
          tokensInput,
          tokensOutput,
          snapshot,
          meta,
          userParentId,
        );
        userMsgId = saved.userMsgId;
        assistantMsgId = saved.assistantMsgId;
      }

      if (tokensInput + tokensOutput > 0) {
        addDailyTokensUsed(userId, tokensInput + tokensOutput);
      }

      if (assistantMsgId) {
        await push('saved', { assistantMsgId, userMsgId });
      }

      // 首轮完成后自动生成对话标题（LLM 总结，失败回退前 30 字）
      if (!regenerate && !errored && !cancelled && conversation.title === '新对话') {
        const title = await generateConversationTitle(conversation.id, message ?? '', assistantContent).catch(() => null);
        if (title) await push('title', { title });
      }
    }
  } catch (err) {
    logger.error('[ai-gen] persist failed', err);
    await push('error', { message: '消息保存失败' });
  } finally {
    await finishGeneration(genId, conversation.id);
  }
}
