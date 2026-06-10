import { http, HttpResponse } from 'msw';
import { mockAiConversations, mockAiMessages, getNextConvId, getNextMsgId, mockAiDateTime as mockDateTime } from '@/mocks/data/ai';
import type { AiConversation, AiMessage } from '@zenith/shared';

const convStore: AiConversation[] = [...mockAiConversations];
const msgStore: Record<number, AiMessage[]> = { ...mockAiMessages };

export const aiConversationsHandlers = [
  // 列表
  http.get('/api/ai/conversations', () => {
    const sorted = [...convStore].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
      createdAt: now,
      updatedAt: now,
    };
    convStore.unshift(newConv);
    msgStore[newConv.id] = [];
    return HttpResponse.json({ code: 0, message: '创建成功', data: newConv });
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

  // SSE 聊天 (模拟流式响应)
  http.post('/api/ai/conversations/:id/chat', async ({ params, request }) => {
    const id = Number(params.id);
    const body = await request.json() as { message?: string };
    const userText = body.message ?? '';

    // Save user message
    const now = mockDateTime();
    const userMsg: AiMessage = {
      id: getNextMsgId(),
      conversationId: id,
      role: 'user',
      content: userText,
      tokensInput: Math.floor(userText.length / 4),
      tokensOutput: 0,
      feedback: null,
      createdAt: now,
    };
    if (!msgStore[id]) msgStore[id] = [];
    msgStore[id].push(userMsg);

    const replyText = `这是一个 Demo 演示模式的模拟回复。

您发送的消息是：**"${userText}"**

在真实环境中，这里会通过后端接入 AI 服务（如 OpenAI、DeepSeek 等），返回流式 SSE 响应。当前演示模式使用 MSW 模拟了 SSE 流式输出效果。

**当前时间：** ${now}`;

    const assistantMsgId = getNextMsgId();

    // Update conversation title if still default
    const conv = convStore.find((c) => c.id === id);
    if (conv?.title === '新对话') {
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

    // Save assistant message
    const assistantMsg: AiMessage = {
      id: assistantMsgId,
      conversationId: id,
      role: 'assistant',
      content: replyText,
      tokensInput: 0,
      tokensOutput: Math.floor(replyText.length / 4),
      feedback: null,
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
];
