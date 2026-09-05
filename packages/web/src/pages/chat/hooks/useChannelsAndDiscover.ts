import { useCallback, useEffect } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { chatContract } from '@zenith/shared/chat';
import { channelContract } from '@zenith/shared/messaging';
import { api } from '@/lib/contract-query';
import { confirmDanger } from '@/utils/confirm';
import { useDiscoverableChannels } from '@/hooks/queries/chat';
import type { ChatConversation } from '@zenith/shared/chat';
import type { Channel } from '@zenith/shared/messaging';
import type { Setter } from '../types';

/** 会话/频道列表加载 + 发现频道（防抖搜索、订阅/退订）（自 ChatPage 原样搬移） */
export function useChannelsAndDiscover({
  discoverVisible, debouncedDiscoverKeyword, setLoadingConvs, setConversations, setChannels,
  setActiveChannelId, setDiscoverKeyword, setDiscoverVisible,
}: {
  discoverVisible: boolean;
  debouncedDiscoverKeyword: string;
  setLoadingConvs: Setter<boolean>;
  setConversations: Setter<ChatConversation[]>;
  setChannels: Setter<Channel[]>;
  setActiveChannelId: Setter<number | null>;
  setDiscoverKeyword: Setter<string>;
  setDiscoverVisible: Setter<boolean>;
}) {
  const fetchConversations = useCallback(async () => {
    setLoadingConvs(true);
    const list = await api(chatContract.conversations, { silent: true }).catch(() => null);
    setLoadingConvs(false);
    if (list) setConversations(list);
  }, []);

  useEffect(() => { void fetchConversations(); }, [fetchConversations]);

  const fetchChannels = useCallback(async () => {
    const list = await api(channelContract.mine, { silent: true }).catch(() => null);
    if (list) setChannels(list);
  }, []);

  useEffect(() => { void fetchChannels(); }, [fetchChannels]);

  /** 退订频道（自带确认弹窗）：确认逻辑收敛在此，所有入口（右键菜单/频道视图按钮）直接调用即可 */
  const handleUnsubscribeChannel = useCallback((ch: Channel) => {
    confirmDanger({
      title: `确定退订「${ch.name}」吗？`,
      content: '退订后将不再接收该频道的消息推送，可随时在「发现频道」中重新订阅。',
      onOk: async () => {
        const done = await api(channelContract.unsubscribe, { params: { id: ch.id } }).then(() => true, () => false);
        if (done) {
          Toast.success('已退订');
          setActiveChannelId(null);
          void fetchChannels();
        }
      },
    });
  }, [fetchChannels]);

  const openDiscover = useCallback(() => {
    setDiscoverKeyword('');
    setDiscoverVisible(true);
  }, []);

  const discoverableChannelsQuery = useDiscoverableChannels(
    { keyword: debouncedDiscoverKeyword || undefined },
    discoverVisible,
  );
  const { data: discoverableChannels, refetch: refetchDiscoverableChannels } = discoverableChannelsQuery;
  const discoverList = discoverableChannels ?? [];

  const handleSubscribeChannel = useCallback(async (ch: Channel) => {
    const done = await api(channelContract.subscribe, { params: { id: ch.id } }).then(() => true, () => false);
    if (done) {
      Toast.success('已订阅');
      void refetchDiscoverableChannels();
      void fetchChannels();
    }
  }, [fetchChannels, refetchDiscoverableChannels]);

  return {
    fetchConversations, fetchChannels, handleUnsubscribeChannel, openDiscover, discoverList,
    handleSubscribeChannel,
  };
}