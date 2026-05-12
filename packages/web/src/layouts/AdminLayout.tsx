import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Badge, Breadcrumb, Button, Dropdown, Empty, List, Notification, Popover, Select, Tooltip, Modal, Nav, Typography, SideSheet, Switch, InputNumber, RadioGroup, Radio, Toast } from '@douyinfe/semi-ui';
import { Bell, Building2, Check, Maximize2, Minimize2, Sun, Moon, Monitor, User as UserIcon, Settings, LogOut, X, Palette } from 'lucide-react';
import MenuSearchInput, { type FlatMenuItem } from '@/components/MenuSearchInput';
import type { User, Menu, Notice, Tenant, WsMessage, SystemConfig } from '@zenith/shared';
import type { ThemeMode } from '@/hooks/useTheme';
import { usePreferences, type NavLayout } from '@/hooks/usePreferences';
import { THEME_COLOR_PRESETS } from '@/lib/theme-color';
import { useThemeController } from '@/providers/ThemeProvider';
import { useTabsStore } from '@/hooks/useTabsStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { config } from '@/config';
import { renderLucideIcon } from '@/utils/icons';
import NProgress from '@/components/NProgress';
import Watermark from '@/components/Watermark';
import QuickChatButton from '@/components/QuickChatButton';
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
  badge?: { count: number; overflowCount?: number };
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

