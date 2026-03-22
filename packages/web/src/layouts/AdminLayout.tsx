import { useEffect, useMemo, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Dropdown, Tooltip, Modal, Nav } from '@douyinfe/semi-ui';
import {
  IconHome,
  IconUser,
  IconGridView,
  IconExit,
  IconSetting,
  IconMenu,
  IconPriceTag,
  IconBookStroked,
  IconUpload,
} from '@douyinfe/semi-icons';
import type { User } from '@zenith/shared';
import { useTheme, type ThemeMode } from '../hooks/useTheme';
import NProgress from '../components/NProgress';
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

function getOpenSectionKeys(pathname: string) {
  if (pathname.startsWith('/system/file-configs') || pathname.startsWith('/system/files')) {
    return ['system', 'system-files'];
  }
  if (pathname.startsWith('/system/')) return ['system'];
  if (pathname.startsWith('/components')) return ['others'];
  return [];
}

export default function AdminLayout({ user, onLogout }: AdminLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const { mode, setThemeMode } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const currentSectionKeys = useMemo(() => getOpenSectionKeys(location.pathname), [location.pathname]);
  const [openKeys, setOpenKeys] = useState<string[]>(() => currentSectionKeys);

  useEffect(() => {
    if (!collapsed && currentSectionKeys.length > 0) {
      setOpenKeys((prev) => Array.from(new Set([...prev, ...currentSectionKeys])));
    }
  }, [collapsed, currentSectionKeys]);

  const navItems = useMemo(
    () => [
      {
        itemKey: '/',
        text: '首页',
        icon: <IconHome />,
      },
      {
        itemKey: 'system',
        text: '系统',
        icon: <IconSetting />,
        items: [
          { itemKey: '/system/users', text: '用户管理', icon: <IconUser /> },
          { itemKey: '/system/menus', text: '菜单管理', icon: <IconMenu /> },
          { itemKey: '/system/roles', text: '角色管理', icon: <IconBookStroked /> },
          { itemKey: '/system/dicts', text: '字典管理', icon: <IconPriceTag /> },
          {
            itemKey: 'system-files',
            text: '文件管理',
            icon: <IconUpload />,
            items: [
              { itemKey: '/system/file-configs', text: '文件配置', icon: <IconSetting /> },
              { itemKey: '/system/files', text: '文件列表', icon: <IconGridView /> },
            ],
          },
        ],
      },
      {
        itemKey: 'others',
        text: '其他',
        icon: <IconGridView />,
        items: [
          { itemKey: '/components', text: '组件示例', icon: <IconGridView /> },
        ],
      },
    ],
    []
  );

  return (
    <div className="admin-layout">
      {/* Sidebar */}
      <aside className={`admin-sidebar${collapsed ? ' admin-sidebar--collapsed' : ''}`}>
        <Nav
          className="admin-sidebar__nav"
          mode="vertical"
          items={navItems}
          style={{ height: '100%' }}
          bodyStyle={{ paddingTop: 8 }}
          isCollapsed={collapsed}
          selectedKeys={location.pathname === '/users' ? ['/system/users'] : [location.pathname]}
          openKeys={collapsed ? [] : openKeys}
          onOpenChange={({ openKeys: nextOpenKeys }) => setOpenKeys((nextOpenKeys ?? []).map(String))}
          onCollapseChange={setCollapsed}
          header={{
            logo: <div className="admin-sidebar__logo">Z</div>,
            text: <span className="admin-sidebar__title">Zenith Admin</span>,
          }}
          footer={{
            collapseButton: true,
            collapseText: (isCollapsed) => (isCollapsed ? '展开侧边栏' : '收起侧边栏'),
          }}
          renderWrapper={({ itemElement, props }) => {
            const itemKey = String(props.itemKey ?? '');
            if (!itemKey.startsWith('/')) return itemElement;
            return (
              <NavLink to={itemKey} className="admin-nav-link-wrapper">
                {itemElement}
              </NavLink>
            );
          }}
        />
      </aside>

      {/* Main area */}
      <div className="admin-main">
        <NProgress />
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
                  <Dropdown.Item icon={<IconUser />} onClick={() => navigate('/profile')}>个人中心</Dropdown.Item>
                  <Dropdown.Item icon={<IconSetting />}>设置</Dropdown.Item>
                  <Dropdown.Divider />
                  <Dropdown.Item
                    icon={<IconExit />}
                    onClick={() =>
                      Modal.confirm({
                        title: '确认退出',
                        content: '确定要退出登录吗？',
                        okText: '退出',
                        cancelText: '取消',
                        okButtonProps: { type: 'danger', theme: 'solid' },
                        onOk: onLogout,
                      })
                    }
                  >
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
