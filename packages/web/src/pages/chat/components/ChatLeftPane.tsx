import type { ComponentProps } from 'react';
import { Badge, Button, Empty, Input, Spin, Tooltip, Typography, List as SemiList } from '@douyinfe/semi-ui';
import { Bookmark, Compass, ExternalLink, MessageSquarePlus, Search, X } from 'lucide-react';
import type { ChatConversation, ChatMessage } from '@zenith/shared/chat';
import { AppModal } from '@/components/AppModal';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import type { LeftListItem, LeftPaneContextMenuState, LeftPaneMode, Setter } from '../types';
import { NewChatPanel } from './NewChatPanel';
import { ArchiveToggle } from './ArchiveToggle';
import { LeftListRow } from './LeftListRow';
import { FavoriteListRow } from './FavoriteListRow';
import { GlobalSearchPane } from './GlobalSearchPane';
import { LeftPaneContextMenu } from './LeftPaneContextMenu';

const { Title } = Typography;

/** 会话 / 频道行的透传属性（LeftListRow 除 item 外的全部入参） */
export type LeftListRowProps = Omit<ComponentProps<typeof LeftListRow>, 'item'>;
/** 全局搜索面板的透传属性（视图模式由本组件注入） */
export type GlobalSearchProps = Omit<ComponentProps<typeof GlobalSearchPane>, 'leftPaneMode'>;
/** 右键菜单的透传属性（菜单状态与 setter 由本组件注入） */
export type LeftPaneContextMenuProps = Omit<ComponentProps<typeof LeftPaneContextMenu>, 'leftPaneContextMenu' | 'setLeftPaneContextMenu'>;

interface ChatLeftPaneProps {
  isQuick: boolean;
  onOpenFullPage?: (convId?: number | null) => void;
  onClose?: () => void;
  activeConvId: number | null;
  totalUnread: number;
  openDiscover: () => void;
  showNewChat: boolean;
  setShowNewChat: Setter<boolean>;
  handleNewDirectChat: ComponentProps<typeof NewChatPanel>['onSelectUser'];
  handleGroupCreated: ComponentProps<typeof NewChatPanel>['onGroupCreated'];
  convSearch: string;
  setConvSearch: (value: string) => void;
  leftPaneMode: LeftPaneMode;
  setLeftPaneMode: Setter<LeftPaneMode>;
  loadingConvs: boolean;
  // ── 会话列表 ──
  showArchiveToggle: boolean;
  showArchived: boolean;
  setShowArchived: Setter<boolean>;
  archivedConvs: ChatConversation[];
  archivedUnread: number;
  leftListItems: LeftListItem[];
  listRowProps: LeftListRowProps;
  // ── 收藏列表 ──
  favoriteMessages: ChatMessage[];
  conversations: ChatConversation[];
  setFavPreviewMsg: Setter<ChatMessage | null>;
  setFavPreviewVisible: Setter<boolean>;
  // ── 全局搜索 / 右键菜单 ──
  globalSearch: GlobalSearchProps;
  leftPaneContextMenu: LeftPaneContextMenuState | null;
  setLeftPaneContextMenu: Setter<LeftPaneContextMenuState | null>;
  contextMenuProps: LeftPaneContextMenuProps;
}

