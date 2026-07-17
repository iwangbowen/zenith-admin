import { http, HttpResponse } from 'msw';
import { mockAiConversations, mockAiMessages, getNextConvId, getNextMsgId, mockAiDateTime as mockDateTime } from '@/mocks/data/ai';
import type { AiConversation, AiMessage } from '@zenith/shared';

const convStore: AiConversation[] = [...mockAiConversations];
const msgStore: Record<number, AiMessage[]> = { ...mockAiMessages };

/** 反馈列表条目：补充反馈人 / 会话标题 / 前置提问 */
function enrichFeedbackItem(m: AiMessage) {
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

export const aiConversationsHandlers = [
  // 列表（支持 archived / keyword 筛选 + limit/offset 分页）
  http.get('/api/ai/conversations', ({ request }) => {
    const url = new URL(request.url);
    const archived = url.searchParams.get('archived') === 'true';
    const keyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase();
    const limit = Number(url.searchParams.get('limit')) || 0;
    const offset = Number(url.searchParams.get('offset')) || 0;
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
    if (limit > 0) sorted = sorted.slice(offset, offset + limit);
    return HttpResponse.json({ code: 0, message: 'ok', data: sorted });
  }),

  // 创建对话
  http.post('/api/ai/conversations', async ({ request }) => {
    const body = await request.json() as { title?: string };
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
      createdAt: now,
      updatedAt: now,
    };
    convStore.unshift(newConv);
    msgStore[newConv.id] = [];
    return HttpResponse.json({ code: 0, message: '创建成功', data: newConv });
  }),

  // 重命名对话
  http.put('/api/ai/conversations/:id/rename', async ({ params, request }) => {
    const id = Number(params.id);
    const body = await request.json() as { title?: string };
    const conv = convStore.find((c) => c.id === id);
    if (!conv) return HttpResponse.json({ code: 404, message: '对话不存在', data: null }, { status: 404 });
    conv.title = (body.title ?? '').trim().slice(0, 200) || '新对话';
    conv.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '重命名成功', data: null });
  }),

  // 置顶 / 取消置顶
  http.put('/api/ai/conversations/:id/pin', ({ params }) => {
    const id = Number(params.id);
    const conv = convStore.find((c) => c.id === id);
    if (!conv) return HttpResponse.json({ code: 404, message: '对话不存在', data: null }, { status: 404 });
    conv.isPinned = !conv.isPinned;
    return HttpResponse.json({ code: 0, message: 'ok', data: { isPinned: conv.isPinned } });
  }),

  // 归档 / 取消归档
  http.put('/api/ai/conversations/:id/archive', ({ params }) => {
    const id = Number(params.id);
    const conv = convStore.find((c) => c.id === id);
    if (!conv) return HttpResponse.json({ code: 404, message: '对话不存在', data: null }, { status: 404 });
    conv.isArchived = !conv.isArchived;
    if (conv.isArchived) conv.isPinned = false;
    return HttpResponse.json({ code: 0, message: 'ok', data: { isArchived: conv.isArchived } });
  }),

  // 设置 / 清除对话级提示词（角色模板）
  http.put('/api/ai/conversations/:id/system-prompt', async ({ params, request }) => {
    const id = Number(params.id);
    const body = await request.json() as { systemPrompt?: string | null };
    const conv = convStore.find((c) => c.id === id);
    if (!conv) return HttpResponse.json({ code: 404, message: '对话不存在', data: null }, { status: 404 });
    const value = body.systemPrompt?.trim() ? body.systemPrompt.trim().slice(0, 5000) : null;
    conv.systemPromptOverride = value;
    return HttpResponse.json({ code: 0, message: 'ok', data: { systemPromptOverride: value } });
  }),

  // 获取单条对话
  http.get('/api/ai/conversations/:id', ({ params }) => {
    const id = Number(params.id);
    const conv = convStore.find((c) => c.id === id);
    if (!conv) return HttpResponse.json({ code: 404, message: '对话不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: conv });
  }),

  // 删除对话
  http.delete('/api/ai/conversations/:id', ({ params }) => {
    const id = Number(params.id);
    const idx = convStore.findIndex((c) => c.id === id);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '对话不存在', data: null }, { status: 404 });
    convStore.splice(idx, 1);
    delete msgStore[id];
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 获取消息列表
  http.get('/api/ai/conversations/:id/messages', ({ params }) => {
    const id = Number(params.id);
    const msgs = msgStore[id] ?? [];
    return HttpResponse.json({ code: 0, message: 'ok', data: msgs });
  }),

  // 导出对话（Markdown / JSON）
  http.get('/api/ai/conversations/:id/export', ({ params, request }) => {
    const id = Number(params.id);
    const conv = convStore.find((c) => c.id === id);
    if (!conv) return HttpResponse.json({ code: 404, message: '对话不存在', data: null }, { status: 404 });
    const url = new URL(request.url);
    const format = url.searchParams.get('format') === 'json' ? 'json' : 'md';
    const msgs = msgStore[id] ?? [];
    const safeTitle = (conv.title || '对话').replace(/[\\/:*?"<>|]/g, '_').slice(0, 50);
    let content: string;
    let contentType: string;
    let ext: string;
    if (format === 'json') {
      content = JSON.stringify(
        { id: conv.id, title: conv.title, messages: msgs.map((m) => ({ role: m.role, content: m.content, model: m.model })) },
        null,
        2,
      );
      contentType = 'application/json; charset=utf-8';
      ext = 'json';
    } else {
      const lines = [`# ${conv.title}`, ''];
      for (const m of msgs) {
        const label = m.role === 'user' ? '🧑 用户' : m.role === 'assistant' ? '🤖 助手' : '⚙️ 系统';
        lines.push(`## ${label}`, '', m.content, '');
      }
      content = lines.join('\n');
      contentType = 'text/markdown; charset=utf-8';
      ext = 'md';
    }
    return new HttpResponse(content, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(`${safeTitle}.${ext}`)}"`,
      },
    });
  }),

  // SSE 聊天 (模拟流式响应；regenerate 模式不保存新的 user 消息)
  http.post('/api/ai/conversations/:id/chat', async ({ params, request }) => {
    const id = Number(params.id);
    const body = await request.json() as { message?: string; regenerate?: boolean };
    const regenerate = body.regenerate ?? false;
    if (!msgStore[id]) msgStore[id] = [];

    const now = mockDateTime();
    let userText = body.message ?? '';
    let userMsgId: number | null = null;

    if (regenerate) {
      // 重新生成：取历史末条 user 消息作为提问
      const lastUser = [...msgStore[id]].reverse().find((m) => m.role === 'user');
      if (!lastUser) {
        return HttpResponse.json({ code: 400, message: '没有可重新生成的用户消息，请先删除旧回复', data: null }, { status: 400 });
      }
      userText = lastUser.content;
    } else {
      // Save user message
      userMsgId = getNextMsgId();
      const userMsg: AiMessage = {
        id: userMsgId,
        conversationId: id,
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
        createdAt: now,
      };
      msgStore[id].push(userMsg);
    }

    const reasoningText = `用户的提问是「${userText.slice(0, 40)}」。首先理解意图，然后组织一个简洁友好的演示回复，说明当前处于 Demo 模式即可。`;

    const replyText = `这是一个 Demo 演示模式的模拟回复。${regenerate ? '（重新生成）' : ''}

您发送的消息是：**"${userText}"**

在真实环境中，这里会通过后端接入 AI 服务（如 OpenAI、DeepSeek 等），返回流式 SSE 响应。当前演示模式使用 MSW 模拟了 SSE 流式输出效果。

**当前时间：** ${now}`;

    const assistantMsgId = getNextMsgId();

    // Update conversation title if still default（模拟 LLM 自动命名）
    const conv = convStore.find((c) => c.id === id);
    const needTitle = !regenerate && conv?.title === '新对话';
    const newTitle = userText.slice(0, 15) + (userText.length > 15 ? '…' : '');
    if (needTitle && conv) {
      conv.title = newTitle;
      conv.updatedAt = now;
    }

    // Build SSE response（含思维链演示）
    let sseBody = '';
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

    // Save assistant message
    const assistantMsg: AiMessage = {
      id: assistantMsgId,
      conversationId: id,
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
      createdAt: now,
    };
    msgStore[id].push(assistantMsg);

    return new HttpResponse(sseBody, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  }),

  // 删除消息及其之后所有消息（级联）
  http.delete('/api/ai/conversations/:convId/messages/:msgId/cascade', ({ params }) => {
    const convId = Number(params.convId);
    const msgId = Number(params.msgId);
    const msgs = msgStore[convId];
    if (!msgs) return HttpResponse.json({ code: 404, message: '对话不存在', data: null }, { status: 404 });
    const idx = msgs.findIndex((m) => m.id === msgId);
    if (idx === -1) return HttpResponse.json({ code: 404, message: '消息不存在', data: null }, { status: 404 });
    msgStore[convId] = msgs.slice(0, idx);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 删除单条 assistant 消息（用于重新生成）
  http.delete('/api/ai/conversations/:convId/messages/:msgId', ({ params }) => {
    const convId = Number(params.convId);
    const msgId = Number(params.msgId);
    const msgs = msgStore[convId];
    if (!msgs) return HttpResponse.json({ code: 404, message: '对话不存在', data: null }, { status: 404 });
    msgStore[convId] = msgs.filter((m) => m.id !== msgId);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // ── 管理员反馈列表（/api/ai/conversations/admin/feedback）────────────────
  // 注意：必须在 /:id 路由之前注册，以避免 "admin" 被当成 id
  http.get('/api/ai/conversations/admin/feedback', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const feedbackParam = url.searchParams.get('feedback');
    const statusParam = url.searchParams.get('status');
    const modelParam = url.searchParams.get('model');
    const startDate = url.searchParams.get('startDate');
    const endDate = url.searchParams.get('endDate');

    // 收集所有带反馈的消息
    let allMsgs: AiMessage[] = Object.values(msgStore).flat().filter((m) => m.feedback !== null);
    if (feedbackParam !== null && feedbackParam !== '') {
      const fb = Number(feedbackParam);
      allMsgs = allMsgs.filter((m) => m.feedback === fb);
    }
    if (statusParam) {
      allMsgs = allMsgs.filter((m) => m.feedbackStatus === statusParam);
    }
    if (modelParam) {
      allMsgs = allMsgs.filter((m) => m.model === modelParam);
    }
    if (startDate) allMsgs = allMsgs.filter((m) => m.createdAt >= `${startDate} 00:00:00`);
    if (endDate) allMsgs = allMsgs.filter((m) => m.createdAt <= `${endDate} 23:59:59`);
    allMsgs = allMsgs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = allMsgs.length;
    const list = allMsgs.slice((page - 1) * pageSize, page * pageSize).map(enrichFeedbackItem);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 管理员查看反馈上下文
  http.get('/api/ai/conversations/admin/feedback/:msgId/context', ({ params }) => {
    const msgId = Number(params.msgId);
    const entry = Object.entries(msgStore).find(([, msgs]) => msgs.some((m) => m.id === msgId));
    if (!entry) return HttpResponse.json({ code: 404, message: '消息不存在', data: null }, { status: 404 });
    const convId = Number(entry[0]);
    const msgs = entry[1];
    const idx = msgs.findIndex((m) => m.id === msgId);
    const messages = msgs.slice(Math.max(0, idx - 8), idx + 3);
    const conv = convStore.find((c) => c.id === convId);
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: { conversationId: convId, conversationTitle: conv?.title ?? null, targetMsgId: msgId, messages },
    });
  }),

  // 管理员导出反馈 CSV
  http.get('/api/ai/conversations/admin/feedback/export', () => {
    const rows = Object.values(msgStore).flat().filter((m) => m.feedback !== null).map(enrichFeedbackItem);
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

  // 管理员处理反馈（更新状态/备注）
  http.put('/api/ai/conversations/admin/feedback/:msgId', async ({ params, request }) => {
    const msgId = Number(params.msgId);
    const body = await request.json() as { status?: 'pending' | 'resolved' | 'ignored'; remark?: string | null };
    const msg = Object.values(msgStore).flat().find((m) => m.id === msgId);
    if (!msg) return HttpResponse.json({ code: 404, message: '消息不存在', data: null }, { status: 404 });
    if (msg.feedback === null) return HttpResponse.json({ code: 400, message: '该消息没有用户反馈', data: null }, { status: 400 });
    msg.feedbackStatus = body.status ?? 'resolved';
    msg.feedbackRemark = body.remark?.trim() || null;
    msg.feedbackHandledAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '处理成功', data: null });
  }),

  // 消息反馈（点赞/点踩）
  http.put('/api/ai/conversations/:convId/messages/:msgId/feedback', async ({ params, request }) => {
    const convId = Number(params.convId);
    const msgId = Number(params.msgId);
    const body = await request.json() as { feedback: number | null; reason?: string | null };
    const msgs = msgStore[convId];
    if (!msgs) return HttpResponse.json({ code: 404, message: '对话不存在', data: null }, { status: 404 });
    const msg = msgs.find((m) => m.id === msgId);
    if (!msg) return HttpResponse.json({ code: 404, message: '消息不存在', data: null }, { status: 404 });
    const isDislike = body.feedback === -1;
    msg.feedback = body.feedback ?? null;
    msg.feedbackReason = isDislike ? (body.reason ?? null) : null;
    msg.feedbackStatus = isDislike ? 'pending' : null;
    msg.feedbackRemark = null;
    msg.feedbackHandledAt = null;
    return HttpResponse.json({ code: 0, message: 'ok', data: msg });
  }),
];
