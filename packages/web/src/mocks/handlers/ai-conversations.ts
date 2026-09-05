import { http, HttpResponse } from 'msw';
import { toColonPath } from '@zenith/shared/core';
import { aiConversationContract, sendAiChatMessageSchema } from '@zenith/shared/ai';
import type { AiConversation, AiFeedbackItem, AiMessage } from '@zenith/shared/ai';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockAiConversations, mockAiMessages, getNextConvId, getNextMsgId } from '@/mocks/data/ai';
import { mockDateTime } from '@/mocks/utils/date';

const convStore: AiConversation[] = [...mockAiConversations];
const msgStore: Record<number, AiMessage[]> = { ...mockAiMessages };

/** 反馈列表条目：补充反馈人 / 会话标题 / 前置提问 */
function enrichFeedbackItem(m: AiMessage): AiFeedbackItem {
  const conv = convStore.find((c) => c.id === m.conversationId);
  const msgs = msgStore[m.conversationId] ?? [];
  const idx = msgs.findIndex((x) => x.id === m.id);
  const question = idx > 0 ? [...msgs.slice(0, idx)].reverse().find((x) => x.role === 'user')?.content ?? null : null;
  return {
    ...m,
    userId: conv?.userId ?? 1,
    username: 'admin',
    nickname: '管理员',
    conversationTitle: conv?.title ?? null,
    question,
  };
}

/** 有反馈的 assistant 消息，按筛选条件过滤并按时间倒序 */
function listFeedbackMessages(filters: { feedback?: '1' | '-1'; status?: string; model?: string; startDate?: string; endDate?: string }) {
  let allMsgs: AiMessage[] = Object.values(msgStore).flat().filter((m) => m.feedback !== null);
  if (filters.feedback) allMsgs = allMsgs.filter((m) => m.feedback === Number(filters.feedback));
  if (filters.status) allMsgs = allMsgs.filter((m) => m.feedbackStatus === filters.status);
  if (filters.model) allMsgs = allMsgs.filter((m) => m.model === filters.model);
  if (filters.startDate) allMsgs = allMsgs.filter((m) => m.createdAt >= `${filters.startDate} 00:00:00`);
  if (filters.endDate) allMsgs = allMsgs.filter((m) => m.createdAt <= `${filters.endDate} 23:59:59`);
  return allMsgs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(enrichFeedbackItem);
}

