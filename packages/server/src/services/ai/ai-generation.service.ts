import {
  pushGenEvent,
  finishGeneration,
  isCancelRequested,
} from '../../lib/ai/generation-buffer';
import {
  saveAssistantMessage,
  saveMessages,
  getActivePathLeafId,
  getActivePathLastUserId,
  getActivePathRaw,
} from './ai-conversations.service';
import { rebuildThreadMirror } from './ai-memory.service';
import { chatThreadId, chatResourceId } from '../../lib/mastra';
import { generateConversationTitle, streamAiChat } from './ai-chat.service';
import { retrieveKbContext } from './ai-knowledge.service';
import { resolveAgentForChat } from './ai-agents.service';
import { recordAiRequest, recordAiError } from '../../lib/ai/reliability';
import { addDailyTokensUsed } from '../../lib/ai/quota';
import logger from '../../lib/logger';
import type { ChatMessage, ChatMessagePart } from '../../lib/ai/stream-types';
import type { AiReasoningLevel } from '@zenith/shared/ai';
import type { AiConversationRow, AiTraceStep } from '../../db/schema';

/** data:image URL → 统一文件存储,返回 managed file id 数组(失败仅告警,不阻塞消息保存) */
async function persistChatImages(images: string[], userId: number, tenantId: number | null): Promise<string[]> {
  const { saveGeneratedManagedFile } = await import('../files/files.service');
  const ids: string[] = [];
  for (const [i, dataUrl] of images.entries()) {
    try {
      const match = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl);
      if (!match) continue;
      const [, mimeType, base64] = match;
      const ext = (mimeType.split('/')[1] ?? 'png').replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '');
      const saved = await saveGeneratedManagedFile({
        buffer: Buffer.from(base64, 'base64'),
        filename: `ai-chat-${Date.now()}-${i + 1}.${ext}`,
        mimeType,
        tenantId,
        createdBy: userId,
      });
      ids.push(saved.id);
    } catch (err) {
      logger.warn('[ai-generation] persist chat image failed', { userId, index: i, err });
    }
  }
  return ids;
}

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
  /** 推理力度(会话级覆盖,优先级高于智能体/服务商配置) */
  reasoning?: AiReasoningLevel;
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
  const { genId, conversation, userId, message, regenerate, parentMsgId, configSource, configId, model, reasoning, images } = params;
  const push = (event: string, data: unknown) => pushGenEvent(genId, event, JSON.stringify(data));

  let assistantContent = '';
  let reasoningContent = '';
  const collectedToolCalls: { name: string; arguments: string; result: string }[] = [];
  let collectedKbRefs: { docName: string; content: string; score: number }[] | null = null;
  let tokensInput = 0;
  let tokensOutput = 0;
  let snapshot: { providerId: string; model: string; configId?: number } | null = null;
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

    // 分支树定位 + Mastra thread 镜像同步(常态追加零成本;分支操作重建为激活路径)
    let regenerateInput: string | null = null;
    if (regenerate) {
      regenerateParentId = await getActivePathLastUserId(conversation.id, conversation.activeLeafMsgId);
      const path = await getActivePathRaw(conversation.id, { activeLeafMsgId: conversation.activeLeafMsgId });
      for (let i = path.length - 1; i >= 0; i--) {
        if (path[i].role === 'user') { regenerateInput = path[i].content; break; }
      }
      // 回放至最后 user 之前;该 user 消息随后作为本轮输入由 Memory 重新写入
      await rebuildThreadMirror(conversation.id, userId, {
        activeLeafMsgId: conversation.activeLeafMsgId,
        dropFromLastUser: true,
      });
    } else if (parentMsgId !== undefined) {
      userParentId = parentMsgId;
      // 编辑重发:回放至被编辑消息的父节点(含),新 user 输入挂其后
      await rebuildThreadMirror(conversation.id, userId, { upToMsgId: parentMsgId });
    } else {
      userParentId = await getActivePathLeafId(conversation.id, conversation.activeLeafMsgId);
    }

    // 知识库检索：一次性上下文(context),进入本轮请求但不写入记忆与账本
    const contextMessages: ChatMessage[] = [];
    const queryText = message ?? regenerateInput ?? '';
    const kbId = agent?.knowledgeBaseId ?? conversation.knowledgeBaseId;
    if (kbId && queryText) {
      const kbStart = Date.now();
      const refs = await retrieveKbContext(kbId, userId, queryText).catch(() => []);
      if (refs.length > 0) {
        trace.push({ type: 'retrieval', label: '知识库检索', durationMs: Date.now() - kbStart, meta: { chunks: refs.length, topScore: refs[0]?.score } });
        contextMessages.push({
          role: 'system',
          content: `请优先基于以下知识库内容回答用户问题（如无相关内容请如实说明）：\n\n${refs
            .map((r, i) => `【${i + 1}】来自《${r.docName}》：\n${r.content}`)
            .join('\n\n')}`,
        });
        collectedKbRefs = refs.map((r) => ({ docName: r.docName, content: r.content.slice(0, 200), score: r.score }));
        await push('references', { references: collectedKbRefs });
      }
    }

    // vision：图片 + 文本组成多模态 content(记忆与账本均只保留文本主体,图片仅当轮)
    let userContent: ChatMessage['content'] = queryText;
    if (images && images.length > 0) {
      const parts: ChatMessagePart[] = [
        { type: 'text', text: queryText },
        ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
      ];
      userContent = parts;
    }

    // Memory 管理历史:仅传当轮输入(regenerate 时重发最后一条 user 消息)
    const messages: ChatMessage[] = [{ role: 'user', content: userContent }];

    // 用户级 AI 设置:working memory(AI 记忆画像)开关,默认开启
    const { getUserAiSettings } = await import('./ai-user-settings.service');
    const userSettings = await getUserAiSettings(userId);

    const llmStart = Date.now();
    let toolRounds = 0;
    for await (const chunk of streamAiChat(messages, configSource, agent?.configId ?? configId, {
      signal: ac.signal,
      systemPromptOverride: conversation.systemPromptOverride ?? agent?.instructions ?? null,
      model: agent?.model ?? model,
      // 会话级推理力度 > 智能体 modelSettings > 服务商配置默认
      modelSettingsOverride: reasoning
        ? { ...agent?.modelSettings, reasoning }
        : (agent?.modelSettings ?? null),
      toolFilter: agent ? (agent.tools ?? []) : undefined,
      memory: {
        thread: chatThreadId(conversation.id),
        resource: chatResourceId(userId),
        workingMemoryEnabled: userSettings.memory.enabled,
      },
      context: contextMessages,
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
        // 落库与 SSE 同构同截断:刷新/回放后工具调用过程仍可展示
        collectedToolCalls.push({ name: chunk.name, arguments: chunk.arguments, result: chunk.result.slice(0, 2000) });
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
        toolCalls: collectedToolCalls.length > 0 ? collectedToolCalls : null,
        kbReferences: collectedKbRefs,
      };
      let userMsgId: number | null = null;
      let assistantMsgId: number | null = null;
      if (regenerate) {
        const saved = await saveAssistantMessage(conversation.id, assistantContent, tokensInput, tokensOutput, snapshot, meta, regenerateParentId);
        assistantMsgId = saved.assistantMsgId;
      } else {
        // 图片落统一文件存储，消息只存引用（内容经文件中心 `fileContract.content` 访问）
        const imageIds = images?.length ? await persistChatImages(images, userId, conversation.tenantId) : [];
        const saved = await saveMessages(
          conversation.id,
          message ?? '',
          assistantContent,
          tokensInput,
          tokensOutput,
          snapshot,
          meta,
          userParentId,
          imageIds.length > 0 ? imageIds : null,
        );
        userMsgId = saved.userMsgId;
        assistantMsgId = saved.assistantMsgId;
      }

      if (tokensInput + tokensOutput > 0) {
        addDailyTokensUsed(userId, tokensInput + tokensOutput);
      }

      if (assistantMsgId) {
        // model:实际使用的模型(failover 后为切换目标),供前端气泡即时标注
        await push('saved', { assistantMsgId, userMsgId, model: snapshot?.model ?? model ?? null });
      }

      // 首轮完成后自动生成对话标题（LLM 总结，失败回退前 30 字）
      if (!regenerate && !errored && !cancelled && conversation.title === '新对话') {
        const title = await generateConversationTitle(conversation.id, message ?? '', assistantContent).catch(() => null);
        if (title) await push('title', { title });
      }
    } else {
      // 无任何回复内容(连接失败/立即取消):账本未落库,但 Memory 已保存本轮 user 输入,
      // 重建镜像修正,避免 thread 比激活路径多一条无回复的 user 消息
      void rebuildThreadMirror(conversation.id, userId, { activeLeafMsgId: conversation.activeLeafMsgId })
        .catch((err) => logger.warn('[ai-gen] thread mirror repair failed', err));
    }
  } catch (err) {
    logger.error('[ai-gen] persist failed', err);
    await push('error', { message: '消息保存失败' });
  } finally {
    await finishGeneration(genId, conversation.id);
  }
}
