/**
 * 通知弹层（公告 / 站内信）的标记已读入口。
 *
 * 条目点击一直承担「打开详情 / 跳转深链」语义，红点随之被清掉；带深链的监控告警点了就跳走，
 * 用户想清红点却不必打开时没有出路。这里锁定两个新增动作：
 *   - 单条「已读」：只标已读，不触发条目点击（弹层不关、不跳转）
 *   - 头部「全部已读」：仅在有未读时出现
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Announcement, InAppMessage } from '@zenith/shared/messaging';
import { AnnouncementPopover, MessagePopover } from './NotificationPopovers';

const message = (id: number, isRead: boolean, link: string | null = null): InAppMessage =>
  ({ id, title: `消息 ${id}`, content: '正文', type: 'info', isRead, link, createdAt: '2026-09-14 10:00:00' }) as InAppMessage;

const announcement = (id: number, isRead: boolean): Announcement & { isRead: boolean } =>
  ({ id, title: `公告 ${id}`, content: '<p>正文</p>', publishTime: '2026-09-14 10:00:00', createdAt: '2026-09-14 10:00:00', isRead }) as Announcement & { isRead: boolean };

function renderMessages(overrides: Partial<Parameters<typeof MessagePopover>[0]> = {}) {
  const props = {
    messagePopVisible: true,
    setMessagePopVisible: vi.fn(),
    fetchInAppMessages: vi.fn(),
    inAppMessages: [message(1, false), message(2, true)],
    markAsRead: vi.fn(),
    markAllAsRead: vi.fn(),
    markAllReadPending: false,
    setSelectedMessage: vi.fn(),
    unreadCount: 1,
    navigate: vi.fn(),
    ...overrides,
  };
  render(<MessagePopover {...props} />);
  return props;
}

function renderAnnouncements(overrides: Partial<Parameters<typeof AnnouncementPopover>[0]> = {}) {
  const props = {
    announcementPopVisible: true,
    setAnnouncementPopVisible: vi.fn(),
    fetchRecentAnnouncements: vi.fn(),
    recentAnnouncements: [announcement(1, false), announcement(2, true)],
    markAnnouncementAsRead: vi.fn(),
    markAllAnnouncementsAsRead: vi.fn(),
    markAllReadPending: false,
    setSelectedAnnouncement: vi.fn(),
    announcementUnreadCount: 1,
    navigate: vi.fn(),
    ...overrides,
  };
  render(<AnnouncementPopover {...props} />);
  return props;
}

describe('通知弹层 · 单条标记已读', () => {
  it('站内信：点按钮只标已读，不触发条目点击（不跳转、不关弹层）', () => {
    const props = renderMessages();

    fireEvent.click(screen.getByRole('button', { name: '标为已读' }));

    expect(props.markAsRead).toHaveBeenCalledWith(1);
    expect(props.navigate).not.toHaveBeenCalled();
    expect(props.setSelectedMessage).not.toHaveBeenCalled();
  });

  it('公告：同样只标已读，不打开公告详情', () => {
    const props = renderAnnouncements();

    fireEvent.click(screen.getByRole('button', { name: '标为已读' }));

    expect(props.markAnnouncementAsRead).toHaveBeenCalledWith(1);
    expect(props.setSelectedAnnouncement).not.toHaveBeenCalled();
  });
});

describe('通知弹层 · 全部已读', () => {
  it('有未读时出现，点击触发对应回调', () => {
    const props = renderMessages({ unreadCount: 3 });

    fireEvent.click(screen.getByText('全部已读'));

    expect(props.markAllAsRead).toHaveBeenCalledTimes(1);
  });

  it('公告弹层同样受未读数控制', () => {
    const props = renderAnnouncements({ announcementUnreadCount: 2 });
    fireEvent.click(screen.getByText('全部已读'));
    expect(props.markAllAnnouncementsAsRead).toHaveBeenCalledTimes(1);
  });
});

describe('通知弹层 · 条目点击行为不变', () => {
  it('站内信：点条目仍按原逻辑标已读并处理深链', () => {
    const props = renderMessages({
      inAppMessages: [message(1, false, '/system/alerts')],
      unreadCount: 1,
    });

    fireEvent.click(screen.getByText('消息 1'));

    expect(props.markAsRead).toHaveBeenCalledWith(1);
    expect(props.navigate).toHaveBeenCalledWith('/system/alerts');
  });

  it('站内信：无深链时打开详情弹窗', () => {
    const props = renderMessages({ inAppMessages: [message(1, false, null)] });

    fireEvent.click(screen.getByText('消息 1'));

    expect(props.setSelectedMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});
