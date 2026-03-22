import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { Avatar, Dropdown, Tooltip } from '@douyinfe/semi-ui';
import {
  IconHome,
  IconUser,
  IconGridView,
  IconChevronLeft,
  IconChevronRight,
  IconExit,
  IconSetting,
} from '@douyinfe/semi-icons';
import type { User } from '@zenith/shared';
import { useTheme, type ThemeMode } from '../hooks/useTheme';
import './AdminLayout.css';

// 主题图标 — 内联 SVG 避免字体问题
function SunIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

const themeLabelMap: Record<ThemeMode, { label: string; icon: React.ReactNode }> = {
  light: { label: '浅色', icon: <SunIcon /> },
  dark:  { label: '深色', icon: <MoonIcon /> },
  system: { label: '跟随系统', icon: <MonitorIcon /> },
};

interface AdminLayoutProps {
  readonly user: Omit<User, 'password'>;
  readonly onLogout: () => void;
}

const menuItems = [
  { path: '/', text: '首页', icon: <IconHome />, end: true },
  { path: '/users', text: '用户管理', icon: <IconUser />, end: false },
  { path: '/components', text: '组件示例', icon: <IconGridView />, end: false },
];

export default function AdminLayout({ user, onLogout }: AdminLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { mode, setThemeMode } = useTheme();

  return (
    <div className="admin-layout">
      {/* Sidebar */}
      <aside className={`admin-sidebar${collapsed ? ' admin-sidebar--collapsed' : ''}`}>
        <div className="admin-sidebar__header">
          <div className="admin-sidebar__logo">Z</div>
          {!collapsed && <span className="admin-sidebar__title">Zenith Admin</span>}
        </div>

        <nav className="admin-sidebar__nav">
          {menuItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.end}
              className={({ isActive }) =>
                `admin-nav-item${isActive ? ' admin-nav-item--active' : ''}`
              }
            >
              <span className="admin-nav-item__icon">{item.icon}</span>
              {!collapsed && <span className="admin-nav-item__text">{item.text}</span>}
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar__footer">
          <button
            className="admin-collapse-btn"
            onClick={() => setCollapsed(!collapsed)}
            title={collapsed ? '展开侧边栏' : '收起侧边栏'}
          >
            {collapsed ? <IconChevronRight size="small" /> : <IconChevronLeft size="small" />}
            {!collapsed && <span>收起侧边栏</span>}
          </button>
        </div>
      </aside>

      {/* Main area */}
      <div className="admin-main">
        {/* Header */}
        <header className="admin-header">
          <div />
          <div className="admin-header__actions">
            {/* 主题切换 */}
            <Tooltip content={
              <span>颜色模式：{themeLabelMap[mode].label}</span>
            } position="bottom">
              <Dropdown
                position="bottomRight"
                render={
                  <Dropdown.Menu>
                    {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
                      <Dropdown.Item
                        key={m}
                        icon={themeLabelMap[m].icon}
                        active={mode === m}
                        onClick={() => setThemeMode(m)}
                      >
                        {themeLabelMap[m].label}
                      </Dropdown.Item>
                    ))}
                  </Dropdown.Menu>
                }
              >
                <button className="admin-theme-btn" title="切换主题">
                  {themeLabelMap[mode].icon}
                </button>
              </Dropdown>
            </Tooltip>
            <Dropdown
              position="bottomRight"
              render={
                <Dropdown.Menu>
                  <Dropdown.Item icon={<IconSetting />}>设置</Dropdown.Item>
                  <Dropdown.Divider />
                  <Dropdown.Item icon={<IconExit />} onClick={onLogout}>
                    退出登录
                  </Dropdown.Item>
                </Dropdown.Menu>
              }
            >
              <div className="admin-header__user">
                <Avatar size="small" color="blue" style={{ fontSize: 12, flexShrink: 0 }}>
                  {user.nickname?.charAt(0)?.toUpperCase() || 'U'}
                </Avatar>
                <span className="admin-header__username">{user.nickname}</span>
              </div>
            </Dropdown>
          </div>
        </header>
        <div
          className="admin-content"
          style={{
            background: 'var(--color-bg)',
            overflow: 'auto',
            position: 'relative',
          }}
        >
          <Outlet />
        </div>
      </div>
    </div>
  );
}
