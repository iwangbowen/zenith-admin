import { chatBotContract, chatWebhookPublicContract } from '@zenith/shared/chat';
import type { ChatWebhook } from '@zenith/shared/chat';
import { urlOf } from '@/lib/contract-query';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockChatWebhooks, getNextWebhookId, genWebhookToken } from '@/mocks/data/chat-bots';
import { mockChatConversations } from '@/mocks/data/chat';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';

function convName(conversationId: number): string | null {
  const conv = mockChatConversations.find((c) => c.id === conversationId);
  if (!conv) return null;
  return conv.type === 'group' ? (conv.name ?? '群聊') : (conv.targetUser?.nickname ?? '私聊');
}

/** 入站推送地址 = 公开 Webhook 契约路径填入令牌 */
function webhookUrl(token: string): string {
  return urlOf(chatWebhookPublicContract.ingest, { params: { token } });
}

export const chatBotsHandlers = [
  mock(chatBotContract.list, ({ query, ok, paginate }) => {
    const filtered = filterByKeyword(mockChatWebhooks, query.keyword, [(w) => w.name]);
    return ok(paginate(filtered));
  }),

  mock(chatBotContract.create, ({ body, ok }) => {
    const now = mockDateTime();
    const tk = genWebhookToken('new');
    const item: ChatWebhook = {
      id: getNextWebhookId(),
      name: body.name,
      avatar: body.avatar ?? null,
      description: body.description ?? null,
      conversationId: body.conversationId,
      conversationName: convName(body.conversationId),
      enabled: body.enabled,
      webhookUrl: webhookUrl(tk),
      token: tk,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    mockChatWebhooks.unshift(item);
    return ok(item, '创建成功');
  }),

  mock(chatBotContract.update, ({ params, body, ok }) => {
    const hook = mockChatWebhooks.find((w) => w.id === params.id);
    if (!hook) return notFound('Webhook 不存在', { status: 404 });
    Object.assign(hook, body, { updatedAt: mockDateTime() });
    return ok(hook, '更新成功');
  }),

  mock(chatBotContract.regenerateToken, ({ params, ok }) => {
    const hook = mockChatWebhooks.find((w) => w.id === params.id);
    if (!hook) return notFound('Webhook 不存在', { status: 404 });
    const tk = genWebhookToken('regen');
    hook.token = tk;
    hook.webhookUrl = webhookUrl(tk);
    hook.updatedAt = mockDateTime();
    return ok(hook, '令牌已重置');
  }),

  mock(chatBotContract.remove, ({ params, ok }) => {
    const index = mockChatWebhooks.findIndex((w) => w.id === params.id);
    if (index === -1) return notFound('Webhook 不存在', { status: 404 });
    mockChatWebhooks.splice(index, 1);
    return ok(null, '删除成功');
  }),
];