/** 左栏：头部操作（发现频道 / 新建对话 / 快捷面板控制）、会话搜索、视图切换与三种列表（会话 / 收藏 / 全局搜索） */
export function ChatLeftPane({
  isQuick, onOpenFullPage, onClose, activeConvId, totalUnread, openDiscover, showNewChat, setShowNewChat,
  handleNewDirectChat, handleGroupCreated, convSearch, setConvSearch, leftPaneMode, setLeftPaneMode, loadingConvs,
  showArchiveToggle, showArchived, setShowArchived, archivedConvs, archivedUnread, leftListItems, listRowProps,
  favoriteMessages, conversations, setFavPreviewMsg, setFavPreviewVisible,
  globalSearch, leftPaneContextMenu, setLeftPaneContextMenu, contextMenuProps,
}: Readonly<ChatLeftPaneProps>) {
  return (
    <>
      <MasterDetailLayout.Header
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Tooltip content="发现频道">
              <Button
                size="small" theme="borderless" type="primary"
                icon={<Compass size={16} />}
                aria-label="发现频道"
                onClick={openDiscover}
              />
            </Tooltip>
            <Tooltip content="新建对话">
              <Button
                size="small" theme="borderless" type="primary"
                icon={<MessageSquarePlus size={16} />}
                aria-label="新建对话"
                onClick={() => setShowNewChat((v) => !v)}
              />
            </Tooltip>
            {isQuick && onOpenFullPage && (
              <Tooltip content="前往聊天页">
                <Button
                  size="small"
                  theme="borderless"
                  type="tertiary"
                  icon={<ExternalLink size={15} />}
                  aria-label="前往聊天页"
                  onClick={() => onOpenFullPage(activeConvId)}
                />
              </Tooltip>
            )}
            {isQuick && onClose && (
              <Tooltip content="关闭">
                <Button
                  size="small"
                  theme="borderless"
                  type="tertiary"
                  icon={<X size={15} />}
                  aria-label="关闭"
                  onClick={onClose}
                />
              </Tooltip>
            )}
          </div>
        }
      >
        {totalUnread > 0 ? (
          <Badge count={totalUnread} overflowCount={99}>
            <Title heading={6} style={{ margin: 0 }}>消息</Title>
          </Badge>
        ) : (
          <Title heading={6} style={{ margin: 0 }}>消息</Title>
        )}
      </MasterDetailLayout.Header>

      {showNewChat && (
        <AppModal
          title="新建对话"
          visible={showNewChat}
          onCancel={() => setShowNewChat(false)}
          footer={null}
          width={480}
          centered
        >
          <NewChatPanel
            onSelectUser={(u) => { handleNewDirectChat(u); setShowNewChat(false); }}
            onGroupCreated={(c) => { handleGroupCreated(c); setShowNewChat(false); }}
          />
        </AppModal>
      )}

      <div style={{ padding: '8px 12px' }}>
        <Input prefix={<Search size={13} />} placeholder="搜索会话" size="small" value={convSearch} onChange={setConvSearch} />
      </div>

      <div style={{ padding: '0 12px 8px', display: 'flex', gap: 8 }}>
        <Button
          size="small"
          theme={leftPaneMode === 'conversations' ? 'solid' : 'borderless'}
          type={leftPaneMode === 'conversations' ? 'primary' : 'tertiary'}
          onClick={() => setLeftPaneMode('conversations')}
        >
          消息
        </Button>
        <Button
          size="small"
          theme={leftPaneMode === 'favorites' ? 'solid' : 'borderless'}
          type={leftPaneMode === 'favorites' ? 'primary' : 'tertiary'}
          icon={<Bookmark size={13} />}
          onClick={() => setLeftPaneMode('favorites')}
        >
          收藏
        </Button>
        <Button
          size="small"
          theme={leftPaneMode === 'globalSearch' ? 'solid' : 'borderless'}
          type={leftPaneMode === 'globalSearch' ? 'primary' : 'tertiary'}
          icon={<Search size={13} />}
          onClick={() => setLeftPaneMode('globalSearch')}
        >
          搜索
        </Button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', minWidth: 0 }}>
        <Spin spinning={loadingConvs}>
          {leftPaneMode === 'conversations' && showArchiveToggle && (
            <ArchiveToggle
              showArchived={showArchived} setShowArchived={setShowArchived} archivedConvs={archivedConvs}
              archivedUnread={archivedUnread}
            />
          )}
          {leftPaneMode === 'conversations' && (
            <SemiList
              className="chat-conv-list"
              dataSource={leftListItems}
              emptyContent={loadingConvs ? null : <Empty description="暂无会话" style={{ padding: '40px 0' }} imageStyle={{ width: 80 }} />}
              split={false}
              renderItem={(item: LeftListItem) => (
                <LeftListRow
                  key={item.kind === 'channel' ? `channel-${item.channel.id}` : item.conv.id}
                  item={item}
                  {...listRowProps}
                />
              )}
            />
          )}
          {leftPaneMode === 'favorites' && (
            <SemiList
              className="chat-conv-list"
              dataSource={favoriteMessages}
              emptyContent={loadingConvs ? null : <Empty description="暂无收藏消息" style={{ padding: '40px 0' }} imageStyle={{ width: 80 }} />}
              split={false}
              renderItem={(msg: ChatMessage) => (
                <FavoriteListRow
                  key={msg.id}
                  msg={msg} conversations={conversations} setFavPreviewMsg={setFavPreviewMsg}
                  setFavPreviewVisible={setFavPreviewVisible} setLeftPaneContextMenu={setLeftPaneContextMenu}
                />
              )}
            />
          )}
          <GlobalSearchPane leftPaneMode={leftPaneMode} {...globalSearch} />
          {leftPaneContextMenu && (
            <LeftPaneContextMenu
              leftPaneContextMenu={leftPaneContextMenu}
              setLeftPaneContextMenu={setLeftPaneContextMenu}
              {...contextMenuProps}
            />
          )}
        </Spin>
      </div>
    </>
  );
}