function findBreadcrumbs(menuTree: Menu[], targetPath: string): { title: string; path?: string }[] {
  function traverse(nodes: Menu[], ancestors: { title: string; path?: string }[]): { title: string; path?: string }[] | null {
    for (const node of nodes) {
      if (!node.visible || node.type === 'button') continue;
      if (node.type === 'directory') {
        const found = traverse(node.children ?? [], [...ancestors, { title: node.title }]);
        if (found !== null) return found;
      } else if (node.path === targetPath) {
        return [...ancestors, { title: node.title, path: node.path ?? undefined }];
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

function stripHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return (tmp.textContent ?? tmp.innerText ?? '').replaceAll(/\s+/g, ' ').trim();
}

export default function AdminLayout({ user, onLogout, presetMenus }: AdminLayoutProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [menuTree, setMenuTree] = useState<Menu[]>(presetMenus || []);

  const flatMenus = useMemo<FlatMenuItem[]>(() => {
    const result: FlatMenuItem[] = [];
    const walk = (nodes: Menu[], parents: string[]) => {
      for (const node of nodes) {
        if (node.type === 'menu' && node.path && node.status === 'enabled' && node.visible) {
          result.push({ id: node.id, title: node.title, path: node.path, icon: node.icon, breadcrumb: parents });
        }
        if (node.children?.length) walk(node.children, node.type === 'directory' ? [...parents, node.title] : parents);
      }
    };
    walk(menuTree, []);
    return result;
  }, [menuTree]);
  const { preferences, setPreferences, resetPreferences } = usePreferences();
  const { mode, themeColor, setThemeMode, setThemeColor, resetTheme } = useThemeController();
  const colorPickerRef = useRef<HTMLInputElement>(null);

  const handleThemeModeChange = useCallback((newMode: ThemeMode) => {
    setThemeMode(newMode);
  }, [setThemeMode]);

  // ─── 水印配置 ──────────────────────────────────────────────────────────────
  const [watermarkConfig, setWatermarkConfig] = useState({ enabled: false, content: '', fontSize: 14, opacity: 0.15 });

  useEffect(() => {
    request.get<{ list: SystemConfig[]; total: number }>('/api/system-configs?keyword=watermark_&pageSize=10', { silent: true })
      .then((res) => {
        if (res.code === 0 && res.data?.list) {
          const list = res.data.list;
          const enabled = list.find((c) => c.configKey === 'watermark_enabled')?.configValue === 'true';
          const content = list.find((c) => c.configKey === 'watermark_content')?.configValue ?? '';
          const fontSize = Number(list.find((c) => c.configKey === 'watermark_font_size')?.configValue) || 14;
          const opacity = (Number(list.find((c) => c.configKey === 'watermark_opacity')?.configValue) || 15) / 100;
          setWatermarkConfig({ enabled, content, fontSize, opacity });
        }
      });
  }, []);

  // Fullscreen
  const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement);
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  // 每次 App 会话只弹一次：见过一次后不再重复
  const evictToastShownRef = useRef(false);
  const { tabs, activeKey, setActiveKey, addTab, removeTab, closeOthers, closeLeft, closeRight, closeAll, reorderTabs } = useTabsStore(
    preferences.tabsMaxCount,
    (evicted) => {
      if (evictToastShownRef.current) return;
      evictToastShownRef.current = true;
      const names = evicted.map((t) => `「${t.title}」`).join('、');
      Toast.warning({
        content: `已达到最大标签数 (${preferences.tabsMaxCount})，自动关闭了 ${names}`,
        duration: 3,
      });
    },
  );
  const [prefsVisible, setPrefsVisible] = useState(false);
  const dragSrcKey = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [exitingTabKeys, setExitingTabKeys] = useState<Set<string>>(new Set());
  const [enteringTabKeys, setEnteringTabKeys] = useState<Set<string>>(new Set());
  const prevTabsLengthRef = useRef(0);
  const [manualTopKey, setManualTopKey] = useState<string | null>(null);
  const [tabRefreshVersion, setTabRefreshVersion] = useState<Record<string, number>>({});
  const tabContextMenuRef = useRef<HTMLDivElement | null>(null);
  const tabContextMenuCleanupRef = useRef<(() => void) | null>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const closeTabContextMenu = useCallback(() => {
    tabContextMenuCleanupRef.current?.();
    tabContextMenuCleanupRef.current = null;
    tabContextMenuRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      closeTabContextMenu();
    };
  }, [closeTabContextMenu]);

  // ─── Tabs 拖拽排序 ──────────────────────────────────────────────────────────
  const handleDragStart = useCallback((key: string) => {
    dragSrcKey.current = key;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragSrcKey.current !== key) setDragOverKey(key);
  }, []);

  const handleDrop = useCallback((key: string) => {
    if (dragSrcKey.current && dragSrcKey.current !== key) {
      reorderTabs(dragSrcKey.current, key);
    }
    dragSrcKey.current = null;
    setDragOverKey(null);
  }, [reorderTabs]);

  const handleDragEnd = useCallback(() => {
    dragSrcKey.current = null;
    setDragOverKey(null);
  }, []);

  // ─── Tabs 滚动 ─────────────────────────────────────────────────────────────
  const activeTabRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 延迟以确保 DOM 已完成渲染
    const timer = setTimeout(() => {
      if (activeTabRef.current) {
        activeTabRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [activeKey, tabs.length]);

  // ─── 租户切换（仅平台管理员） ─────────────────────────────────────────────
  const isPlatformAdmin = config.multiTenantMode && !user.tenantId && user.roles?.some((r) => r.code === 'super_admin');
  const [tenantList, setTenantList] = useState<Tenant[]>([]);
  const [viewingTenantId, setViewingTenantId] = useState<number | null>(null);

  useEffect(() => {
    if (isPlatformAdmin) {
      request.get<Tenant[]>('/api/tenants/all', { silent: true }).then((res) => {
        if (res.code === 0 && res.data) setTenantList(res.data.filter((t) => t.status === 'enabled'));
      });
    }
  }, [isPlatformAdmin]);

  const handleSwitchTenant = async (tenantId: number | null) => {
    const res = await request.post<{ accessToken: string; refreshToken: string }>('/api/auth/switch-tenant', { tenantId });
    if (res.code === 0 && res.data) {
      localStorage.setItem('zenith_token', res.data.accessToken);
      localStorage.setItem('zenith_refresh_token', res.data.refreshToken);
      setViewingTenantId(tenantId);
      globalThis.location.reload();
    }
  };

  // ─── 通知公告 ─────────────────────────────────────────────────────────────
  const [notices, setNotices] = useState<(Notice & { isRead?: boolean })[]>([]);
  const [noticePopVisible, setNoticePopVisible] = useState(false);
  const [selectedNotice, setSelectedNotice] = useState<(Notice & { isRead?: boolean }) | null>(null);
  const recentNoticeMessageRef = useRef(new Map<string, number>());

  const fetchNotices = () => {
    request.get<(Notice & { isRead?: boolean })[]>('/api/notices/published', { silent: true }).then((res) => {
      if (res.code === 0 && res.data) setNotices(res.data);
    });
  };

  useEffect(() => { fetchNotices(); }, []);

  const unreadCount = notices.filter((n) => !n.isRead).length;

  // ─── 聊天未读数 ────────────────────────────────────────────────────────────
  const [chatUnreadCount, setChatUnreadCount] = useState(0);
  // 初次加载时拉取会话列表计算未读
  useEffect(() => {
    request.get<Array<{ unreadCount: number }>>('/api/chat/conversations', { silent: true }).then((res) => {
      if (res.code === 0 && res.data) {
        setChatUnreadCount(res.data.reduce((s, c) => s + (c.unreadCount ?? 0), 0));
      }
    });
  }, []);

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
    } else if (msg.type === 'chat:message') {
      // 只在当前不在 /chat 页面时增加未读
      if (!globalThis.location.pathname.startsWith('/chat')) {
        setChatUnreadCount((v) => v + 1);
      }
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

  const breadcrumbs = useMemo(
    () => findBreadcrumbs(menuTree, location.pathname),
    [menuTree, location.pathname]
  );
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!collapsed && currentSectionKeys.length > 0) {
      setOpenKeys((prev) => Array.from(new Set([...prev, ...currentSectionKeys])));
    }
  }, [collapsed, currentSectionKeys]);

  const navItems = useMemo(
    () => menuTree.map(menuToNavItem).filter((item): item is NavItem => item !== null).map((item) => {
      if (item.itemKey === '/chat' && chatUnreadCount > 0) {
        return { ...item, badge: { count: chatUnreadCount, overflowCount: 99 } };
      }
      return item;
    }),
    [menuTree, chatUnreadCount]
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

  const resolveTitle = useCallback((pathname: string) => {
    if (pathTitleMap[pathname]) return pathTitleMap[pathname];
    // 前缀匹配：用于带动态参数的隐藏菜单（如 /workflow/designer → /workflow/designer/1）
    const prefixMatch = Object.entries(pathTitleMap).find(([p]) => pathname.startsWith(p + '/'));
    return prefixMatch ? prefixMatch[1] : pathname;
  }, [pathTitleMap]);

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

  // 进入消息中心页面时重置聊天未读数
  useEffect(() => {
    if (location.pathname.startsWith('/chat')) {
      setChatUnreadCount(0);
    }
  }, [location.pathname]);

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
    const pageTitle = resolveTitle(location.pathname);
    document.title = pageTitle !== location.pathname ? `${pageTitle} - ${config.appTitle}` : config.appTitle;
  }, [location.pathname, resolveTitle]);

  // Sync current route to tabs
  useEffect(() => {
    if (preferences.enableTabs) {
      const title = resolveTitle(location.pathname);
      addTab(location.pathname, title);
    }
  }, [location.pathname, preferences.enableTabs, resolveTitle, addTab]);

  // Track entering tabs (new tab added since last render)
  useEffect(() => {
    const prev = prevTabsLengthRef.current;
    if (tabs.length > prev && preferences.tabAnimation !== 'none') {
      const newTab = tabs.at(-1);
      if (newTab) {
        setEnteringTabKeys((s) => new Set([...s, newTab.key]));
        setTimeout(() => {
          setEnteringTabKeys((s) => { const n = new Set(s); n.delete(newTab.key); return n; });
        }, 420);
      }
    }
    prevTabsLengthRef.current = tabs.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs.length]);

  const doRemoveTab = (key: string) => {
    const currentActive = activeKey;
    removeTab(key);
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

  const handleTabChange = (key: string) => {
    setActiveKey(key);
    navigate(key);
  };

  const handleTabClose = (key: string) => {
    if (preferences.tabAnimation === 'none') {
      doRemoveTab(key);
      return;
    }
    setExitingTabKeys((s) => new Set([...s, key]));
    setTimeout(() => {
      setExitingTabKeys((s) => { const n = new Set(s); n.delete(key); return n; });
      doRemoveTab(key);
    }, 280);
  };

  const handleTabRefresh = (key: string) => {
    if (location.pathname !== key) {
      navigate(key);
    }
    setTabRefreshVersion((prev) => ({
      ...prev,
      [key]: (prev[key] ?? 0) + 1,
    }));
  };

  const outletRefreshKey = `${location.pathname}:${tabRefreshVersion[location.pathname] ?? 0}`;

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
      {(preferences.showMenuSearch ?? true) && <MenuSearchInput menus={flatMenus} />}
      {isPlatformAdmin && tenantList.length > 0 && (
        <>
          <Select
            prefix={<Building2 size={14} />}
            placeholder="平台视角"
            value={viewingTenantId ?? undefined}
            onChange={(v) => handleSwitchTenant((v as number) ?? null)}
            style={{ width: 180 }}
            showClear
            onClear={() => handleSwitchTenant(null)}
            optionList={tenantList.map((t) => ({ value: t.id, label: t.name }))}
            size="small"
          />
          <div style={{ width: 1, height: 16, backgroundColor: 'var(--color-border)', margin: '0 4px' }} />
        </>
      )}
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
                    style={{ padding: '10px 16px', cursor: 'pointer', opacity: item.isRead ? 0.55 : 1 }}
                    onClick={() => {
                      if (!item.isRead) markAsRead(item.id);
                      setNoticePopVisible(false);
                      setSelectedNotice(item);
                    }}
                    header={null}
                    main={
                      <div>
                        <Typography.Text strong style={{ fontSize: 13 }}>{item.title}</Typography.Text>
                        <div
                          style={{ fontSize: 12, color: 'var(--semi-color-text-2)', margin: '3px 0 4px', maxHeight: 40, overflow: 'hidden', lineHeight: 1.5 }}
                        >
                          {stripHtml(item.content)}
                        </div>
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
                <Dropdown.Item key={m} icon={themeLabelMap[m].icon} active={mode === m} onClick={() => handleThemeModeChange(m)}>
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
      {(preferences.showFullscreen ?? true) && (
        <Tooltip content={isFullscreen ? '退出全屏' : '全屏显示'} position="bottom">
          <button className="admin-theme-btn" title={isFullscreen ? '退出全屏' : '全屏显示'} onClick={toggleFullscreen}>
            {isFullscreen ? <Minimize2 size={16} strokeWidth={1.5} /> : <Maximize2 size={16} strokeWidth={1.5} />}
          </button>
        </Tooltip>
      )}
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

  const adminLayoutEl = (
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
          {/* Tabs bar — shown above breadcrumb for all layouts */}
          {preferences.enableTabs && tabs.length > 0 && (
            <div className={`admin-tabs-bar${preferences.showBreadcrumb ? ' admin-tabs-bar--with-breadcrumb' : ''}`} data-tab-animation={preferences.tabAnimation}>
              {tabs.map((tab) => {
                  const isEntering = enteringTabKeys.has(tab.key);
                  const isExiting = exitingTabKeys.has(tab.key);
                  const tabClass = [
                    'admin-tab-item',
                    tab.key === activeKey ? 'admin-tab-item--active' : '',
                    isEntering ? 'admin-tab-item--entering' : '',
                    isExiting ? 'admin-tab-item--exiting' : '',
                    dragSrcKey.current === tab.key ? 'admin-tab-item--dragging' : '',
                    dragOverKey === tab.key ? 'admin-tab-item--drag-over' : '',
                  ].filter(Boolean).join(' ');
                  return (
                  <div
                    key={tab.key}
                    ref={tab.key === activeKey ? activeTabRef : null}
                    role="tab"
                    tabIndex={0}
                    className={tabClass}
                    draggable
                    onDragStart={() => handleDragStart(tab.key)}
                    onDragOver={(e) => handleDragOver(e, tab.key)}
                    onDrop={() => handleDrop(tab.key)}
                    onDragEnd={handleDragEnd}
                    onDragLeave={() => setDragOverKey(null)}
                    onClick={() => handleTabChange(tab.key)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleTabChange(tab.key); }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      closeTabContextMenu();

                      const menu = document.createElement('div');
                      menu.className = 'admin-tab-ctx';

                      const tabIndex = tabs.findIndex((t) => t.key === tab.key);
                      const hasClosableLeft = tabIndex > 0 && tabs.slice(0, tabIndex).some((t) => t.closable);
                      const hasClosableRight = tabIndex >= 0 && tabs.slice(tabIndex + 1).some((t) => t.closable);
                      const hasClosableOthers = tabs.some((t) => t.closable && t.key !== tab.key);
                      const hasAnyClosable = tabs.some((t) => t.closable);

                      const buildItem = (action: string, label: string, disabled = false) => (
                        `<div class="admin-tab-ctx-item${disabled ? ' admin-tab-ctx-item--disabled' : ''}" data-action="${action}" data-disabled="${disabled ? 'true' : 'false'}">${label}</div>`
                      );

                      let menuHtml = '';
                      menuHtml += buildItem('refresh', '刷新页面');
                      menuHtml += `<div class="admin-tab-ctx-divider"></div>`;
                      menuHtml += buildItem('close', '关闭当前', !tab.closable);
                      menuHtml += buildItem('close-others', '关闭其他', !hasClosableOthers);
                      menuHtml += buildItem('close-left', '关闭左侧', !hasClosableLeft);
                      menuHtml += buildItem('close-right', '关闭右侧', !hasClosableRight);
                      menuHtml += buildItem('close-all', '关闭全部', !hasAnyClosable);

                      menu.innerHTML = menuHtml;
                      menu.style.left = `${e.clientX}px`;
                      menu.style.top = `${e.clientY}px`;
                      document.body.appendChild(menu);
                      tabContextMenuRef.current = menu;
                      let clickHandler: ((ev: MouseEvent) => void) | null = null;

                      const closeMenu = () => {
                        if (tabContextMenuRef.current === menu) {
                          tabContextMenuRef.current = null;
                        }
                        menu.remove();
                        if (clickHandler) {
                          document.removeEventListener('click', clickHandler);
                        }
                        document.removeEventListener('mousedown', handleMouseDown);
                        document.removeEventListener('keydown', handleKeyDown);
                        tabContextMenuCleanupRef.current = null;
                      };

                      const handleMouseDown = (ev: MouseEvent) => {
                        const target = ev.target as Node | null;
                        if (!target || !menu.contains(target)) {
                          closeMenu();
                        }
                      };

                      const handleKeyDown = (ev: KeyboardEvent) => {
                        if (ev.key === 'Escape') {
                          closeMenu();
                        }
                      };

                      tabContextMenuCleanupRef.current = closeMenu;
                      document.addEventListener('mousedown', handleMouseDown);
                      document.addEventListener('keydown', handleKeyDown);

                      clickHandler = (ev: MouseEvent) => {
                        const target = ev.target as HTMLElement;
                        const item = target.closest('.admin-tab-ctx-item') as HTMLElement | null;
                        const action = item?.dataset.action;
                        const disabled = item?.dataset.disabled === 'true';
                        if (disabled) {
                          return;
                        }
                        if (action === 'refresh') {
                          handleTabRefresh(tab.key);
                        } else if (action === 'close') {
                          handleTabClose(tab.key);
                        } else if (action === 'close-others') {
                          const nextKey = closeOthers(tab.key);
                          navigate(nextKey);
                        } else if (action === 'close-left') {
                          const nextKey = closeLeft(tab.key);
                          navigate(nextKey);
                        } else if (action === 'close-right') {
                          const nextKey = closeRight(tab.key);
                          navigate(nextKey);
                        } else if (action === 'close-all') {
                          closeAll();
                          navigate('/');
                        }
                        closeMenu();
                      };
                      document.addEventListener('click', clickHandler);
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
                  );
              })}
            </div>
          )}
          {/* Breadcrumb bar — below tabs for all layouts */}
          {preferences.showBreadcrumb && breadcrumbs.length > 0 && (
            <div className="admin-breadcrumb-bar">
              <Breadcrumb>
                {breadcrumbs.map((crumb, index) => (
                  <Breadcrumb.Item key={crumb.title}>
                    {index === 0 && crumb.path === '/' ? (
                      <span onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>首页</span>
                    ) : (
                      crumb.title
                    )}
                  </Breadcrumb.Item>
                ))}
              </Breadcrumb>
            </div>
          )}
          <div className="admin-content" style={{ background: 'var(--color-layout-bg)', overflow: 'auto', position: 'relative' }}>
            <Outlet key={outletRefreshKey} />
          </div>

          {/* Preferences SideSheet */}
          <SideSheet
            title="偏好设置"
            visible={prefsVisible}
            onCancel={() => setPrefsVisible(false)}
            width={380}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* ── 导航布局 ── */}
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

              {/* ── 颜色模式 ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>颜色模式</span>
                <RadioGroup
                  type="button"
                  value={mode}
                  onChange={(e) => {
                    const v = e.target.value as ThemeMode;
                    handleThemeModeChange(v);
                  }}
                >
                  <Radio value="light">浅色</Radio>
                  <Radio value="dark">深色</Radio>
                  <Radio value="system">系统</Radio>
                </RadioGroup>
              </div>

              {/* ── 主题色 ── */}
              <div>
                <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 500, color: 'var(--semi-color-text-0)' }}>主题颜色</div>
                <div className="theme-color-picker">
                  {THEME_COLOR_PRESETS.map((preset) => {
                    const isDark = mode === 'dark' || (mode === 'system' && globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
                    const currentColor = isDark ? preset.dark.primary : preset.light.primary;
                    const isActive = themeColor === preset.key;
                    return (
                      <Tooltip key={preset.key} content={preset.name} position="top">
                        <button
                          type="button"
                          className={`theme-color-swatch${isActive ? ' theme-color-swatch--active' : ''}`}
                          style={{ backgroundColor: currentColor, color: currentColor }}
                          onClick={() => setThemeColor(preset.key)}
                          title={preset.name}
                        >
                          {isActive && (
                            <span className="theme-color-swatch__check">
                              <Check size={14} strokeWidth={2.5} />
                            </span>
                          )}
                        </button>
                      </Tooltip>
                    );
                  })}
                  {/* 自定义颜色 */}
                  <Tooltip content="自定义颜色" position="top">
                    <button
                      type="button"
                      className={`theme-color-swatch theme-color-swatch--custom${themeColor.startsWith('#') ? ' theme-color-swatch--active' : ''}`}
                      style={themeColor.startsWith('#') ? { backgroundColor: themeColor, color: themeColor } : {}}
                      onClick={() => colorPickerRef.current?.click()}
                      title="自定义颜色"
                    >
                      {themeColor.startsWith('#')
                        ? <span className="theme-color-swatch__check"><Check size={14} strokeWidth={2.5} /></span>
                        : <span className="theme-color-swatch__icon"><Palette size={14} /></span>
                      }
                    </button>
                  </Tooltip>
                  <input
                    ref={colorPickerRef}
                    type="color"
                    style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }}
                    value={themeColor.startsWith('#') ? themeColor : '#3370ff'}
                    onChange={(e) => setThemeColor(e.target.value)}
                  />
                </div>
              </div>

              {/* ── 面包屑 ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>显示面包屑导航</span>
                <Switch checked={preferences.showBreadcrumb} onChange={(v) => setPreferences({ showBreadcrumb: v })} />
              </div>

              {/* ── 菜单搜索 ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>显示菜单搜索框</span>
                <Switch checked={preferences.showMenuSearch ?? true} onChange={(v) => setPreferences({ showMenuSearch: v })} />
              </div>

              {/* ── 全屏按钮 ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>显示全屏按钮</span>
                <Switch checked={preferences.showFullscreen ?? true} onChange={(v) => setPreferences({ showFullscreen: v })} />
              </div>

              {/* ── 快捷聊天 ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>显示快捷聊天按钮</span>
                <Switch checked={preferences.showQuickChat ?? true} onChange={(v) => setPreferences({ showQuickChat: v })} />
              </div>

              <div className="prefs-section-divider" />

              {/* ── 多标签页 ── */}
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

                  {/* ── 标签页动画 ── */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>标签页动画</span>
                    <div className="tab-anim-picker">
                      {(['none', 'fade', 'slide', 'scale'] as const).map((anim) => {
                        const labels: Record<string, string> = { none: '无', fade: '淡入', slide: '滑入', scale: '缩放' };
                        const btn = (
                          <button
                            type="button"
                            className={`tab-anim-picker__btn${preferences.tabAnimation === anim ? ' tab-anim-picker__btn--active' : ''}`}
                            onClick={() => setPreferences({ tabAnimation: anim })}
                          >
                            {labels[anim]}
                          </button>
                        );
                        if (anim === 'none') return <span key={anim}>{btn}</span>;
                        return (
                          <Popover
                            key={anim}
                            trigger="hover"
                            position="bottom"
                            mouseEnterDelay={100}
                            mouseLeaveDelay={100}
                            content={
                              <div className="tab-anim-preview" data-anim={anim}>
                                <span className="tab-anim-preview__pill">首页</span>
                                <span className="tab-anim-preview__pill tab-anim-preview__pill--active">用户管理</span>
                                <span className="tab-anim-preview__pill tab-anim-preview__demo">角色管理</span>
                              </div>
                            }
                          >
                            {btn}
                          </Popover>
                        );
                      })}
                    </div>
                  </div>
                </>
              )}

              <div className="prefs-section-divider" />

              {/* ── 重置 ── */}
              <div>
                <Button
                  type="danger"
                  theme="light"
                  block
                  className="prefs-reset-btn"
                  onClick={() => {
                    Modal.confirm({
                      title: '重置偏好设置',
                      content: '确定要将所有偏好设置恢复为默认值吗？',
                      okText: '重置',
                      cancelText: '取消',
                      okButtonProps: { type: 'danger', theme: 'solid' },
                      onOk: () => {
                        resetPreferences();
                        resetTheme();
                      },
                    });
                  }}
                >
                  重置所有设置
                </Button>
              </div>

            </div>
          </SideSheet>
        </div>
      </div>

      {/* ===== 快捷聊天浮动按钮 ===== */}
      {(preferences.showQuickChat ?? true) && <QuickChatButton onHide={() => setPreferences({ showQuickChat: false })} />}

      {/* ===== 通知详情 Modal ===== */}
      <Modal
        title={selectedNotice?.title ?? ''}
        visible={selectedNotice !== null}
        onCancel={() => setSelectedNotice(null)}
        footer={null}
        width={640}
        closeOnEsc
      >
        {selectedNotice && (
          <div>
            <div style={{ marginBottom: 12, color: 'var(--semi-color-text-3)', fontSize: 12 }}>
              {selectedNotice.createByName ?? '-'} · {formatDateTime(selectedNotice.publishTime ?? selectedNotice.createdAt)}
            </div>
            <div
              style={{ lineHeight: 1.7 }}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(selectedNotice.content) }}
            />
          </div>
        )}
      </Modal>
    </div>
  );

  if (!watermarkConfig.enabled) return adminLayoutEl;
  return (
    <Watermark
      content={watermarkConfig.content || [user.nickname, user.username].filter((x): x is string => Boolean(x))}
      fontSize={watermarkConfig.fontSize}
      opacity={watermarkConfig.opacity}
      gapX={212}
      gapY={120}
      rotate={-22}
      zIndex={9}
    >
      {adminLayoutEl}
    </Watermark>
  );
}
