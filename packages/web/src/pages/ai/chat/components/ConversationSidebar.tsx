import type { MouseEvent, ReactNode } from 'react';
import { Button, Dropdown, Tooltip } from '@douyinfe/semi-ui';
import { Archive, ArchiveRestore, Download, Inbox, MessageSquarePlus, MoreHorizontal, Pencil, Pin, PinOff, Share2, Tags, Trash2 } from 'lucide-react';
import type { AiConversation } from '@zenith/shared/ai';
import { NavListItem, NavListPanel } from '@/components/NavListPanel';
import { confirmDelete } from '@/utils/confirm';
import type { ConvRow } from '../chat-utils';

export interface ConversationActionHandlers {
  onRename: (conv: AiConversation) => void;
  onTogglePin: (id: number) => Promise<void>;
  onToggleArchive: (id: number) => Promise<void>;
  onEditTags: (conv: AiConversation) => void;
  onShare: (id: number) => void;
  onExport: (id: number, title: string, format: 'md' | 'json') => void;
  onDelete: (id: number) => Promise<void>;
}

function MenuLabel({ icon, children }: Readonly<{ icon: ReactNode; children: ReactNode }>) {
  return <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{icon}{children}</span>;
}

/** 会话条目的「更多」菜单：重命名 / 置顶 / 归档 / 标签 / 分享 / 导出 / 删除 */
function ConversationActionsMenu({ conv, actions }: Readonly<{ conv: AiConversation; actions: ConversationActionHandlers }>) {
  const stop = (e: unknown) => (e as MouseEvent).stopPropagation();
  return (
    <Dropdown
      trigger="click"
      position="bottomRight"
      clickToHide
      render={
        <Dropdown.Menu>
          <Dropdown.Item onClick={(e) => { stop(e); actions.onRename(conv); }}>
            <MenuLabel icon={<Pencil size={13} />}>重命名</MenuLabel>
          </Dropdown.Item>
          <Dropdown.Item onClick={(e) => { stop(e); void actions.onTogglePin(conv.id); }}>
            <MenuLabel icon={conv.isPinned ? <PinOff size={13} /> : <Pin size={13} />}>
              {conv.isPinned ? '取消置顶' : '置顶'}
            </MenuLabel>
          </Dropdown.Item>
          <Dropdown.Item onClick={(e) => { stop(e); void actions.onToggleArchive(conv.id); }}>
            <MenuLabel icon={conv.isArchived ? <ArchiveRestore size={13} /> : <Archive size={13} />}>
              {conv.isArchived ? '取消归档' : '归档'}
            </MenuLabel>
          </Dropdown.Item>
          <Dropdown.Item onClick={(e) => { stop(e); actions.onEditTags(conv); }}>
            <MenuLabel icon={<Tags size={13} />}>标签</MenuLabel>
          </Dropdown.Item>
          <Dropdown.Item onClick={(e) => { stop(e); actions.onShare(conv.id); }}>
            <MenuLabel icon={<Share2 size={13} />}>分享</MenuLabel>
          </Dropdown.Item>
          <Dropdown.Item onClick={(e) => { stop(e); actions.onExport(conv.id, conv.title, 'md'); }}>
            <MenuLabel icon={<Download size={13} />}>导出 Markdown</MenuLabel>
          </Dropdown.Item>
          <Dropdown.Item onClick={(e) => { stop(e); actions.onExport(conv.id, conv.title, 'json'); }}>
            <MenuLabel icon={<Download size={13} />}>导出 JSON</MenuLabel>
          </Dropdown.Item>
          <Dropdown.Divider />
          <Dropdown.Item type="danger" onClick={(e) => { stop(e); confirmDelete({ title: '确定要删除这个会话吗？', onOk: () => actions.onDelete(conv.id) }); }}>
            <MenuLabel icon={<Trash2 size={13} />}>删除</MenuLabel>
          </Dropdown.Item>
        </Dropdown.Menu>
      }
    >
      <Button
        theme="borderless"
        size="small"
        icon={<MoreHorizontal size={13} />}
        onClick={(e) => e.stopPropagation()}
      />
    </Dropdown>
  );
}

interface ConversationSidebarProps {
  rows: ConvRow[];
  activeConvId: number | null;
  onSelect: (id: number) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  onNewConversation: () => void;
  searchKeyword: string;
  onSearchChange: (value: string) => void;
  /** 无缓存首载；后台 refetch 不进 loading 态 */
  loading: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
  actions: ConversationActionHandlers;
}

/** 左侧会话列表：归档切换 / 新建、搜索、按时间分组的会话条目与「加载更多」 */
export function ConversationSidebar({
  rows, activeConvId, onSelect, showArchived, onToggleArchived, onNewConversation,
  searchKeyword, onSearchChange, loading, hasNextPage, isFetchingNextPage, onLoadMore, actions,
}: Readonly<ConversationSidebarProps>) {
  return (
    <NavListPanel
      headerExtra={
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Tooltip content={showArchived ? '返回对话列表' : '查看已归档'}>
            <Button
              theme="borderless"
              size="small"
              type={showArchived ? 'primary' : 'tertiary'}
              icon={showArchived ? <Inbox size={14} /> : <Archive size={14} />}
              onClick={onToggleArchived}
            />
          </Tooltip>
          {!showArchived && (
            <Button
              theme="solid"
              type="primary"
              size="small"
              icon={<MessageSquarePlus size={14} />}
              onClick={onNewConversation}
            >
              新建对话
            </Button>
          )}
        </div>
      }
      search={{ value: searchKeyword, onChange: onSearchChange, placeholder: '搜索对话 / 消息内容' }}
      // isLoading = 无缓存首载;done 事件触发的列表后台 refetch 不得进 loading 态(侧栏会闪)
      loading={loading}
      emptyText={showArchived ? '暂无已归档对话' : (searchKeyword ? '未找到匹配的对话' : '暂无对话')}
      dataSource={rows}
      footer={hasNextPage ? (
        <Button
          theme="borderless"
          type="tertiary"
          size="small"
          block
          loading={isFetchingNextPage}
          onClick={onLoadMore}
        >
          加载更多
        </Button>
      ) : undefined}
      renderItem={(row) => row.kind === 'header' ? (
        <div
          key={`header-${row.label}`}
          style={{
            padding: '8px 8px 4px',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--semi-color-text-2)',
            userSelect: 'none',
          }}
        >
          {row.label}
        </div>
      ) : (
        <NavListItem
          key={row.conv.id}
          active={activeConvId === row.conv.id}
          onClick={() => onSelect(row.conv.id)}
          primary={row.conv.isPinned ? <><Pin size={11} style={{ verticalAlign: -1, marginRight: 3, color: 'var(--semi-color-primary)' }} />{row.conv.title}</> : row.conv.title}
          extraAlwaysVisible={false}
          extra={<ConversationActionsMenu conv={row.conv} actions={actions} />}
        />
      )}
    />
  );
}
