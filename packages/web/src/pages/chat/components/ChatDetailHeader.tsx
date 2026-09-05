import type { CSSProperties } from 'react';
import { Badge, Button, Tooltip } from '@douyinfe/semi-ui';
import { ArrowLeft, Download, ExternalLink, History, Images, MoreHorizontal, Phone, Search, Video, X } from 'lucide-react';
import type { ChatConversation } from '@zenith/shared/chat';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import type { GroupAvatarMap, Setter } from '../types';
import type { NotifyPrefs } from '../hooks/useNotifyPrefs';
import { ChatConvTitle } from './ChatConvTitle';
import { NotifySettingsPopover } from './NotifySettingsPopover';

interface ChatDetailHeaderProps {
  activeConv: ChatConversation;
  activeConvId: number | null;
  isQuick: boolean;
  onOpenFullPage?: (convId?: number | null) => void;
  onClose?: () => void;
  setActiveConvId: Setter<number | null>;
  // ── 完整页专有工具 ──
  announcementHistoryVisible: boolean;
  setAnnouncementHistoryVisible: Setter<boolean>;
  handleStartCall: (callType: 'audio' | 'video') => void;
  notifyPrefs: NotifyPrefs;
  showSearchPanel: boolean;
  setShowSearchPanel: Setter<boolean>;
  showMediaPanel: boolean;
  setShowMediaPanel: Setter<boolean>;
  showMembers: boolean;
  setShowMembers: Setter<boolean>;
  canExport: boolean;
  exportingChat: boolean;
  handleExportChat: (convId: number) => Promise<void>;
  pendingJoinRequestCount: number;
  // ── 标题区 ──
  onlineUserIds: Set<number>;
  lastSeenMap: Record<number, string | null>;
  groupAvatarMap: GroupAvatarMap;
  style?: CSSProperties;
}

/** 会话头部：标题 / 在线状态 + 右侧工具（公告历史、通话、通知设置、聊天记录、媒体库、导出、群信息；快捷面板仅保留返回 / 前往 / 关闭） */
export function ChatDetailHeader({
  activeConv, activeConvId, isQuick, onOpenFullPage, onClose, setActiveConvId,
  announcementHistoryVisible, setAnnouncementHistoryVisible, handleStartCall, notifyPrefs,
  showSearchPanel, setShowSearchPanel, showMediaPanel, setShowMediaPanel, showMembers, setShowMembers,
  canExport, exportingChat, handleExportChat, pendingJoinRequestCount,
  onlineUserIds, lastSeenMap, groupAvatarMap, style,
}: Readonly<ChatDetailHeaderProps>) {
  return (
    <MasterDetailLayout.Header
      style={style}
      extra={
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {!isQuick && (
            <>
              {activeConv.type === 'group' && (
                <Tooltip content="群公告历史">
                  <Button
                    size="small"
                    theme="borderless"
                    type={announcementHistoryVisible ? 'primary' : 'tertiary'}
                    icon={<History size={15} />}
                    aria-label="群公告历史"
                    onClick={() => {
                      if (!activeConvId) return;
                      setAnnouncementHistoryVisible(true);
                    }}
                  />
                </Tooltip>
              )}
              <Tooltip content={activeConv.type === 'group' ? '群语音通话' : '语音通话'}>
                <Button
                  size="small"
                  theme="borderless"
                  type="tertiary"
                  icon={<Phone size={15} />}
                  aria-label={activeConv.type === 'group' ? '群语音通话' : '语音通话'}
                  onClick={() => handleStartCall('audio')}
                />
              </Tooltip>
              <Tooltip content={activeConv.type === 'group' ? '群视频通话' : '视频通话'}>
                <Button
                  size="small"
                  theme="borderless"
                  type="tertiary"
                  icon={<Video size={15} />}
                  aria-label={activeConv.type === 'group' ? '群视频通话' : '视频通话'}
                  onClick={() => handleStartCall('video')}
                />
              </Tooltip>
              <NotifySettingsPopover
                notifyDesktop={notifyPrefs.notifyDesktop} notifyPermission={notifyPrefs.notifyPermission} notifySound={notifyPrefs.notifySound}
                handleToggleNotifyDesktop={notifyPrefs.handleToggleNotifyDesktop} handleToggleNotifySound={notifyPrefs.handleToggleNotifySound}
              />
              <Tooltip content={showSearchPanel ? '关闭聊天记录' : '聊天记录'}>
                <Button
                  size="small"
                  theme="borderless"
                  type={showSearchPanel ? 'primary' : 'tertiary'}
                  icon={<Search size={15} />}
                  aria-label={showSearchPanel ? '关闭聊天记录' : '聊天记录'}
                  onClick={() => {
                    setShowSearchPanel((v) => {
                      const next = !v;
                      if (next) { setShowMembers(false); setShowMediaPanel(false); }
                      return next;
                    });
                  }}
                />
              </Tooltip>
              <Tooltip content={showMediaPanel ? '关闭媒体库' : '图片与文件'}>
                <Button
                  size="small"
                  theme="borderless"
                  type={showMediaPanel ? 'primary' : 'tertiary'}
                  icon={<Images size={15} />}
                  aria-label={showMediaPanel ? '关闭媒体库' : '图片与文件'}
                  onClick={() => {
                    setShowMediaPanel((v) => {
                      const next = !v;
                      if (next) { setShowMembers(false); setShowSearchPanel(false); }
                      return next;
                    });
                  }}
                />
              </Tooltip>
              {canExport && (
                <Tooltip content="导出聊天记录">
                  <Button
                    size="small"
                    theme="borderless"
                    type="tertiary"
                    icon={<Download size={15} />}
                    aria-label="导出聊天记录"
                    loading={exportingChat}
                    onClick={() => { if (activeConvId) void handleExportChat(activeConvId); }}
                  />
                </Tooltip>
              )}
              {activeConv.type === 'group' && (
                <Tooltip content={showMembers ? '关闭群信息' : '群信息'}>
                  <Badge count={pendingJoinRequestCount > 0 ? pendingJoinRequestCount : undefined} type="danger">
                    <Button
                      size="small" theme="borderless" type={showMembers ? 'primary' : 'tertiary'}
                      icon={<MoreHorizontal size={15} />}
                      aria-label={showMembers ? '关闭群信息' : '群信息'}
                      onClick={() => {
                        setShowMembers((v) => {
                          const next = !v;
                          if (next) { setShowSearchPanel(false); setShowMediaPanel(false); }
                          return next;
                        });
                      }}
                    />
                  </Badge>
                </Tooltip>
              )}
            </>
          )}
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
                onClick={onClose}
              />
            </Tooltip>
          )}
        </div>
      }
    >
      {isQuick && (
        <Tooltip content="返回会话列表">
          <Button
            size="small"
            theme="borderless"
            type="tertiary"
            icon={<ArrowLeft size={16} />}
            onClick={() => setActiveConvId(null)}
          />
        </Tooltip>
      )}
      <ChatConvTitle
        activeConv={activeConv} isQuick={isQuick} onlineUserIds={onlineUserIds}
        lastSeenMap={lastSeenMap} groupAvatarMap={groupAvatarMap}
      />
    </MasterDetailLayout.Header>
  );
}
