import { Dropdown, Toast } from '@douyinfe/semi-ui';
import { useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, BellOff, Bookmark, Pin, Search, Star, UserMinus } from 'lucide-react';
import { chatContract } from '@zenith/shared/chat';
import { chatKeys } from '@/hooks/queries/chat';
import { api } from '@/lib/contract-query';
import { confirmDelete } from '@/utils/confirm';
import { CursorContextDropdown } from '@/components/CursorContextDropdown';
import type { ChatConversation, ChatMessage } from '@zenith/shared/chat';
import type { Channel } from '@zenith/shared/messaging';
import { removeConversationById, toggleConvMuted, toggleConvStarred, togglePinAndSort } from '../utils-state';
import type { LeftPaneContextMenuState, Setter } from '../types';

/** 左栏右键菜单：会话（置顶/星标/免打扰/归档/删除）、频道（退订）与收藏（定位/取消收藏）（自 ChatPage 原样搬移） */
export function LeftPaneContextMenu({
  leftPaneContextMenu, setLeftPaneContextMenu, setConversations, activeConvId, setActiveConvId, setMessages,
  setPendingNewMsgCount, openFavoriteMessage, setFavPreviewVisible, handleToggleFavorite, handleTogglePinMessage,
  canPinMessage, handleUnsubscribeChannel,
}: Readonly<{
  leftPaneContextMenu: LeftPaneContextMenuState;
  setLeftPaneContextMenu: Setter<LeftPaneContextMenuState | null>;
  setConversations: Setter<ChatConversation[]>;
  activeConvId: number | null;
  setActiveConvId: Setter<number | null>;
  setMessages: Setter<ChatMessage[]>;
  setPendingNewMsgCount: Setter<number>;
  openFavoriteMessage: (message: ChatMessage) => Promise<void>;
  setFavPreviewVisible: Setter<boolean>;
  handleToggleFavorite: (msg: ChatMessage) => Promise<void>;
  handleTogglePinMessage: (msg: ChatMessage) => Promise<void>;
  /** 该消息所在会话是否允许当前用户置顶（群聊仅群主/管理员） */
  canPinMessage: (msg: ChatMessage) => boolean;
  /** 退订频道（内部自带确认弹窗） */
  handleUnsubscribeChannel: (ch: Channel) => void;
}>) {
  const queryClient = useQueryClient();
  let targetId: number;
  if (leftPaneContextMenu.type === 'conversation') targetId = leftPaneContextMenu.conv.id;
  else if (leftPaneContextMenu.type === 'channel') targetId = leftPaneContextMenu.channel.id;
  else targetId = leftPaneContextMenu.msg.id;

  const renderMenu = () => {
    if (leftPaneContextMenu.type === 'channel') {
      const { channel } = leftPaneContextMenu;
      return (
        <Dropdown.Menu>
          <Dropdown.Item
            type="danger"
            icon={<UserMinus size={13} />}
            onClick={() => {
              handleUnsubscribeChannel(channel);
              setLeftPaneContextMenu(null);
            }}
          >
            退订频道
          </Dropdown.Item>
        </Dropdown.Menu>
      );
    }
    return leftPaneContextMenu.type === 'conversation' ? (
                  <Dropdown.Menu>
                    <Dropdown.Item
                      icon={<Pin size={13} />}
                      onClick={() => {
                        const { conv } = leftPaneContextMenu;
                        const isPinned = conv.isPinned ?? false;
                        void api(chatContract.pinConversation, { params: { id: conv.id }, body: { pin: !isPinned } }).then(() => {
                          setConversations(togglePinAndSort(conv.id, isPinned));
                          Toast.success(isPinned ? '已取消置顶' : '已置顶');
                        }).catch(() => undefined);
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      {(leftPaneContextMenu.conv.isPinned ?? false) ? '取消置顶' : '置顶'}
                    </Dropdown.Item>
                    <Dropdown.Item
                      icon={<Star size={13} />}
                      onClick={() => {
                        const { conv } = leftPaneContextMenu;
                        const isStarred = conv.isStarred ?? false;
                        void api(chatContract.starConversation, { params: { id: conv.id }, body: { star: !isStarred } }).then(() => {
                          setConversations(toggleConvStarred(conv.id, isStarred));
                          Toast.success(isStarred ? '已取消星标' : '已标记星标');
                        }).catch(() => undefined);
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      {(leftPaneContextMenu.conv.isStarred ?? false) ? '取消星标' : '标记星标'}
                    </Dropdown.Item>
                    <Dropdown.Item
                      icon={<BellOff size={13} />}
                      onClick={() => {
                        const { conv } = leftPaneContextMenu;
                        const isMuted = conv.isMuted ?? false;
                        void api(chatContract.muteConversation, { params: { id: conv.id }, body: { mute: !isMuted } }).then(() => {
                          setConversations(toggleConvMuted(conv.id, isMuted));
                          // 壳层通知器从共享会话缓存读免打扰集合：同步写回，不必等它重拉
                          queryClient.setQueryData<ChatConversation[]>(chatKeys.conversations, (prev) => prev && toggleConvMuted(conv.id, isMuted)(prev));
                          Toast.success(isMuted ? '已取消免打扰' : '已开启免打扰');
                        }).catch(() => undefined);
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      {(leftPaneContextMenu.conv.isMuted ?? false) ? '取消免打扰' : '免打扰'}
                    </Dropdown.Item>
                    <Dropdown.Item
                      icon={(leftPaneContextMenu.conv.isArchived ?? false) ? <ArchiveRestore size={13} /> : <Archive size={13} />}
                      onClick={() => {
                        const { conv } = leftPaneContextMenu;
                        const isArchived = conv.isArchived ?? false;
                        void api(chatContract.archiveConversation, { params: { id: conv.id }, body: { archive: !isArchived } }).then(() => {
                          setConversations((prev) => prev.map((c) => c.id === conv.id ? { ...c, isArchived: !isArchived } : c));
                          Toast.success(isArchived ? '已取消归档' : '已归档，可在「已归档」分组中查看');
                        }).catch(() => undefined);
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      {(leftPaneContextMenu.conv.isArchived ?? false) ? '取消归档' : '归档会话'}
                    </Dropdown.Item>
                    <Dropdown.Divider />
                    <Dropdown.Item
                      type="danger"
                      onClick={() => {
                        const { conv } = leftPaneContextMenu;
                        const isOwnedGroup = conv.type === 'group' && conv.myRole === 'owner';
                        const isGroup = conv.type === 'group';
                        const removeLocal = () => {
                          setConversations(removeConversationById(conv.id));
                          if (activeConvId === conv.id) {
                            setActiveConvId(null);
                            setMessages([]);
                            setPendingNewMsgCount(0);
                          }
                        };
                        if (isOwnedGroup) {
                          // 群主不能直接退群（会产生无主群），改为解散：成员与消息一并删除
                          confirmDelete({
                            title: '确定要解散该群聊吗？',
                            content: '解散后所有成员将被移出，聊天记录一并删除且无法恢复。如需保留群聊请先转让群主。',
                            onOk: () => {
                              void api(chatContract.disbandConversation, { params: { id: conv.id } }).then(() => {
                                Toast.success('群聊已解散');
                                removeLocal();
                              }).catch(() => undefined);
                            },
                          });
                        } else {
                          confirmDelete({
                            title: isGroup ? '确定要退出该群聊吗？' : '确定要删除该会话吗？',
                            content: isGroup
                              ? '退出后将不再接收该群消息，聊天记录从你的列表中移除。'
                              : '删除后仅移除你当前账号下的会话记录，无法恢复。',
                            onOk: () => {
                              void api(chatContract.removeConversation, { params: { id: conv.id } }).then(() => {
                                Toast.success(isGroup ? '已退出群聊' : '会话已删除');
                                removeLocal();
                              }).catch(() => undefined);
                            },
                          });
                        }
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      {leftPaneContextMenu.conv.type === 'group'
                        ? (leftPaneContextMenu.conv.myRole === 'owner' ? '解散群聊' : '退出群聊')
                        : '删除会话'}
                    </Dropdown.Item>
                  </Dropdown.Menu>
                ) : (
                  <Dropdown.Menu>
                    <Dropdown.Item
                      icon={<Search size={12} />}
                      onClick={() => {
                        void openFavoriteMessage(leftPaneContextMenu.msg);
                        setFavPreviewVisible(false);
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      定位到原消息
                    </Dropdown.Item>
                    <Dropdown.Item
                      icon={<Bookmark size={12} />}
                      onClick={() => {
                        void handleToggleFavorite(leftPaneContextMenu.msg);
                        setLeftPaneContextMenu(null);
                      }}
                    >
                      取消收藏
                    </Dropdown.Item>
                    {canPinMessage(leftPaneContextMenu.msg) && (
                      <Dropdown.Item
                        icon={<Pin size={12} />}
                        onClick={() => {
                          void handleTogglePinMessage(leftPaneContextMenu.msg);
                          setLeftPaneContextMenu(null);
                        }}
                      >
                        {leftPaneContextMenu.msg.extra?.isPinned ? '取消置顶消息' : '置顶消息'}
                      </Dropdown.Item>
                    )}
                  </Dropdown.Menu>
                );
  };

  return (
    <CursorContextDropdown
      point={leftPaneContextMenu}
      contextKey={`${leftPaneContextMenu.type}:${targetId}`}
      onClose={() => setLeftPaneContextMenu(null)}
      render={renderMenu()}
    />
  );
}
