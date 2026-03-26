import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Badge, Dropdown, Empty, List, Notification, Popover, Tooltip, Modal, Nav, Typography, SideSheet, Switch, InputNumber, RadioGroup, Radio } from '@douyinfe/semi-ui';
import { Bell, Sun, Moon, Monitor, User as UserIcon, Settings, LogOut, X } from 'lucide-react';
import type { User, Menu, Notice, WsMessage } from '@zenith/shared';
import { useTheme, type ThemeMode } from '../hooks/useTheme';
import { usePreferences, type NavLayout } from '../hooks/usePreferences';
import { useTabsStore } from '../hooks/useTabsStore';
import { useWebSocket } from '../hooks/useWebSocket';
import { request } from '../utils/request';
import { formatDateTime } from '../utils/date';
import { config } from '../config';
import { renderLucideIcon } from '../utils/icons';
import NProgress from '../components/NProgress';
import './AdminLayout.css';

// 主题图标
function SunIcon() {
  return <Sun size={16} strokeWidth={1.5} />;
}

function MoonIcon() {
  return <Moon size={16} strokeWidth={1.5} />;
}

function MonitorIcon() {
  return <Monitor size={16} strokeWidth={1.5} />;
}

const themeLabelMap: Record<ThemeMode, { label: string; icon: React.ReactNode }> = {
  light: { label: '浅色', icon: <SunIcon /> },
  dark:  { label: '深色', icon: <MoonIcon /> },
  system: { label: '跟随系统', icon: <MonitorIcon /> },
};

function getMenuIcon(iconName?: string): React.ReactNode {
  const icon = renderLucideIcon(iconName ?? 'LayoutGrid') ?? renderLucideIcon('LayoutGrid');
  return <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{icon}</span>;
}

type NavItem = {
  itemKey: string;
  text: string;
  icon?: React.ReactNode;
  items?: NavItem[];
};

function menuToNavItem(menu: Menu): NavItem | null {
  if (!menu.visible || menu.type === 'button') return null;
  const icon = getMenuIcon(menu.icon);
  if (menu.type === 'directory') {
    const children = (menu.children ?? [])
      .map(menuToNavItem)
      .filter((item): item is NavItem => item !== null);
    return { itemKey: menu.name ?? `dir-${menu.id}`, text: menu.title, icon, items: children };
  }
  return { itemKey: menu.path ?? `menu-${menu.id}`, text: menu.title, icon };
}

function findAncestorKeys(menuTree: Menu[], targetPath: string): string[] {
  function traverse(nodes: Menu[], ancestors: string[]): string[] | null {
    for (const node of nodes) {
      if (!node.visible || node.type === 'button') continue;
      if (node.type === 'directory') {
        const key = node.name ?? `dir-${node.id}`;
        const found = traverse(node.children ?? [], [...ancestors, key]);
        if (found !== null) return found;
      } else if (node.path === targetPath) {
        return ancestors;
      }
    }
    return null;
  }
  return traverse(menuTree, []) ?? [];
}

interface AdminLayoutProps {
  readonly user: Omit<User, 'password'>;
  readonly onLogout: () => void;
  readonly presetMenus?: Menu[];
}

