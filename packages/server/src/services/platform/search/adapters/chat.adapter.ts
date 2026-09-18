import { chatContract } from '@zenith/shared/chat';
import type { QueryOutputOf } from '@zenith/shared/core';
import { searchGlobalMessages } from '../../../chat/chat-messages.service';
import type { GlobalSearchAdapter } from '../types';
import { result } from '../helpers';

type ChatSearchQuery = QueryOutputOf<typeof chatContract.globalSearch>;

export const chatMessageSearchAdapter: GlobalSearchAdapter = {
  type: 'chat-message',
  permissions: 'authenticated',
  async search({ q, limit }) {
    const page = await searchGlobalMessages({ keyword: q, page: 1, pageSize: limit } satisfies ChatSearchQuery);
    return page.list.map((item) => {
      const message = item.message;
      const conversationName = page.conversationNames[message.conversationId] ?? '会话';
      return result({
        type: 'chat-message',
        id: String(message.id),
        title: item.snippet || message.content.slice(0, 160) || '聊天消息',
        subtitle: [conversationName, message.senderName].filter(Boolean).join(' · '),
        description: message.createdAt,
        icon: 'MessageCircle',
        route: `/chat?conv=${message.conversationId}`,
        highlights: item.snippet ? [{ field: 'content', text: item.snippet }] : [],
      });
    });
  },
};
