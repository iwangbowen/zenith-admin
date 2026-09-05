import { lazy, Suspense, type Dispatch, type SetStateAction } from 'react';
import { Badge, Button, Empty, List, Popover, Typography } from '@douyinfe/semi-ui';
import { Bell, Megaphone } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import type { InAppMessage, Announcement } from '@zenith/shared/messaging';
import { formatDateTime } from '@/utils/date';

// 空态插图只在打开弹层且列表为空时出现，懒加载使 ~130KB 的 semi-illustrations 不随布局首屏下载
const IllustrationIdle = lazy(() => import('@douyinfe/semi-illustrations').then((m) => ({ default: m.IllustrationIdle })));
const IllustrationIdleDark = lazy(() => import('@douyinfe/semi-illustrations').then((m) => ({ default: m.IllustrationIdleDark })));

const idleImage = <Suspense fallback={null}><IllustrationIdle style={{ width: 80, height: 80 }} /></Suspense>;
const idleImageDark = <Suspense fallback={null}><IllustrationIdleDark style={{ width: 80, height: 80 }} /></Suspense>;

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
    <Popover
      visible={announcementPopVisible}
      onVisibleChange={(v) => { setAnnouncementPopVisible(v); if (v) fetchRecentAnnouncements(); }}
      position="bottomRight"
      trigger="hover"
      mouseEnterDelay={200}
      mouseLeaveDelay={300}
      showArrow
      content={
        <div style={{ width: 360, maxHeight: 440, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px 8px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid var(--semi-color-border)' }}>
            最新公告
          </div>
          {recentAnnouncements.length === 0 ? (
            <Empty
              image={idleImage}
              darkModeImage={idleImageDark}
              description="暂无公告" style={{ padding: '24px 0' }} />
          ) : (
            <List
              style={{ overflow: 'auto', maxHeight: 340 }}
              dataSource={recentAnnouncements}
              renderItem={(item) => (
                <List.Item
                  key={item.id}
                  style={{ padding: '10px 16px', cursor: 'pointer', opacity: item.isRead ? 0.55 : 1 }}
                  onClick={() => {
                    if (!item.isRead) markAnnouncementAsRead(item.id);
                    setAnnouncementPopVisible(false);
                    setSelectedAnnouncement(item);
                  }}
                  header={null}
                  main={
                    <div>
                      <Typography.Text strong style={{ fontSize: 13 }}>{item.title}</Typography.Text>
                      <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', margin: '3px 0 4px', maxHeight: 40, overflow: 'hidden', lineHeight: 1.5 }}>
                        {item.content.replace(/<[^>]*>/g, '')}
                      </div>
                      <Typography.Text style={{ fontSize: 11, color: 'var(--semi-color-text-3)' }}>
                        {formatDateTime(item.publishTime ?? item.createdAt)}
                      </Typography.Text>
                    </div>
                  }
                />
              )}
            />
          )}
          <div style={{ padding: '8px 16px', borderTop: '1px solid var(--semi-color-border)', textAlign: 'center' }}>
            <Button theme="borderless" type="primary" size="small" onClick={() => { setAnnouncementPopVisible(false); navigate('/announcements'); }}>
              查看全部
            </Button>
          </div>
        </div>
      }
    >
      <div className="admin-header-action admin-header-action--announce" style={{ display: 'inline-flex', cursor: 'pointer' }}>
        <Badge dot={announcementUnreadCount > 0} className="admin-notify-badge" style={{ zIndex: 1 }}>
          <button className="admin-theme-btn" title="公告中心">
            <Megaphone size={16} strokeWidth={1.5} />
          </button>
        </Badge>
      </div>
    </Popover>
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
    <Popover
      visible={messagePopVisible}
      onVisibleChange={(v) => { setMessagePopVisible(v); if (v) fetchInAppMessages(); }}
      position="bottomRight"
      trigger="hover"
      mouseEnterDelay={200}
      mouseLeaveDelay={300}
      showArrow
      content={
        <div style={{ width: 360, maxHeight: 440, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 16px 8px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid var(--semi-color-border)' }}>
            最新消息
          </div>
          {inAppMessages.length === 0 ? (
            <Empty
              image={idleImage}
              darkModeImage={idleImageDark}
              description="暂无消息" style={{ padding: '24px 0' }} />
          ) : (
            <List
              style={{ overflow: 'auto', maxHeight: 340 }}
              dataSource={inAppMessages}
              renderItem={(item: InAppMessage) => (
                <List.Item
                  key={item.id}
                  style={{ padding: '10px 16px', cursor: 'pointer', opacity: item.isRead ? 0.55 : 1 }}
                  onClick={() => {
                    if (!item.isRead) markAsRead(item.id);
                    setMessagePopVisible(false);
                    // 带深链的消息（如待办提醒）直接跳转对应页面并自动弹出详情
                    if (item.link) navigate(item.link);
                    else setSelectedMessage(item);
                  }}
                  header={null}
                  main={
                    <div>
                      <Typography.Text strong style={{ fontSize: 13 }}>{item.title}</Typography.Text>
                      <div
                        style={{ fontSize: 12, color: 'var(--semi-color-text-2)', margin: '3px 0 4px', maxHeight: 40, overflow: 'hidden', lineHeight: 1.5 }}
                      >
                        {item.content}
                      </div>
                      <Typography.Text style={{ fontSize: 11, color: 'var(--semi-color-text-3)' }}>
                        {formatDateTime(item.createdAt)}
                      </Typography.Text>
                    </div>
                  }
                />
              )}
            />
          )}
          <div
            style={{
              padding: '8px 16px',
              borderTop: '1px solid var(--semi-color-border)',
              textAlign: 'center',
            }}
          >
            <Button
              theme="borderless"
              type="primary"
              size="small"
              onClick={() => {
                setMessagePopVisible(false);
                navigate('/inbox');
              }}
            >
              查看全部
            </Button>
          </div>
        </div>
      }
    >
      <div className="admin-header-action admin-header-action--message" style={{ display: 'inline-flex', cursor: 'pointer' }}>
        <Badge dot={unreadCount > 0} className="admin-notify-badge" style={{ zIndex: 1 }}>
          <button className="admin-theme-btn" title="我的消息">
            <Bell size={16} strokeWidth={1.5} />
          </button>
        </Badge>
      </div>
    </Popover>
  );
}