export default function AdminLayout({ user, onLogout, presetMenus }: AdminLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [menuTree, setMenuTree] = useState<Menu[]>(presetMenus || []);
  const { mode, setThemeMode } = useTheme();
  const { preferences, setPreferences } = usePreferences();

  // Sync colorMode preference with theme
  useEffect(() => {
    if (preferences.colorMode !== mode) {
      setThemeMode(preferences.colorMode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { tabs, activeKey, setActiveKey, addTab, removeTab, closeOthers, closeAll } = useTabsStore(preferences.tabsMaxCount);
  const [prefsVisible, setPrefsVisible] = useState(false);
  const [manualTopKey, setManualTopKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  // ─── 通知公告 ─────────────────────────────────────────────────────────────
  const [notices, setNotices] = useState<(Notice & { isRead?: boolean })[]>([]);
  const [noticePopVisible, setNoticePopVisible] = useState(false);
  const recentNoticeMessageRef = useRef(new Map<string, number>());

  const fetchNotices = () => {
    request.get<(Notice & { isRead?: boolean })[]>('/api/notices/published', { silent: true }).then((res) => {
      if (res.code === 0 && res.data) setNotices(res.data);
    });
  };

  useEffect(() => { fetchNotices(); }, []);

  const unreadCount = notices.filter((n) => !n.isRead).length;

  // ─── WebSocket ──────────────────────────────────────────────────────────────
  const handleWsMessage = useCallback((msg: WsMessage) => {
    if (msg.type === 'notice:new') {
      const messageKey = `${msg.payload.id}:${msg.payload.updatedAt}`;
      const now = Date.now();

      for (const [key, timestamp] of recentNoticeMessageRef.current) {
        if (now - timestamp > 60_000) {
          recentNoticeMessageRef.current.delete(key);
        }
      }

      if (recentNoticeMessageRef.current.has(messageKey)) {
        return;
      }

      recentNoticeMessageRef.current.set(messageKey, now);

      setNotices((prev) => {
        const next = prev.filter((notice) => notice.id !== msg.payload.id);
        return [{ ...msg.payload, isRead: false }, ...next];
      });

      Notification.info({
        title: '新通知',
        content: msg.payload.title,
        duration: 5,
        position: 'topRight',
      });
    } else if (msg.type === 'session:force-logout') {
      Notification.warning({
        title: '强制下线',
        content: msg.payload.reason,
        duration: 0,
        position: 'topRight',
      });
      // Auto-logout after a brief delay so the user can see the notification
      setTimeout(() => onLogout(), 2000);
    }
  }, [onLogout]);

  const { disconnect: disconnectWs } = useWebSocket(handleWsMessage);

  const markAsRead = (id: number) => {
    const updateReadState = () => setNotices(
      (prev) => prev.map((n) => n.id === id ? { ...n, isRead: true } : n),
    );
    request.post(`/api/notices/${id}/read`, undefined, { silent: true }).then((res) => {
      if (res.code === 0) updateReadState();
    });
  };

  useEffect(() => {
    if (presetMenus) {
      setMenuTree(presetMenus);
    } else {
      request.get<Menu[]>('/api/menus', { silent: true }).then((res) => {
        if (res.code === 0 && res.data) setMenuTree(res.data);
      });
    }
  }, [presetMenus]);

  const currentSectionKeys = useMemo(
    () => findAncestorKeys(menuTree, location.pathname),
    [menuTree, location.pathname]
  );
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!collapsed && currentSectionKeys.length > 0) {
      setOpenKeys((prev) => Array.from(new Set([...prev, ...currentSectionKeys])));
    }
  }, [collapsed, currentSectionKeys]);

  const navItems = useMemo(
    () => menuTree.map(menuToNavItem).filter((item): item is NavItem => item !== null),
    [menuTree]
  );

  const pathTitleMap = useMemo(() => {
    const map: Record<string, string> = {};
    function traverse(nodes: Menu[]) {
      for (const node of nodes) {
        if (node.path && node.title) map[node.path] = node.title;
        if (node.children) traverse(node.children);
      }
    }
    traverse(menuTree);
    return map;
  }, [menuTree]);

  const pathIconMap = useMemo(() => {
    const map: Record<string, string> = {};
    function traverse(nodes: Menu[]) {
      for (const node of nodes) {
        if (node.path && node.icon) map[node.path] = node.icon;
        if (node.children) traverse(node.children);
      }
    }
    traverse(menuTree);
    return map;
  }, [menuTree]);

  // ─── Nav layout helpers ────────────────────────────────────────────────────
  const navLayout: NavLayout = preferences.navLayout ?? 'vertical';

  const autoTopKey = useMemo(() => {
    if (navLayout !== 'mixed') return null;
    function contains(items: NavItem[], path: string): boolean {
      return items.some((item) =>
        item.itemKey === path || (item.items ? contains(item.items, path) : false),
      );
    }
    for (const item of navItems) {
      if (contains([item], location.pathname)) return item.itemKey;
    }
    return navItems[0]?.itemKey ?? null;
  }, [navLayout, navItems, location.pathname]);

  useEffect(() => {
    if (navLayout === 'mixed' && autoTopKey) setManualTopKey(autoTopKey);
  }, [navLayout, autoTopKey]);

  const effectiveTopKey = manualTopKey ?? autoTopKey;

  const mixedTopNavItems = useMemo(
    () => navItems.map(({ itemKey, text, icon }) => ({ itemKey, text, icon })),
    [navItems],
  );

  const mixedSidebarItems = useMemo(() => {
    if (navLayout !== 'mixed') return [];
    const top = navItems.find((i) => i.itemKey === effectiveTopKey);
    return top?.items ?? [];
  }, [navLayout, navItems, effectiveTopKey]);

  const showSidebar = navLayout === 'vertical' || (navLayout === 'mixed' && mixedSidebarItems.length > 0);

  useEffect(() => {
    const pageTitle = pathTitleMap[location.pathname];
    document.title = pageTitle ? `${pageTitle} - ${config.appTitle}` : config.appTitle;
  }, [location.pathname, pathTitleMap]);

  // Sync current route to tabs
  useEffect(() => {
    if (preferences.enableTabs) {
      const title = pathTitleMap[location.pathname] || location.pathname;
      addTab(location.pathname, title);
    }
  }, [location.pathname, preferences.enableTabs, pathTitleMap, addTab]);

  const handleTabChange = (key: string) => {
    setActiveKey(key);
    navigate(key);
  };

  const handleTabClose = (key: string) => {
    const currentActive = activeKey;
    removeTab(key);
    // If closing the active tab, navigate to the nearest remaining tab
    if (key === currentActive) {
      const idx = tabs.findIndex((t) => t.key === key);
      const remaining = tabs.filter((t) => t.key !== key);
      if (remaining.length > 0) {
        const nextTab = remaining[Math.min(idx, remaining.length - 1)];
        navigate(nextTab.key);
      } else {
        navigate('/');
      }
    }
  };

  // ─── Render wrappers ──────────────────────────────────────────────────────
  const renderWrapper = useCallback(
    ({ itemElement, props }: { itemElement: React.ReactNode; props: { itemKey?: string | number } }) => {
      const itemKey = String(props.itemKey ?? '');
      if (!itemKey.startsWith('/')) return itemElement;
      return (
        <NavLink to={itemKey} className="admin-nav-link-wrapper">
          {itemElement}
        </NavLink>
      );
    },
    [],
  );

  const mixedTopRenderWrapper = useCallback(
    ({ itemElement, props }: { itemElement: React.ReactNode; props: { itemKey?: string | number } }) => {
      const key = String(props.itemKey ?? '');
      const topItem = navItems.find((i) => i.itemKey === key);
      if (topItem?.items?.length) return <>{itemElement}</>;
      if (key.startsWith('/')) {
        return <NavLink to={key} className="admin-nav-link-wrapper">{itemElement}</NavLink>;
      }
      return itemElement;
    },
    [navItems],
  );

  const handleMixedTopSelect = useCallback(
    ({ itemKey: key }: { itemKey: string | number }) => {
      const k = String(key);
      setManualTopKey(k);
      const topItem = navItems.find((i) => i.itemKey === k);
      if (topItem?.items?.length) {
        function findFirstLeaf(items: NavItem[]): string | null {
          for (const item of items) {
            if (item.items?.length) {
              const leaf = findFirstLeaf(item.items);
              if (leaf) return leaf;
            } else if (item.itemKey.startsWith('/')) {
              return item.itemKey;
            }
          }
          return null;
        }
        const leaf = findFirstLeaf(topItem.items);
        if (leaf) navigate(leaf);
      }
    },
    [navItems, navigate],
  );

  const currentSelectedKeys = location.pathname === '/users' ? ['/system/users'] : [location.pathname];

  // ─── Header actions (reused in both topbar and vertical header) ────────────
  const headerActions = (
    <div className="admin-header__actions">
      <Popover
        visible={noticePopVisible}
        onVisibleChange={setNoticePopVisible}
        position="bottomRight"
        trigger="click"
        showArrow
        content={
          <div style={{ width: 360, maxHeight: 440, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '12px 16px 8px', fontWeight: 600, fontSize: 14, borderBottom: '1px solid var(--semi-color-border)' }}>
              通知公告
            </div>
            {notices.length === 0 ? (
              <Empty description="暂无通知" style={{ padding: '24px 0' }} />
            ) : (
              <List
                style={{ overflow: 'auto', maxHeight: 340 }}
                dataSource={notices}
                renderItem={(item: Notice & { isRead?: boolean }) => (
                  <List.Item
                    key={item.id}
                    style={{ padding: '10px 16px', cursor: item.isRead ? 'default' : 'pointer', opacity: item.isRead ? 0.55 : 1 }}
                    onClick={() => { if (!item.isRead) markAsRead(item.id); }}
                    header={null}
                    main={
                      <div>
                        <Typography.Text strong style={{ fontSize: 13 }}>{item.title}</Typography.Text>
                        <div
                          style={{ fontSize: 12, color: 'var(--semi-color-text-2)', margin: '3px 0 4px', maxHeight: 40, overflow: 'hidden', lineHeight: 1.5 }}
                          dangerouslySetInnerHTML={{ __html: item.content }}
                        />
                        <Typography.Text style={{ fontSize: 11, color: 'var(--semi-color-text-3)' }}>
                          {item.publishTime ? formatDateTime(item.publishTime) : formatDateTime(item.createdAt)}
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
              <Typography.Text
                link
                size="small"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setNoticePopVisible(false);
                  navigate('/notifications');
                }}
              >
                查看全部通知
              </Typography.Text>
            </div>
          </div>
        }
      >
        <div style={{ display: 'inline-flex', cursor: 'pointer' }}>
          <Badge dot={unreadCount > 0} className="admin-notify-badge" style={{ zIndex: 1 }}>
            <button className="admin-theme-btn" title="通知公告">
              <Bell size={16} strokeWidth={1.5} />
            </button>
          </Badge>
        </div>
      </Popover>
      <Tooltip content={<span>颜色模式：{themeLabelMap[mode].label}</span>} position="bottom">
        <Dropdown
          position="bottomRight"
          render={
            <Dropdown.Menu>
              {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
                <Dropdown.Item key={m} icon={themeLabelMap[m].icon} active={mode === m} onClick={() => setThemeMode(m)}>
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
      <div style={{ width: 1, height: 16, backgroundColor: 'var(--color-border)', margin: '0 4px' }} />
      <Dropdown
        position="bottomRight"
        render={
          <Dropdown.Menu>
            <Dropdown.Item icon={<UserIcon size={14} strokeWidth={1.5} />} onClick={() => navigate('/profile')}>个人中心</Dropdown.Item>
            <Dropdown.Item icon={<Settings size={14} strokeWidth={1.5} />} onClick={() => setPrefsVisible(true)}>偏好设置</Dropdown.Item>
            <Dropdown.Divider />
            <Dropdown.Item
              icon={<LogOut size={14} strokeWidth={1.5} />}
              onClick={() => Modal.confirm({
                title: '确认退出',
                content: '确定要退出登录吗？',
                okText: '退出',
                cancelText: '取消',
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: () => { disconnectWs(); onLogout(); },
              })}
            >
              退出登录
            </Dropdown.Item>
          </Dropdown.Menu>
        }
      >
        <div className="admin-header__user">
          <Avatar size="small" color="blue" style={{ fontSize: 12, flexShrink: 0 }} src={user.avatar || undefined}>
            {!user.avatar && (user.nickname?.charAt(0)?.toUpperCase() || 'U')}
          </Avatar>
          <span className="admin-header__username">{user.nickname}</span>
        </div>
      </Dropdown>
    </div>
  );

  return (
    <div className="admin-layout">
      {/* Top bar for horizontal and mixed layouts */}
      {navLayout !== 'vertical' && (
        <header className="admin-topbar">
          <div className="admin-topbar__brand" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>
            <div className="admin-sidebar__logo">Z</div>
            <span className="admin-sidebar__title">Zenith Admin</span>
          </div>
          <Nav
            className="admin-topbar__nav"
            mode="horizontal"
            items={navLayout === 'mixed' ? mixedTopNavItems : navItems}
            selectedKeys={navLayout === 'mixed' ? (effectiveTopKey ? [effectiveTopKey] : []) : currentSelectedKeys}
            onSelect={navLayout === 'mixed' ? handleMixedTopSelect : undefined}
            renderWrapper={navLayout === 'mixed' ? mixedTopRenderWrapper : renderWrapper}
            style={{ height: '100%', background: 'transparent' }}
          />
          {headerActions}
        </header>
      )}

      <div className="admin-body">
        {/* Sidebar — always in vertical, conditional in mixed */}
        {showSidebar && (
          <aside className={`admin-sidebar${collapsed ? ' admin-sidebar--collapsed' : ''}`}>
            <Nav
              className="admin-sidebar__nav"
              mode="vertical"
              items={navLayout === 'mixed' ? mixedSidebarItems : navItems}
              style={{ height: '100%' }}
              bodyStyle={{ paddingTop: 8 }}
              isCollapsed={collapsed}
              selectedKeys={currentSelectedKeys}
              openKeys={collapsed ? [] : openKeys}
              onOpenChange={({ openKeys: nextOpenKeys }) => setOpenKeys((nextOpenKeys ?? []).map(String))}
              onCollapseChange={setCollapsed}
              header={navLayout === 'vertical' ? {
                logo: <div className="admin-sidebar__logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>Z</div>,
                text: <span className="admin-sidebar__title" style={{ cursor: 'pointer' }} onClick={() => navigate('/')}>Zenith Admin</span>,
              } : undefined}
              footer={{
                collapseButton: true,
                collapseText: (isCollapsed) => (isCollapsed ? '展开侧边栏' : '收起侧边栏'),
              }}
              renderWrapper={renderWrapper}
            />
          </aside>
        )}


        {/* Main area */}
        <div className="admin-main">
          <NProgress />
          {/* Vertical mode has its own header bar */}
          {navLayout === 'vertical' && (
            <header className="admin-header">
              <div />
              {headerActions}
            </header>
          )}
          <div className="admin-content" style={{ background: 'var(--color-layout-bg)', overflow: 'auto', position: 'relative' }}>
            {/* Tabs bar */}
            {preferences.enableTabs && tabs.length > 0 && (
              <div className="admin-tabs-bar">
                {tabs.map((tab) => (
                  <div
                    key={tab.key}
                    role="tab"
                    tabIndex={0}
                    className={`admin-tab-item${tab.key === activeKey ? ' admin-tab-item--active' : ''}`}
                    onClick={() => handleTabChange(tab.key)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleTabChange(tab.key); }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const menu = document.createElement('div');
                      menu.className = 'admin-tab-ctx';
                      menu.innerHTML = `<div class="admin-tab-ctx-item" data-action="close-others">关闭其他</div><div class="admin-tab-ctx-item" data-action="close-all">关闭全部</div>`;
                      menu.style.left = `${e.clientX}px`;
                      menu.style.top = `${e.clientY}px`;
                      document.body.appendChild(menu);
                      const handler = (ev: MouseEvent) => {
                        const target = ev.target as HTMLElement;
                        if (target.dataset.action === 'close-others') closeOthers(tab.key);
                        if (target.dataset.action === 'close-all') { closeAll(); navigate('/'); }
                        menu.remove();
                        document.removeEventListener('click', handler);
                      };
                      document.addEventListener('click', handler);
                    }}
                  >
                    {preferences.showTabIcon && pathIconMap[tab.key] && (
                      <span className="admin-tab-item__icon">{renderLucideIcon(pathIconMap[tab.key], 14)}</span>
                    )}
                    <span className="admin-tab-item__text">{tab.title}</span>
                    {tab.closable && (
                      <button
                        type="button"
                        className="admin-tab-item__close"
                        onClick={(e) => { e.stopPropagation(); handleTabClose(tab.key); }}
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <Outlet />
          </div>

          {/* Preferences SideSheet */}
          <SideSheet
            title="偏好设置"
            visible={prefsVisible}
            onCancel={() => setPrefsVisible(false)}
            width={380}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {/* Nav layout picker */}
              <div>
                <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 500, color: 'var(--semi-color-text-0)' }}>导航布局</div>
                <div style={{ display: 'flex', gap: 12 }}>
                  {([
                    { value: 'vertical' as NavLayout, label: '左侧菜单' },
                    { value: 'horizontal' as NavLayout, label: '顶部菜单' },
                    { value: 'mixed' as NavLayout, label: '混合菜单' },
                  ]).map(({ value, label }) => (
                    <button
                      type="button"
                      key={value}
                      className={`layout-picker__option${navLayout === value ? ' layout-picker__option--active' : ''}`}
                      onClick={() => setPreferences({ navLayout: value })}
                    >
                      <div className={`layout-picker__preview layout-picker__preview--${value}`} />
                      <span className="layout-picker__label">{label}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* Color mode */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>颜色模式</span>
                <RadioGroup
                  type="button"
                  value={mode}
                  onChange={(e) => {
                    const v = e.target.value as ThemeMode;
                    setThemeMode(v);
                    setPreferences({ colorMode: v });
                  }}
                >
                  <Radio value="light">浅色</Radio>
                  <Radio value="dark">深色</Radio>
                  <Radio value="system">系统</Radio>
                </RadioGroup>
              </div>
              {/* Tabs settings */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>启用多标签页</span>
                <Switch checked={preferences.enableTabs} onChange={(v) => setPreferences({ enableTabs: v })} />
              </div>
              {preferences.enableTabs && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>标签页显示图标</span>
                    <Switch checked={preferences.showTabIcon} onChange={(v) => setPreferences({ showTabIcon: v })} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>最大标签数</span>
                    <InputNumber
                      min={5}
                      max={50}
                      value={preferences.tabsMaxCount}
                      onChange={(v) => setPreferences({ tabsMaxCount: v as number })}
                      style={{ width: 100 }}
                    />
                  </div>
                </>
              )}
            </div>
          </SideSheet>
        </div>
      </div>
    </div>
  );
}
