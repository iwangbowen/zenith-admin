import { useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { Avatar, Dropdown } from '@douyinfe/semi-ui';
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
import './AdminLayout.css';

interface AdminLayoutProps {
  user: Omit<User, 'password'>;
  onLogout: () => void;
}

const menuItems = [
  { path: '/', text: '首页', icon: <IconHome />, end: true },
  { path: '/users', text: '用户管理', icon: <IconUser />, end: false },
  { path: '/components', text: '组件示例', icon: <IconGridView />, end: false },
];

export default function AdminLayout({ user, onLogout }: AdminLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);

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
