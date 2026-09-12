import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Badge, Button, Empty, List, Popover, Typography } from '@douyinfe/semi-ui';
import { Bell, Megaphone } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import type { InAppMessage, Announcement } from '@zenith/shared/messaging';
import { formatDateTime } from '@/utils/date';
import { emptyIllustration } from '@/components/EmptyIllustration';

interface NotificationItem {
  id: number;
  title: string;
  isRead: boolean;
}

interface NotificationPopoverProps<T extends NotificationItem> {
  visible: boolean;
  setVisible: Dispatch<SetStateAction<boolean>>;
  /** 弹层打开时拉取最新列表 */
  onOpen: () => void;
  title: string;
  emptyText: string;
  items: T[];
  /** 列表项摘要文本（公告为去 HTML 后的正文，站内信为原文） */
  summaryOf: (item: T) => string;
  /** 列表项时间（已格式化） */
  timeOf: (item: T) => string;
  /** 点击列表项：标记已读、跳转 / 打开详情由调用方决定；弹层会先关闭 */
  onItemClick: (item: T) => void;
  /** 「查看全部」跳转路径 */
  viewAllPath: string;
  unreadCount: number;
  navigate: NavigateFunction;
  icon: ReactNode;
  iconTitle: string;
  actionClassName: string;
}

/** 顶栏通知类悬浮弹层的公共壳：标题 → 列表 / 空态 → 「查看全部」，公告与站内信只差数据与点击行为 */
function NotificationPopover<T extends NotificationItem>({
  visible,
  setVisible,
  onOpen,
  title,
  emptyText,
  items,
  summaryOf,
  timeOf,
  onItemClick,
  viewAllPath,
  unreadCount,
  navigate,
  icon,
  iconTitle,
  actionClassName,
}: Readonly<NotificationPopoverProps<T>>) {
  return (
    <Popover
      visible={visible}
      onVisibleChange={(v) => { setVisible(v); if (v) onOpen(); }}
      position="bottomRight"
      trigger="hover"
      mouseEnterDelay={200}
      mouseLeaveDelay={300}
      showArrow
      content={
        <div style={{ width: 360, maxHeight: 440, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px 8px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid var(--semi-color-border)' }}>
            {title}
          </div>
          {items.length === 0 ? (
            <Empty
              {...emptyIllustration('Idle', 80)}
              description={emptyText} style={{ padding: '24px 0' }} />
          ) : (
            <List
              style={{ overflow: 'auto', maxHeight: 340 }}
              dataSource={items}
              renderItem={(item: T) => (
                <List.Item
                  key={item.id}
                  style={{ padding: '10px 16px', cursor: 'pointer', opacity: item.isRead ? 0.55 : 1 }}
                  onClick={() => {
                    setVisible(false);
                    onItemClick(item);
                  }}
                  header={null}
                  main={
                    <div>
                      <Typography.Text strong style={{ fontSize: 13 }}>{item.title}</Typography.Text>
                      <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', margin: '3px 0 4px', maxHeight: 40, overflow: 'hidden', lineHeight: 1.5 }}>
                        {summaryOf(item)}
                      </div>
                      <Typography.Text style={{ fontSize: 11, color: 'var(--semi-color-text-3)' }}>
                        {timeOf(item)}
                      </Typography.Text>
                    </div>
                  }
                />
              )}
            />
          )}
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--semi-color-border)', textAlign: 'center' }}>
            <Button theme="borderless" type="primary" size="small" onClick={() => { setVisible(false); navigate(viewAllPath); }}>
              查看全部
            </Button>
          </div>
        </div>
      }
    >
      <div className={`admin-header-action ${actionClassName}`} style={{ display: 'inline-flex', cursor: 'pointer' }}>
        <Badge dot={unreadCount > 0} className="admin-notify-badge" style={{ zIndex: 1 }}>
          <button className="admin-theme-btn" title={iconTitle}>
            {icon}
          </button>
        </Badge>
      </div>
    </Popover>
  );
}

// 公告悬浮弹层（顶栏喇叭图标）
export function AnnouncementPopover({
  announcementPopVisible,
  setAnnouncementPopVisible,
  fetchRecentAnnouncements,
  recentAnnouncements,
  markAnnouncementAsRead,
  setSelectedAnnouncement,
  announcementUnreadCount,
  navigate,
}: Readonly<{
  announcementPopVisible: boolean;
  setAnnouncementPopVisible: Dispatch<SetStateAction<boolean>>;
  fetchRecentAnnouncements: () => void;
  recentAnnouncements: (Announcement & { isRead: boolean })[];
  markAnnouncementAsRead: (id: number) => void;
  setSelectedAnnouncement: Dispatch<SetStateAction<Announcement | null>>;
  announcementUnreadCount: number;
  navigate: NavigateFunction;
}>) {
  return (
    <NotificationPopover
      visible={announcementPopVisible}
      setVisible={setAnnouncementPopVisible}
      onOpen={fetchRecentAnnouncements}
      title="最新公告"
      emptyText="暂无公告"
      items={recentAnnouncements}
      summaryOf={(item) => item.content.replace(/<[^>]*>/g, '')}
      timeOf={(item) => formatDateTime(item.publishTime ?? item.createdAt)}
      onItemClick={(item) => {
        if (!item.isRead) markAnnouncementAsRead(item.id);
        setSelectedAnnouncement(item);
      }}
      viewAllPath="/announcements"
      unreadCount={announcementUnreadCount}
      navigate={navigate}
      icon={<Megaphone size={16} strokeWidth={1.5} />}
      iconTitle="公告中心"
      actionClassName="admin-header-action--announce"
    />
  );
}

// 站内信悬浮弹层（顶栏铃铛图标）
export function MessagePopover({
  messagePopVisible,
  setMessagePopVisible,
  fetchInAppMessages,
  inAppMessages,
  markAsRead,
  setSelectedMessage,
  unreadCount,
  navigate,
}: Readonly<{
  messagePopVisible: boolean;
  setMessagePopVisible: Dispatch<SetStateAction<boolean>>;
  fetchInAppMessages: () => void;
  inAppMessages: InAppMessage[];
  markAsRead: (id: number) => void;
  setSelectedMessage: Dispatch<SetStateAction<InAppMessage | null>>;
  unreadCount: number;
  navigate: NavigateFunction;
}>) {
  return (
    <NotificationPopover
      visible={messagePopVisible}
      setVisible={setMessagePopVisible}
      onOpen={fetchInAppMessages}
      title="最新消息"
      emptyText="暂无消息"
      items={inAppMessages}
      summaryOf={(item) => item.content}
      timeOf={(item) => formatDateTime(item.createdAt)}
      onItemClick={(item) => {
        if (!item.isRead) markAsRead(item.id);
        // 带深链的消息（如待办提醒）直接跳转对应页面并自动弹出详情
        if (item.link) navigate(item.link);
        else setSelectedMessage(item);
      }}
      viewAllPath="/inbox"
      unreadCount={unreadCount}
      navigate={navigate}
      icon={<Bell size={16} strokeWidth={1.5} />}
      iconTitle="我的消息"
      actionClassName="admin-header-action--message"
    />
  );
}