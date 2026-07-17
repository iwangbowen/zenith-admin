import { http, HttpResponse } from 'msw';
import { mockAiConversations, mockAiMessages, getNextConvId, getNextMsgId, mockAiDateTime as mockDateTime } from '@/mocks/data/ai';
import type { AiConversation, AiMessage } from '@zenith/shared';

const convStore: AiConversation[] = [...mockAiConversations];
const msgStore: Record<number, AiMessage[]> = { ...mockAiMessages };

export const aiConversationsHandlers = [
  // 列表（支持 archived / keyword 筛选）
  http.get('/api/ai/conversations', ({ request }) => {
    const url = new URL(request.url);
    const archived = url.searchParams.get('archived') === 'true';
    const keyword = (url.searchParams.get('keyword') ?? '').trim().toLowerCase();
    let list = convStore.filter((c) => c.isArchived === archived);
    if (keyword) {
      list = list.filter((c) =>
        c.title.toLowerCase().includes(keyword) ||
        (msgStore[c.id] ?? []).some((m) => m.content.toLowerCase().includes(keyword)),
      );
    }
    const sorted = [...list].sort((a, b) =>
      (Number(b.isPinned) - Number(a.isPinned)) || b.updatedAt.localeCompare(a.updatedAt),
    );
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

    if (regenerate) {
      // 重新生成：取历史末条 user 消息作为提问
      const lastUser = [...msgStore[id]].reverse().find((m) => m.role === 'user');
      if (!lastUser) {
        return HttpResponse.json({ code: 400, message: '没有可重新生成的用户消息，请先删除旧回复', data: null }, { status: 400 });
      }
      userText = lastUser.content;
    } else {
      // Save user message
      const userMsg: AiMessage = {
        id: getNextMsgId(),
        conversationId: id,
        role: 'user',
        content: userText,
        model: null,
        tokensInput: Math.floor(userText.length / 4),
        tokensOutput: 0,
        feedback: null,
        feedbackReason: null,
        feedbackStatus: null,
        feedbackRemark: null,
        feedbackHandledAt: null,
        createdAt: now,
      };
      msgStore[id].push(userMsg);
    }

    const replyText = `这是一个 Demo 演示模式的模拟回复。${regenerate ? '（重新生成）' : ''}

您发送的消息是：**"${userText}"**

在真实环境中，这里会通过后端接入 AI 服务（如 OpenAI、DeepSeek 等），返回流式 SSE 响应。当前演示模式使用 MSW 模拟了 SSE 流式输出效果。

**当前时间：** ${now}`;

    const assistantMsgId = getNextMsgId();

    // Update conversation title if still default
    const conv = convStore.find((c) => c.id === id);
    if (!regenerate && conv?.title === '新对话') {
      conv.title = userText.slice(0, 20) + (userText.length > 20 ? '…' : '');
      conv.updatedAt = now;
    }

    // Build SSE response
    const chunks = replyText.match(/.{1,8}/g) ?? [];
    let sseBody = '';
    for (const chunk of chunks) {
      sseBody += `event: delta\ndata: ${JSON.stringify({ content: chunk })}\n\n`;
    }
    sseBody += `event: done\ndata: ${JSON.stringify({ tokensInput: Math.floor(userText.length / 4), tokensOutput: Math.floor(replyText.length / 4) })}\n\n`;
    sseBody += `event: saved\ndata: ${JSON.stringify({ assistantMsgId })}\n\n`;

    // Save assistant message
    const assistantMsg: AiMessage = {
      id: assistantMsgId,
      conversationId: id,
      role: 'assistant',
      content: replyText,
      model: 'qwen (demo)',
      tokensInput: 0,
      tokensOutput: Math.floor(replyText.length / 4),
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

    // 收集所有带反馈的消息
    let allMsgs: AiMessage[] = Object.values(msgStore).flat().filter((m) => m.feedback !== null);
    if (feedbackParam !== null && feedbackParam !== '') {
      const fb = Number(feedbackParam);
      allMsgs = allMsgs.filter((m) => m.feedback === fb);
    }
    if (statusParam) {
      allMsgs = allMsgs.filter((m) => m.feedbackStatus === statusParam);
    }
    allMsgs = allMsgs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = allMsgs.length;
    const list = allMsgs.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
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
