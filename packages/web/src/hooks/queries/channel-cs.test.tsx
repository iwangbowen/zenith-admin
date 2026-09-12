/**
 * channel-cs（客服工作台）缓存一致性契约
 *
 * 收敛前所有会话治理动作都 `invalidateQueries({ queryKey: channelCsKeys.all })`，
 * 把运营号列表、客服名单、快捷回复、其它运营号的会话与绩效一并打回源。
 *
 * 建模依据：回复 / 指派 / 解决 / 打标签只改变**该运营号**的会话聚合行；
 * 回复与解决额外计入客服绩效；快捷回复自成一组，与会话无关。
 * 断言落在实际请求与真正进入 fetching 的查询上。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  isFresh,
  observeFetches,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  channelCsKeys,
  useAssignChannelConversation,
  useChannelConversationMessages,
  useChannelConversations,
  useChannelCsAgents,
  useChannelCsPerformance,
  useChannelQuickReplies,
  useCsChannels,
  useReplyChannelConversation,
  useSaveChannelQuickReply,
} from './channel-cs';

const CONV_PARAMS = { status: undefined, assignee: undefined, keyword: undefined };
const MSG_PARAMS = { page: 1, pageSize: 50 };

const CONVERSATION = { channelId: 1, userId: 7, userName: '张三', lastMessage: '在吗', unreadCount: 1, messageCount: 3, status: 'open', tags: [] };
const REPLY = { id: 100, channelId: 1, direction: 'out', content: '在的', createdAt: '2026-08-01 10:00:00' };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/channels/cs/channels', [{ id: 1, name: '客服号', avatar: null }, { id: 2, name: '售后号', avatar: null }])
    .on('GET', '/api/channels/cs/agents', [{ id: 9, name: '小客服', avatar: null }])
    .on('GET', '/api/channels/cs/performance', [])
    .on('GET', '/api/channels/cs/1/conversations', [CONVERSATION])
    .on('GET', '/api/channels/cs/2/conversations', [])
    .on('GET', '/api/channels/cs/1/conversations/7/messages', { list: [], total: 0, page: 1, pageSize: 50 })
    .on('GET', '/api/channels/cs/quick-replies', [])
    .on('POST', '/api/channels/cs/1/conversations/7/reply', REPLY)
    .on('POST', '/api/channels/cs/1/conversations/7/assign', null)
    .on('POST', '/api/channels/cs/quick-replies', { id: 3, channelId: 1, title: '问候', content: '您好' });
});

function mountWorkbench() {
  const qc = createTestQueryClient();
  const hook = renderHook(
    () => ({
      channels: useCsChannels(),
      agents: useChannelCsAgents(),
      performance: useChannelCsPerformance(),
      conversations: useChannelConversations(1, CONV_PARAMS),
      otherConversations: useChannelConversations(2, CONV_PARAMS),
      messages: useChannelConversationMessages(1, 7, MSG_PARAMS),
      quickReplies: useChannelQuickReplies(1),
      reply: useReplyChannelConversation(),
      assign: useAssignChannelConversation(),
      saveQuickReply: useSaveChannelQuickReply(),
    }),
    { wrapper: createWrapper(qc) },
  );
  return { qc, hook };
}

async function settle(hook: ReturnType<typeof mountWorkbench>['hook']) {
  await waitFor(() => {
    const r = hook.result.current;
    expect(r.channels.isSuccess).toBe(true);
    expect(r.agents.isSuccess).toBe(true);
    expect(r.performance.isSuccess).toBe(true);
    expect(r.conversations.isSuccess).toBe(true);
    expect(r.otherConversations.isSuccess).toBe(true);
    expect(r.messages.isSuccess).toBe(true);
    expect(r.quickReplies.isSuccess).toBe(true);
  });
}

describe('客服回复', () => {
  it('refreshes this channel\'s conversations, the thread and performance, but not the lookups or another channel', async () => {
    const { qc, hook } = mountWorkbench();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.reply.mutateAsync({ params: { id: 1, userId: 7 }, body: { content: '在的' } });
    await waitFor(() => {
      expect(fetches.countOf(channelCsKeys.conversations(1, CONV_PARAMS))).toBe(1);
      expect(fetches.countOf(channelCsKeys.messages(1, 7, MSG_PARAMS))).toBe(1);
      expect(fetches.countOf(channelCsKeys.performance)).toBe(1);
    });

    // 收敛前这些都会被 `.all` 一并打掉
    expect(fetches.countOf(channelCsKeys.conversations(2, CONV_PARAMS))).toBe(0);
    expect(fetches.countOf(channelCsKeys.channels)).toBe(0);
    expect(fetches.countOf(channelCsKeys.agents)).toBe(0);
    expect(fetches.countOf(channelCsKeys.quickReplies(1))).toBe(0);
    expect(api.countOf('GET', '/api/channels/cs/channels')).toBe(0);
    expect(api.countOf('GET', '/api/channels/cs/agents')).toBe(0);
    expect(api.countOf('GET', '/api/channels/cs/quick-replies')).toBe(0);
    expect(api.countOf('GET', '/api/channels/cs/2/conversations')).toBe(0);
    expect(isFresh(qc, channelCsKeys.channels)).toBe(true);
    expect(isFresh(qc, channelCsKeys.quickReplies(1))).toBe(true);

    fetches.stop();
  });
});

describe('指派会话', () => {
  it('only touches the conversation rows of that channel (no message, no performance)', async () => {
    const { qc, hook } = mountWorkbench();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.assign.mutateAsync({ params: { id: 1, userId: 7 }, body: { assigneeId: 9 } });
    await waitFor(() => expect(fetches.countOf(channelCsKeys.conversations(1, CONV_PARAMS))).toBe(1));

    expect(fetches.countOf(channelCsKeys.messages(1, 7, MSG_PARAMS))).toBe(0);
    expect(fetches.countOf(channelCsKeys.performance)).toBe(0);
    expect(api.countOf('GET', '/api/channels/cs/performance')).toBe(0);
    expect(isFresh(qc, channelCsKeys.performance)).toBe(true);

    fetches.stop();
  });
});

describe('快捷回复', () => {
  it('refreshes the quick-reply lists without touching any conversation query', async () => {
    const { qc, hook } = mountWorkbench();
    await settle(hook);

    const fetches = observeFetches(qc);
    api.resetCalls();

    await hook.result.current.saveQuickReply.mutateAsync({ values: { channelId: 1, title: '问候', content: '您好' } });
    await waitFor(() => expect(fetches.countOf(channelCsKeys.quickReplies(1))).toBe(1));

    expect(fetches.countOf(channelCsKeys.conversations(1, CONV_PARAMS))).toBe(0);
    expect(fetches.countOf(channelCsKeys.messages(1, 7, MSG_PARAMS))).toBe(0);
    expect(api.countOf('GET', '/api/channels/cs/1/conversations')).toBe(0);

    fetches.stop();
  });
});