export const aiConversationsHandlers = [
  // 列表（支持 archived / keyword 筛选 + limit/offset 分页）
  mock(aiConversationContract.list, ({ query, ok }) => {
    const archived = query.archived === 'true';
    const keyword = (query.keyword ?? '').trim().toLowerCase();
    let list = convStore.filter((c) => c.isArchived === archived);
    if (keyword) {
      list = list.filter((c) =>
        c.title.toLowerCase().includes(keyword) ||
        (msgStore[c.id] ?? []).some((m) => m.content.toLowerCase().includes(keyword)),
      );
    }
    let sorted = [...list].sort((a, b) =>
      (Number(b.isPinned) - Number(a.isPinned)) || b.updatedAt.localeCompare(a.updatedAt),
    );
    if (query.limit) sorted = sorted.slice(query.offset ?? 0, (query.offset ?? 0) + query.limit);
    return ok(sorted);
  }),

  // 创建对话
  mock(aiConversationContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const newConv: AiConversation = {
      id: getNextConvId(),
      userId: 1,
      tenantId: null,
      title: body.title ?? '新对话',
      providerSnapshot: null,
      isArchived: false,
      isPinned: false,
      systemPromptOverride: null,
      knowledgeBaseId: null,
      agentId: body.agentId ?? null,
      tags: [],
      activeLeafMsgId: null,
      createdAt: now,
      updatedAt: now,
    };
    convStore.unshift(newConv);
    msgStore[newConv.id] = [];
    return ok(newConv, '创建成功');
  }),

  // ── 管理员反馈（/admin/feedback 静态段早于动态 /:id）────────────────────
  mock(aiConversationContract.feedbackList, ({ query, ok, paginate }) =>
    ok(paginate(listFeedbackMessages(query)))),

  mock(aiConversationContract.feedbackExport, ({ query }) => {
    const rows = listFeedbackMessages(query);
    const header = '消息 ID,反馈,处理状态,模型,反馈用户,对话标题,用户提问,AI 回复,反馈时间';
    const lines = rows.map((r) => [
      r.id, r.feedback === 1 ? '点赞' : '点踩', r.feedbackStatus ?? '', r.model ?? '',
      r.username ?? '', r.conversationTitle ?? '', JSON.stringify(r.question ?? ''), JSON.stringify(r.content.slice(0, 100)), r.createdAt,
    ].join(','));
    return new HttpResponse(`\uFEFF${header}\n${lines.join('\n')}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="ai-feedback.csv"',
      },
    });
  }),

  mock(aiConversationContract.feedbackContext, ({ params, ok }) => {
    const entry = Object.entries(msgStore).find(([, msgs]) => msgs.some((m) => m.id === params.msgId));
    if (!entry) return notFound('消息不存在', { status: 404 });
    const convId = Number(entry[0]);
    const msgs = entry[1];
    const idx = msgs.findIndex((m) => m.id === params.msgId);
    const messages = msgs.slice(Math.max(0, idx - 8), idx + 3);
    const conv = convStore.find((c) => c.id === convId);
    return ok({
      conversationId: convId,
      conversationTitle: conv?.title ?? null,
      targetMsgId: params.msgId,
      user: { id: conv?.userId ?? 1, username: 'admin', nickname: '管理员', avatar: null },
      messages,
    });
  }),

  mock(aiConversationContract.handleFeedback, ({ params, body, ok }) => {
    const msg = Object.values(msgStore).flat().find((m) => m.id === params.msgId);
    if (!msg) return notFound('消息不存在', { status: 404 });
    if (msg.feedback === null) return badRequest('该消息没有用户反馈', { status: 400 });
    msg.feedbackStatus = body.status;
    msg.feedbackRemark = body.remark?.trim() || null;
    msg.feedbackHandledAt = mockDateTime();
    return ok(null, '处理成功');
  }),

  // 更新对话标签
  mock(aiConversationContract.setTags, ({ params, body, ok }) => {
    const conv = convStore.find((c) => c.id === params.id);
    if (!conv) return notFound('对话不存在', { status: 404 });
    conv.tags = body.tags.slice(0, 10);
    return ok({ tags: conv.tags }, '标签已更新');
  }),

  // 切换消息分支（简化：沿最新子分支下探）
  mock(aiConversationContract.switchBranch, ({ params, body, ok }) => {
    const conv = convStore.find((c) => c.id === params.id);
    if (!conv) return notFound('对话不存在', { status: 404 });
    const msgs = msgStore[params.id] ?? [];
    let leaf = body.leafMsgId;
    let advanced = true;
    while (advanced) {
      advanced = false;
      const kids = msgs.filter((m) => m.parentId === leaf);
      if (kids.length > 0) {
        leaf = kids[kids.length - 1].id;
        advanced = true;
      }
    }
    conv.activeLeafMsgId = leaf;
    return ok({ activeLeafMsgId: leaf });
  }),

  // 进行中的生成任务（Demo：无后台生成，恒为 null）
  mock(aiConversationContract.activeGeneration, ({ ok }) => ok({ genId: null })),

  // 重命名对话
  mock(aiConversationContract.rename, ({ params, body, ok }) => {
    const conv = convStore.find((c) => c.id === params.id);
    if (!conv) return notFound('对话不存在', { status: 404 });
    conv.title = body.title.trim().slice(0, 200) || '新对话';
    conv.updatedAt = mockDateTime();
    return ok(null, '重命名成功');
  }),

  // 置顶 / 取消置顶
  mock(aiConversationContract.pin, ({ params, ok }) => {
    const conv = convStore.find((c) => c.id === params.id);
    if (!conv) return notFound('对话不存在', { status: 404 });
    conv.isPinned = !conv.isPinned;
    return ok({ isPinned: conv.isPinned });
  }),

  // 归档 / 取消归档
  mock(aiConversationContract.archive, ({ params, ok }) => {
    const conv = convStore.find((c) => c.id === params.id);
    if (!conv) return notFound('对话不存在', { status: 404 });
    conv.isArchived = !conv.isArchived;
    if (conv.isArchived) conv.isPinned = false;
    return ok({ isArchived: conv.isArchived });
  }),

  // 设置 / 清除对话级提示词（角色模板）
  mock(aiConversationContract.setSystemPrompt, ({ params, body, ok }) => {
    const conv = convStore.find((c) => c.id === params.id);
    if (!conv) return notFound('对话不存在', { status: 404 });
    const value = body.systemPrompt?.trim() ? body.systemPrompt.trim().slice(0, 5000) : null;
    conv.systemPromptOverride = value;
    return ok({ systemPromptOverride: value });
  }),

  // 获取单条对话
  mock(aiConversationContract.detail, ({ params, ok }) => {
    const conv = convStore.find((c) => c.id === params.id);
    if (!conv) return notFound('对话不存在', { status: 404 });
    return ok(conv);
  }),

  // 删除对话
  mock(aiConversationContract.remove, ({ params, ok }) => {
    const idx = convStore.findIndex((c) => c.id === params.id);
    if (idx === -1) return notFound('对话不存在', { status: 404 });
    convStore.splice(idx, 1);
    delete msgStore[params.id];
    return ok(null, '删除成功');
  }),

  // 获取消息列表
  mock(aiConversationContract.messages, ({ params, ok }) => ok(msgStore[params.id] ?? [])),

  // 导出对话（Markdown / JSON）
  mock(aiConversationContract.exportFile, ({ params, query }) => {
    const conv = convStore.find((c) => c.id === params.id);
    if (!conv) return notFound('对话不存在', { status: 404 });
    const msgs = msgStore[params.id] ?? [];
    const safeTitle = (conv.title || '对话').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
    let content: string;
    let contentType: string;
    if (query.format === 'json') {
      content = JSON.stringify(
        { id: conv.id, title: conv.title, messages: msgs.map((m) => ({ role: m.role, content: m.content, model: m.model })) },
        null,
        2,
      );
      contentType = 'application/json; charset=utf-8';
    } else {
      const lines = [`# ${conv.title}`, ''];
      for (const m of msgs) {
        const label = m.role === 'user' ? '🧑 用户' : m.role === 'assistant' ? '🤖 助手' : '⚙️ 系统';
        lines.push(`## ${label}`, '', m.content, '');
      }
      content = lines.join('\n');
      contentType = 'text/markdown; charset=utf-8';
    }
    return new HttpResponse(content, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(`${safeTitle}.${query.format}`)}"`,
      },
    });
  }),

  // SSE 聊天：流式响应不走契约 handler，路径仍由契约派生；regenerate 模式不保存新的 user 消息，回复成为兄弟分支
  http.post(toColonPath(aiConversationContract.chat.fullPath), async ({ params, request }) => {
    const id = Number(params.id);
    const parsed = sendAiChatMessageSchema.safeParse(await request.json());
    if (!parsed.success) return badRequest('消息不能为空', { status: 400 });
    const body = parsed.data;
    const regenerate = body.regenerate ?? false;
    if (!msgStore[id]) msgStore[id] = [];

    const now = mockDateTime();
    let userText = body.message ?? '';
    let userMsgId: number | null = null;
    /** 分支树：assistant 消息父节点（重新生成 = 末条 user；普通发送 = 新 user 消息） */
    let assistantParentId: number | null;

    if (regenerate) {
      // 重新生成：取历史末条 user 消息作为提问
      const lastUser = [...msgStore[id]].reverse().find((m) => m.role === 'user');
      if (!lastUser) {
        return badRequest('没有可重新生成的用户消息，请先删除旧回复', { status: 400 });
      }
      userText = lastUser.content;
      assistantParentId = lastUser.id;
    } else {
      // 保存 user 消息（parentMsgId 提供时为编辑重发分支，否则挂在末条消息后）
      userMsgId = getNextMsgId();
      const lastMsg = msgStore[id][msgStore[id].length - 1];
      const userParentId = body.parentMsgId !== undefined ? body.parentMsgId : (lastMsg?.id ?? null);
      const userMsg: AiMessage = {
        id: userMsgId,
        conversationId: id,
        parentId: userParentId,
        role: 'user',
        content: userText,
        reasoning: null,
        model: null,
        tokensInput: Math.floor(userText.length / 4),
        tokensOutput: 0,
        ttftMs: null,
        durationMs: null,
        feedback: null,
        feedbackReason: null,
        feedbackStatus: null,
        feedbackRemark: null,
        feedbackHandledAt: null,
        trace: null,
        toolCalls: null,
        references: null,
        images: body.images?.length ? ['demo-img'] : null,
        createdAt: now,
      };
      msgStore[id].push(userMsg);
      assistantParentId = userMsgId;
    }

    const reasoningText = `用户的提问是「${userText.slice(0, 40)}」。首先理解意图，然后组织一个简洁友好的演示回复，说明当前处于 Demo 模式即可。`;

    const replyText = `这是一个 Demo 演示模式的模拟回复。${regenerate ? '（重新生成）' : ''}

您发送的消息是：**"${userText}"**

在真实环境中，这里会通过后端接入 AI 服务（如 OpenAI、DeepSeek 等），返回流式 SSE 响应。当前演示模式使用 MSW 模拟了 SSE 流式输出效果。

**当前时间：** ${now}`;

    const assistantMsgId = getNextMsgId();

    // 标题仍为默认值时自动命名（模拟 LLM 自动命名）
    const conv = convStore.find((c) => c.id === id);
    const needTitle = !regenerate && conv?.title === '新对话';
    const newTitle = userText.slice(0, 15) + (userText.length > 15 ? '…' : '');
    if (needTitle && conv) {
      conv.title = newTitle;
      conv.updatedAt = now;
    }

    // 组装 SSE 响应（含思维链演示）
    let sseBody = `event: gen\ndata: ${JSON.stringify({ genId: `demo-gen-${assistantMsgId}` })}\n\n`;
    for (const chunk of reasoningText.match(/.{1,10}/g) ?? []) {
      sseBody += `event: reasoning\ndata: ${JSON.stringify({ content: chunk })}\n\n`;
    }
    for (const chunk of replyText.match(/.{1,8}/g) ?? []) {
      sseBody += `event: delta\ndata: ${JSON.stringify({ content: chunk })}\n\n`;
    }
    sseBody += `event: done\ndata: ${JSON.stringify({ tokensInput: Math.floor(userText.length / 4), tokensOutput: Math.floor(replyText.length / 4) })}\n\n`;
    sseBody += `event: saved\ndata: ${JSON.stringify({ assistantMsgId, userMsgId })}\n\n`;
    if (needTitle) {
      sseBody += `event: title\ndata: ${JSON.stringify({ title: newTitle })}\n\n`;
    }

    // 保存 assistant 消息
    const assistantMsg: AiMessage = {
      id: assistantMsgId,
      conversationId: id,
      parentId: assistantParentId,
      role: 'assistant',
      content: replyText,
      reasoning: reasoningText,
      model: 'qwen (demo)',
      tokensInput: 0,
      tokensOutput: Math.floor(replyText.length / 4),
      ttftMs: 600 + Math.floor(Math.random() * 800),
      durationMs: 3000 + Math.floor(Math.random() * 4000),
      feedback: null,
      feedbackReason: null,
      feedbackStatus: null,
      feedbackRemark: null,
      feedbackHandledAt: null,
      trace: [
        { type: 'llm_round', label: 'LLM 生成', durationMs: 3200, meta: { model: 'qwen (demo)', toolCalls: 0 } },
      ],
      toolCalls: null,
      references: null,
      images: null,
      createdAt: now,
    };
    msgStore[id].push(assistantMsg);
    if (conv) conv.activeLeafMsgId = assistantMsgId;

    return new HttpResponse(sseBody, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }),

  // 删除消息及其之后所有消息（级联）
  mock(aiConversationContract.removeMessageCascade, ({ params, ok }) => {
    const msgs = msgStore[params.id];
    if (!msgs) return notFound('对话不存在', { status: 404 });
    const idx = msgs.findIndex((m) => m.id === params.msgId);
    if (idx === -1) return notFound('消息不存在', { status: 404 });
    msgStore[params.id] = msgs.slice(0, idx);
    return ok(null, '删除成功');
  }),

  // 删除单条 assistant 消息（用于重新生成）
  mock(aiConversationContract.removeMessage, ({ params, ok }) => {
    const msgs = msgStore[params.id];
    if (!msgs) return notFound('对话不存在', { status: 404 });
    msgStore[params.id] = msgs.filter((m) => m.id !== params.msgId);
    return ok(null, '删除成功');
  }),

  // 消息反馈（点赞/点踩）
  mock(aiConversationContract.submitFeedback, ({ params, body, ok }) => {
    const msgs = msgStore[params.id];
    if (!msgs) return notFound('对话不存在', { status: 404 });
    const msg = msgs.find((m) => m.id === params.msgId);
    if (!msg) return notFound('消息不存在', { status: 404 });
    const isDislike = body.feedback === -1;
    msg.feedback = body.feedback;
    msg.feedbackReason = isDislike ? (body.reason ?? null) : null;
    msg.feedbackStatus = isDislike ? 'pending' : null;
    msg.feedbackRemark = null;
    msg.feedbackHandledAt = null;
    return ok(null, '反馈成功');
  }),
];
