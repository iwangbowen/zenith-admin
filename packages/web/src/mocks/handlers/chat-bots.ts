import { http, HttpResponse } from 'msw';
import type { ChatWebhook } from '@zenith/shared';
import { mockChatWebhooks, getNextWebhookId, genWebhookToken } from '@/mocks/data/chat-bots';
import { mockChatConversations } from '@/mocks/data/chat';
import { mockDateTime } from '@/mocks/utils/date';

function convName(conversationId: number): string | null {
  const conv = mockChatConversations.find((c) => c.id === conversationId);
  if (!conv) return null;
  return conv.type === 'group' ? (conv.name ?? '群聊') : (conv.targetUser?.nickname ?? '私聊');
}

export const chatBotsHandlers = [
  http.get('/api/chat-bots', ({ request }) => {
    const url = new URL(request.url);
    const keyword = url.searchParams.get('keyword') ?? '';
    const page = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    const filtered = mockChatWebhooks.filter((w) => !keyword || w.name.includes(keyword));
    const total = filtered.length;
    const list = filtered.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  http.post('/api/chat-bots', async ({ request }) => {
    const body = await request.json() as { name: string; avatar?: string | null; description?: string | null; conversationId: number; enabled?: boolean };
    const now = mockDateTime();
    const tk = genWebhookToken('new');
    const item: ChatWebhook = {
      id: getNextWebhookId(),
      name: body.name,
      avatar: body.avatar ?? null,
      description: body.description ?? null,
      conversationId: body.conversationId,
      conversationName: convName(body.conversationId),
      enabled: body.enabled ?? true,
      webhookUrl: `/api/public/chat/webhook/${tk}`,
      token: tk,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    mockChatWebhooks.unshift(item);
    return HttpResponse.json({ code: 0, message: '创建成功', data: item });
  }),

  http.patch('/api/chat-bots/:id', async ({ params, request }) => {
    const hook = mockChatWebhooks.find((w) => w.id === Number(params.id));
    if (!hook) return HttpResponse.json({ code: 404, message: 'Webhook 不存在', data: null }, { status: 404 });
    const body = await request.json() as Partial<Pick<ChatWebhook, 'name' | 'avatar' | 'description' | 'enabled'>>;
    Object.assign(hook, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: hook });
  }),

  http.post('/api/chat-bots/:id/regenerate-token', ({ params }) => {
    const hook = mockChatWebhooks.find((w) => w.id === Number(params.id));
    if (!hook) return HttpResponse.json({ code: 404, message: 'Webhook 不存在', data: null }, { status: 404 });
    const tk = genWebhookToken('regen');
    hook.token = tk;
    hook.webhookUrl = `/api/public/chat/webhook/${tk}`;
    hook.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '令牌已重置', data: hook });
  }),

  http.delete('/api/chat-bots/:id', ({ params }) => {
    const index = mockChatWebhooks.findIndex((w) => w.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: 'Webhook 不存在', data: null }, { status: 404 });
    mockChatWebhooks.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),
];
