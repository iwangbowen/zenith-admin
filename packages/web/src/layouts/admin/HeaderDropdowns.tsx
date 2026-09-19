import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { Badge, Dropdown } from '@douyinfe/semi-ui';
import { Bell, Files, Megaphone, MoreHorizontal } from 'lucide-react';
import type { NavigateFunction } from 'react-router-dom';
import type { ThemeMode } from '@/hooks/useTheme';
import { usePreferences } from '@/hooks/usePreferences';
import { themeLabelMap } from './constants';

// 颜色模式切换下拉
export function ThemeModeDropdown({
  mode,
  handleThemeModeChange,
}: Readonly<{
  mode: ThemeMode;
  handleThemeModeChange: (newMode: ThemeMode) => void;
}>) {
  const { canEditPreference } = usePreferences();
  if (!canEditPreference('colorMode')) return null;
  return (
    <Dropdown
      position="bottomRight"
      render={
        <Dropdown.Menu>
          <Dropdown.Title>颜色模式：{themeLabelMap[mode].label}</Dropdown.Title>
          {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
            <Dropdown.Item key={m} icon={themeLabelMap[m].icon} active={mode === m} onClick={() => handleThemeModeChange(m)}>
              {themeLabelMap[m].label}
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      }
    >
      <button className="admin-theme-btn admin-theme-btn--theme" title="切换主题">
        {themeLabelMap[mode].icon}
      </button>
    </Dropdown>
  );
}

// 移动端页面入口与常用功能入口分离
export function PagesDropdown({
  isMobileNav,
  mobilePagesVisible,
  setMobilePagesVisible,
  mobileQuickPagesPanel,
}: Readonly<{
  isMobileNav: boolean;
  mobilePagesVisible: boolean;
  setMobilePagesVisible: Dispatch<SetStateAction<boolean>>;
  mobileQuickPagesPanel: ReactNode;
}>) {
  return (
    <div className="admin-header-action admin-header-action--pages">
      <Dropdown
        position="bottomRight"
        visible={isMobileNav ? mobilePagesVisible : undefined}
        onVisibleChange={isMobileNav ? setMobilePagesVisible : undefined}
        render={mobileQuickPagesPanel}
      >
        <button className="admin-theme-btn" title="页面">
          <Files size={16} strokeWidth={1.5} />
        </button>
      </Dropdown>
    </div>
  );
}

// 窄屏「更多」下拉：聚合公告 / 消息 / 颜色模式
export function MoreDropdown({
  navigate,
  announcementUnreadCount,
  unreadCount,
  mode,
  handleThemeModeChange,
}: Readonly<{
  navigate: NavigateFunction;
  announcementUnreadCount: number;
  unreadCount: number;
  mode: ThemeMode;
  handleThemeModeChange: (newMode: ThemeMode) => void;
}>) {
  const { canEditPreference } = usePreferences();
  return (
    <div className="admin-header-action admin-header-action--more">
      <Dropdown
        position="bottomRight"
        clickToHide
        render={
          <Dropdown.Menu>
            <Dropdown.Item
              icon={<Megaphone size={14} strokeWidth={1.5} />}
              onClick={() => navigate('/announcements')}
            >
              公告中心{announcementUnreadCount > 0 && <Badge count={announcementUnreadCount} overflowCount={99} type="danger" style={{ marginLeft: 6 }} />}
            </Dropdown.Item>
            <Dropdown.Item
              icon={<Bell size={14} strokeWidth={1.5} />}
              onClick={() => navigate('/inbox')}
            >
              站内信{unreadCount > 0 && <Badge count={unreadCount} overflowCount={99} type="danger" style={{ marginLeft: 6 }} />}
            </Dropdown.Item>
            {canEditPreference('colorMode') ? <>
              <Dropdown.Divider />
              <Dropdown.Title>颜色模式</Dropdown.Title>
              {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
              <Dropdown.Item key={m} icon={themeLabelMap[m].icon} active={mode === m} onClick={() => handleThemeModeChange(m)}>
                {themeLabelMap[m].label}
              </Dropdown.Item>
              ))}
            </> : null}
          </Dropdown.Menu>
        }
      >
        <button className="admin-theme-btn" title="更多">
          <MoreHorizontal size={16} strokeWidth={1.5} />
        </button>
      </Dropdown>
    </div>
  );
}
