import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { RouteErrorBoundary } from '@/components/PageErrorBoundary';
import { UserAvatar } from '@/components/UserAvatar';
import { Badge, Breadcrumb, Button, ColorPicker, Divider, Dropdown, Empty, Input, List, Notification, Popover, Select, Tooltip, Modal, Nav, Typography, SideSheet, Switch, InputNumber, RadioGroup, Radio, Toast } from '@douyinfe/semi-ui';
import { IllustrationNoContent, IllustrationNoContentDark } from '@douyinfe/semi-illustrations';
import { Bell, Building2, Check, Info, Expand, Shrink, Megaphone, Sun, Moon, Monitor, MoreHorizontal, User as UserIcon, Settings, LogOut, X, Palette, Pin, RotateCcw, PinOff, XCircle, ChevronLeft, ChevronRight, Trash2, Lock, Copy } from 'lucide-react';
import MenuSearchInput, { type FlatMenuItem } from '@/components/MenuSearchInput';
import type { User, Menu, InAppMessage, Announcement, Tenant, WsMessage, SystemConfig } from '@zenith/shared';
import type { ThemeMode } from '@/hooks/useTheme';
import { usePreferences, type NavLayout, type TableSizePreference } from '@/hooks/usePreferences';
import { THEME_COLOR_PRESETS, getThemeColorVars } from '@/lib/theme-color';
import { useThemeController } from '@/providers/theme-controller';
import { useTabsStore } from '@/hooks/useTabsStore';
import { useWebSocket } from '@/hooks/useWebSocket';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { config } from '@/config';
import { renderLucideIcon } from '@/utils/icons';
import NProgress from '@/components/NProgress';
import Watermark from '@/components/Watermark';
import QuickChatButton from '@/components/QuickChatButton';
import AppLogo from '@/components/AppLogo';
import AnnouncementDetailModal from '@/components/AnnouncementDetailModal';
import { TopNavWithOverflow } from './TopNavWithOverflow';
import { LockScreen } from '@/components/LockScreen';
import { useLockScreen } from '@/hooks/useLockScreen';
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

// 提取为模块级函数，避免组件内嵌套函数超过 4 层
const updateMessageRead = (id: number) => (prev: InAppMessage[]) =>
  prev.map((m) => (m.id === id ? { ...m, isRead: true } : m));
const updateMessageReadIfUnread = (id: number) => (prev: InAppMessage[]) =>
  prev.map((m) => (m.id === id && !m.isRead ? { ...m, isRead: true } : m));
const markAllMessagesRead = (prev: InAppMessage[]) =>
  prev.map((m) => (m.isRead ? m : { ...m, isRead: true }));
const removeMessageById = (id: number) => (prev: InAppMessage[]) =>
  prev.filter((m) => m.id !== id);
const markAnnouncementRead = (id: number) => (prev: (Announcement & { isRead: boolean })[]) =>
  prev.map((a) => (a.id === id ? { ...a, isRead: true } : a));

type NavItem = {
  itemKey: string;
  text: string;
  icon?: React.ReactNode;
  items?: NavItem[];
  badge?: { count: number; overflowCount?: number };
  isExternal?: boolean;
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
  return { itemKey: menu.path ?? `menu-${menu.id}`, text: menu.title, icon, isExternal: menu.isExternal ?? false };
}

function findNavItemAncestorKeys(items: NavItem[], targetKey: string): string[] | null {
  for (const item of items) {
    if (item.itemKey === targetKey) return [];
    if (item.items?.length) {
      const found = findNavItemAncestorKeys(item.items, targetKey);
      if (found !== null) return [item.itemKey, ...found];
    }
  }
  return null;
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

interface BreadcrumbData {
  title: string;
  path?: string;
  icon?: string;
  menuChildren?: Menu[];
}

function findFirstLeafPath(children: Menu[]): string | null {
  for (const child of children) {
    if (!child.visible || child.type === 'button') continue;
    if (child.type === 'directory') {
      const leaf = findFirstLeafPath(child.children ?? []);
      if (leaf) return leaf;
    } else if (child.path) {
      return child.path;
    }
  }
  return null;
}

function findBreadcrumbs(menuTree: Menu[], targetPath: string): BreadcrumbData[] {
  function traverse(nodes: Menu[], ancestors: BreadcrumbData[]): BreadcrumbData[] | null {
    for (const node of nodes) {
      if (!node.visible || node.type === 'button') continue;
      if (node.type === 'directory') {
        const found = traverse(node.children ?? [], [...ancestors, { title: node.title, icon: node.icon ?? undefined, menuChildren: node.children ?? [] }]);
        if (found !== null) return found;
      } else if (node.path === targetPath) {
        return [...ancestors, { title: node.title, path: node.path ?? undefined, icon: node.icon ?? undefined }];
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
  const autoCollapsedRef = useRef(false);
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
  const { mode, themeColor, isDark, setThemeMode, setThemeColor } = useThemeController();

  const handleThemeModeChange = useCallback((newMode: ThemeMode) => {
    setThemeMode(newMode);
  }, [setThemeMode]);

  // ─── 响应式侧边栏断点 ──────────────────────────────────────────────────────
  useEffect(() => {
    const lgMq = globalThis.matchMedia('(max-width: 991px)');

    const handleLg = (e: MediaQueryList | MediaQueryListEvent) => {
      if (e.matches) {
        autoCollapsedRef.current = true;
        setCollapsed(true);
      } else if (autoCollapsedRef.current) {
        autoCollapsedRef.current = false;
        setCollapsed(false);
      }
    };

    handleLg(lgMq);

    lgMq.addEventListener('change', handleLg);
    return () => {
      lgMq.removeEventListener('change', handleLg);
    };
  }, []);

  const handleCollapseChange = useCallback((isCollapsed: boolean) => {
    autoCollapsedRef.current = false;
    setCollapsed(isCollapsed);
  }, []);

  // ─── 水印配置 ──────────────────────────────────────────────────────────────
  const [watermarkConfig, setWatermarkConfig] = useState({ enabled: false, content: '', fontSize: 14, opacity: 0.15 });

  useEffect(() => {
    request.get<{ list: SystemConfig[]; total: number }>('/api/system-configs?keys=watermark_enabled,watermark_content,watermark_font_size,watermark_opacity', { silent: true })
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

  // ─── 快捷聊天系统开关 ─────────────────────────────────────────────────────
  const [quickChatEnabled, setQuickChatEnabled] = useState(false);

  useEffect(() => {
    request.get<{ configValue: string }>('/api/system-configs/public/quick_chat_enabled', { silent: true })
      .then((res) => {
        if (res.code === 0) setQuickChatEnabled(res.data?.configValue === 'true');
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
  const { tabs, activeKey, setActiveKey, addTab, removeTab, closeOthers, closeLeft, closeRight, closeAll, reorderTabs, pinTab, unpinTab } = useTabsStore(
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
    preferences.enableTabs && (preferences.keepTabs ?? true),
  );
  const [prefsVisible, setPrefsVisible] = useState(false);
  const [lockPasswordModalVisible, setLockPasswordModalVisible] = useState(false);
  const [lockPasswordModalMode, setLockPasswordModalMode] = useState<'set' | 'change'>('set');
  const [newLockPassword, setNewLockPassword] = useState('');
  const [confirmLockPassword, setConfirmLockPassword] = useState('');
  const { isLocked, lock, verifyLockPassword, doUnlock, setLockPassword, clearLockPassword, hasPassword } = useLockScreen();
  const dragSrcKey = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [exitingTabKeys, setExitingTabKeys] = useState<Set<string>>(new Set());
  const [enteringTabKeys, setEnteringTabKeys] = useState<Set<string>>(new Set());
  const prevTabsLengthRef = useRef(0);
  const [manualTopKey, setManualTopKey] = useState<string | null>(null);
  const [tabRefreshVersion, setTabRefreshVersion] = useState<Record<string, number>>({});
  const navigate = useNavigate();
  const location = useLocation();

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
  const tabsBarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 延迟以确保 DOM 已完成渲染
    const timer = setTimeout(() => {
      if (activeTabRef.current) {
        activeTabRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [activeKey, tabs.length]);

  // 滚轮横向滚动（需要非 passive 监听以阻止页面纵向滚动）
  useEffect(() => {
    const el = tabsBarRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

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

  // ─── 公告 ──────────────────────────────────────────────────────────────────
  const [inAppMessages, setInAppMessages] = useState<InAppMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [announcementUnreadCount, setAnnouncementUnreadCount] = useState(0);
  const [announcementPopVisible, setAnnouncementPopVisible] = useState(false);
  const [recentAnnouncements, setRecentAnnouncements] = useState<(Announcement & { isRead: boolean })[]>([]);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [messagePopVisible, setMessagePopVisible] = useState(false);
  const [selectedMessage, setSelectedMessage] = useState<InAppMessage | null>(null);
  const recentInAppMessageRef = useRef(new Map<string, number>());

  const fetchAnnouncementUnreadCount = useCallback(() => {
    request.get<{ count: number }>('/api/announcements/unread-count', { silent: true }).then((res) => {
      if (res.code === 0 && res.data) setAnnouncementUnreadCount(res.data.count ?? 0);
    });
  }, []);

  const fetchRecentAnnouncements = useCallback(() => {
    request.get<(Announcement & { isRead: boolean })[]>('/api/announcements/published', { silent: true }).then((res) => {
      if (res.code === 0 && res.data) setRecentAnnouncements(res.data);
    });
  }, []);

  useEffect(() => { fetchAnnouncementUnreadCount(); }, [fetchAnnouncementUnreadCount]);

  // 监听 announcement 事件同步公告未读数
  useEffect(() => {
    const handler = () => { fetchAnnouncementUnreadCount(); fetchRecentAnnouncements(); };
    globalThis.addEventListener('announcement:refresh', handler);
    return () => globalThis.removeEventListener('announcement:refresh', handler);
  }, [fetchAnnouncementUnreadCount, fetchRecentAnnouncements]);

  const markAnnouncementAsRead = (id: number) => {
    request.post(`/api/announcements/${id}/read`, undefined, { silent: true }).then((res) => {
      if (res.code !== 0) return;
      setRecentAnnouncements(markAnnouncementRead(id));
      setAnnouncementUnreadCount((c) => Math.max(0, c - 1));
    });
  };

  const fetchInAppMessages = useCallback(() => {
    request.get<{ list: InAppMessage[]; total: number }>('/api/in-app-messages?page=1&pageSize=10', { silent: true }).then((res) => {
      if (res.code === 0 && res.data) setInAppMessages(res.data.list ?? []);
    });
    request.get<{ count: number }>('/api/in-app-messages/unread-count', { silent: true }).then((res) => {
      if (res.code === 0 && res.data) setUnreadCount(res.data.count ?? 0);
    });
  }, []);

  useEffect(() => { fetchInAppMessages(); }, [fetchInAppMessages]);

  // 监听其他页面（如站内信管理）触发的刷新事件，同步顶部铃铛 badge
  useEffect(() => {
    const handler = () => fetchInAppMessages();
    globalThis.addEventListener('in-app-messages:refresh', handler);
    return () => globalThis.removeEventListener('in-app-messages:refresh', handler);
  }, [fetchInAppMessages]);

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
    if (msg.type === 'in-app-message:new') {
      const messageKey = `${msg.payload.title}:${msg.payload.createdAt}`;
      const now = Date.now();

      for (const [key, timestamp] of recentInAppMessageRef.current) {
        if (now - timestamp > 60_000) {
          recentInAppMessageRef.current.delete(key);
        }
      }

      if (recentInAppMessageRef.current.has(messageKey)) {
        return;
      }

      recentInAppMessageRef.current.set(messageKey, now);

      // 重新拉一次以获取带有实际 id 的记录
      fetchInAppMessages();

      Notification.info({
        title: '新消息',
        content: msg.payload.title,
        duration: 5,
        position: 'topRight',
      });
    } else if (msg.type === 'in-app-message:read') {
      setInAppMessages(updateMessageReadIfUnread(msg.payload.id));
      setUnreadCount((c) => Math.max(0, c - 1));
    } else if (msg.type === 'in-app-message:read-all') {
      setInAppMessages(markAllMessagesRead);
      setUnreadCount(0);
    } else if (msg.type === 'in-app-message:deleted') {
      setInAppMessages((prev) => {
        const target = prev.find((m) => m.id === msg.payload.id);
        if (target && !target.isRead) setUnreadCount((c) => Math.max(0, c - 1));
        return removeMessageById(msg.payload.id)(prev);
      });
    } else if (
      msg.type === 'announcement:new' ||
      msg.type === 'announcement:updated' ||
      msg.type === 'announcement:deleted' ||
      msg.type === 'announcement:read' ||
      msg.type === 'announcement:read-all'
    ) {
      globalThis.dispatchEvent(new CustomEvent('announcement:refresh', { detail: msg }));
      if (msg.type === 'announcement:new') {
        Notification.info({
          title: '新公告',
          content: msg.payload.title,
          duration: 5,
          position: 'topRight',
        });
      }
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
      setTimeout(() => { clearLockPassword(); onLogout(); }, 2000);
    }
  }, [onLogout, fetchInAppMessages]);

  const { disconnect: disconnectWs } = useWebSocket(handleWsMessage);

  const markAsRead = (id: number) => {
    request.post(`/api/in-app-messages/${id}/read`, undefined, { silent: true }).then((res) => {
      if (res.code !== 0) return;
      setInAppMessages(updateMessageRead(id));
      setUnreadCount((c) => Math.max(0, c - 1));
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
  const displayBreadcrumbs = useMemo(() => {
    if ((preferences.breadcrumbShowHome ?? true) && location.pathname !== '/') {
      // 找到首页菜单的图标（findBreadcrumbs 不包含首页）
      const findHomeIcon = (nodes: Menu[]): string | undefined => {
        for (const node of nodes) {
          if (!node.visible || node.type === 'button') continue;
          if (node.type === 'directory' && node.children?.length) {
            const icon = findHomeIcon(node.children);
            if (icon) return icon;
          } else if (node.path === '/') {
            return node.icon ?? undefined;
          }
        }
        return undefined;
      };
      return [{ title: '首页', path: '/', icon: findHomeIcon(menuTree) }, ...breadcrumbs];
    }
    return breadcrumbs;
  }, [breadcrumbs, preferences.breadcrumbShowHome, location.pathname, menuTree]);
  const [openKeys, setOpenKeys] = useState<string[]>([]);

  useEffect(() => {
    if (!collapsed && currentSectionKeys.length > 0) {
      if (preferences.sidebarAccordion) {
        // 手风琴模式：路由切换时仅保留当前路径的祖先链
        setOpenKeys(currentSectionKeys);
      } else {
        setOpenKeys((prev) => Array.from(new Set([...prev, ...currentSectionKeys])));
      }
    }
  }, [collapsed, currentSectionKeys, preferences.sidebarAccordion]);

  // ─── 锁屏快捷键 Alt+L ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'l' && (preferences.enableLockScreen ?? false) && hasPassword()) {
        e.preventDefault();
        lock();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [preferences.enableLockScreen, hasPassword, lock]);

  const navItems = useMemo(
    () => menuTree.map(menuToNavItem).filter((item): item is NavItem => item !== null).map((item) => {
      if (item.itemKey === '/chat' && chatUnreadCount > 0) {
        return { ...item, badge: { count: chatUnreadCount, overflowCount: 99 } };
      }
      return item;
    }),
    [menuTree, chatUnreadCount]
  );

  const handleSidebarOpenChange = useCallback(
    ({ openKeys: nextOpenKeys }: { openKeys?: (string | number)[] }) => {
      const next = (nextOpenKeys ?? []).map(String);
      if (!(preferences.sidebarAccordion ?? false)) {
        setOpenKeys(next);
        return;
      }
      // 手风琴模式：找出新增的 key
      const newlyAdded = next.filter((k) => !openKeys.includes(k));
      if (newlyAdded.length === 0) {
        // 折叠操作，直接使用
        setOpenKeys(next);
        return;
      }
      // 取最深层新增的 key，保留其祖先链 + 自身，关闭兄弟分组
      const target = newlyAdded.at(-1)!;
      const ancestors = findNavItemAncestorKeys(navItems, target) ?? [];
      const validSet = new Set([...ancestors, target]);
      setOpenKeys(next.filter((k) => validSet.has(k)));
    },
    [openKeys, preferences.sidebarAccordion, navItems],
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
    if (navLayout !== 'mixed' && navLayout !== 'double') return null;
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
    if ((navLayout === 'mixed' || navLayout === 'double') && autoTopKey) setManualTopKey(autoTopKey);
  }, [navLayout, autoTopKey]);

  // 进入消息中心页面时重置聊天未读数
  useEffect(() => {
    if (location.pathname.startsWith('/chat')) {
      setChatUnreadCount(0);
    }
  }, [location.pathname]);

  const effectiveTopKey = manualTopKey ?? autoTopKey;

  const mixedTopNavItems = useMemo(
    () => navItems.map(({ itemKey, text, icon, isExternal }) => ({ itemKey, text, icon, isExternal })),
    [navItems],
  );

  const mixedSidebarItems = useMemo(() => {
    if (navLayout !== 'mixed') return [];
    const top = navItems.find((i) => i.itemKey === effectiveTopKey);
    return top?.items ?? [];
  }, [navLayout, navItems, effectiveTopKey]);

  const doubleSubItems = useMemo(() => {
    if (navLayout !== 'double') return [];
    const top = navItems.find((i) => i.itemKey === effectiveTopKey);
    return top?.items ?? [];
  }, [navLayout, navItems, effectiveTopKey]);

  const showSidebar = navLayout === 'vertical' || (navLayout === 'mixed' && mixedSidebarItems.length > 0) || navLayout === 'double';

  useEffect(() => {
    const pageTitle = resolveTitle(location.pathname);
    const isDynamic = preferences.dynamicTitle ?? true;
    document.title = isDynamic && pageTitle !== location.pathname
      ? `${pageTitle} - ${config.appTitle}`
      : config.appTitle;
  }, [location.pathname, resolveTitle, preferences.dynamicTitle]);

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

  // 预构建 itemKey → isExternal 映射，避免每次 renderWrapper 调用时重复遍历
  const externalNavKeys = useMemo(() => {
    const map = new Set<string>();
    function walk(items: NavItem[]) {
      for (const item of items) {
        if (item.isExternal) map.add(item.itemKey);
        if (item.items) walk(item.items);
      }
    }
    walk(navItems);
    return map;
  }, [navItems]);

  const renderWrapper = useCallback(
    (args: { itemElement: React.ReactNode; props: { itemKey?: string | number } }) => {
      const { itemElement, props: itemProps } = args;
      const itemKey = String(itemProps.itemKey ?? '');
      if (!itemKey.startsWith('/')) return itemElement;
      if (externalNavKeys.has(itemKey)) {
        return (
          <a href={itemKey} target="_blank" rel="noopener noreferrer" className="admin-nav-link-wrapper">
            {itemElement}
          </a>
        );
      }
      return (
        <NavLink to={itemKey} className="admin-nav-link-wrapper">
          {itemElement}
        </NavLink>
      );
    },
    [externalNavKeys],
  );

  const handleDoubleRailClick = useCallback((item: NavItem) => {
    setManualTopKey(item.itemKey);
    if (item.items?.length) {
      function findFirstLeaf(items: NavItem[]): string | null {
        for (const i of items) {
          if (i.items?.length) {
            const leaf = findFirstLeaf(i.items);
            if (leaf) return leaf;
          } else if (i.itemKey.startsWith('/')) {
            return i.itemKey;
          }
        }
        return null;
      }
      const leaf = findFirstLeaf(item.items);
      if (leaf) navigate(leaf);
    } else if (item.itemKey.startsWith('/')) {
      navigate(item.itemKey);
    }
  }, [navigate]);

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
      {(preferences.showMenuSearch ?? true) && <div className="admin-menu-search"><MenuSearchInput menus={flatMenus} /></div>}
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
                image={<IllustrationNoContent style={{ width: 80, height: 80 }} />}
                darkModeImage={<IllustrationNoContentDark style={{ width: 80, height: 80 }} />}
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
                image={<IllustrationNoContent style={{ width: 80, height: 80 }} />}
                darkModeImage={<IllustrationNoContentDark style={{ width: 80, height: 80 }} />}
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
                      setSelectedMessage(item);
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
      {/* 溢出菜单：窄屏时收纳公告/消息/主题切换 */}
      <div className="admin-header-action admin-header-action--more">
        <Dropdown
          position="bottomRight"
          render={
            <Dropdown.Menu>
              <Dropdown.Item
                icon={<Megaphone size={14} strokeWidth={1.5} />}
                onClick={() => navigate('/announcements')}
              >
                公告中心{announcementUnreadCount > 0 && <Badge count={announcementUnreadCount} overflowCount={99} style={{ marginLeft: 6 }} />}
              </Dropdown.Item>
              <Dropdown.Item
                icon={<Bell size={14} strokeWidth={1.5} />}
                onClick={() => navigate('/inbox')}
              >
                我的消息{unreadCount > 0 && <Badge count={unreadCount} overflowCount={99} style={{ marginLeft: 6 }} />}
              </Dropdown.Item>
              <Dropdown.Divider />
              <Dropdown.Title>颜色模式</Dropdown.Title>
              {(['light', 'dark', 'system'] as ThemeMode[]).map((m) => (
                <Dropdown.Item key={m} icon={themeLabelMap[m].icon} active={mode === m} onClick={() => handleThemeModeChange(m)}>
                  {themeLabelMap[m].label}
                </Dropdown.Item>
              ))}
            </Dropdown.Menu>
          }
        >
          <button className="admin-theme-btn" title="更多">
            <MoreHorizontal size={16} strokeWidth={1.5} />
          </button>
        </Dropdown>
      </div>
      {(preferences.showFullscreen ?? true) && (
        <button className="admin-theme-btn admin-theme-btn--fullscreen" title={isFullscreen ? '退出全屏' : '全屏显示'} onClick={toggleFullscreen}>
          {isFullscreen ? <Shrink size={16} strokeWidth={1.5} /> : <Expand size={16} strokeWidth={1.5} />}
        </button>
      )}
      <div style={{ width: 1, height: 16, backgroundColor: 'var(--color-border)', margin: '0 4px' }} />
      <Dropdown
        position="bottomRight"
        render={
          <Dropdown.Menu>
            <Dropdown.Item icon={<UserIcon size={14} strokeWidth={1.5} />} onClick={() => navigate('/profile')}>个人中心</Dropdown.Item>
            <Dropdown.Item
              icon={<Bell size={14} strokeWidth={1.5} />}
              onClick={() => navigate('/inbox')}
            >
              我的消息{unreadCount > 0 && <Badge count={unreadCount} overflowCount={99} style={{ marginLeft: 6 }} />}
            </Dropdown.Item>
            <Dropdown.Item icon={<Megaphone size={14} strokeWidth={1.5} />} onClick={() => navigate('/announcements')}>公告中心{announcementUnreadCount > 0 && <Badge count={announcementUnreadCount} overflowCount={99} style={{ marginLeft: 6 }} />}</Dropdown.Item>
            <Dropdown.Item icon={<Settings size={14} strokeWidth={1.5} />} onClick={() => setPrefsVisible(true)}>偏好设置</Dropdown.Item>
            {(preferences.enableLockScreen ?? false) && hasPassword() && (
              <Dropdown.Item icon={<Lock size={14} strokeWidth={1.5} />} onClick={() => lock()}>锁屏</Dropdown.Item>
            )}
            <Dropdown.Divider />
            <Dropdown.Item
              icon={<LogOut size={14} strokeWidth={1.5} />}
              onClick={() => Modal.confirm({
                title: '确认退出',
                content: '确定要退出登录吗？',
                okText: '退出',
                cancelText: '取消',
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: () => { disconnectWs(); clearLockPassword(); onLogout(); },
              })}
            >
              退出登录
            </Dropdown.Item>
          </Dropdown.Menu>
        }
      >
        <div className="admin-header__user">
          <UserAvatar name={user.nickname || '用户'} avatar={user.avatar} semiSize="small" size={24} style={{ fontSize: 12 }} />
          <span className="admin-header__username">{user.nickname}</span>
        </div>
      </Dropdown>
    </div>
  );

  const navigateHome = useCallback(() => navigate('/'), [navigate]);
  const handleNavigateHomeKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      navigate('/');
    }
  }, [navigate]);

  const mixedTopSelectedKeys = effectiveTopKey ? [effectiveTopKey] : [];
  const topNavSelectedKeys = navLayout === 'mixed' ? mixedTopSelectedKeys : currentSelectedKeys;
  const stickyNavClass = preferences.sidebarStickyScroll === false ? '' : ' admin-sidebar--sticky-nav';
  const sidebarClassName = `admin-sidebar${collapsed ? ' admin-sidebar--collapsed' : ''}${stickyNavClass}`;
  const layoutClassName = [
    'admin-layout',
    preferences.sidebarDarkMode ? 'admin-layout--sidebar-dark' : '',
    preferences.headerDarkMode ? 'admin-layout--header-dark' : '',
  ].filter(Boolean).join(' ');
  const sectionDarkThemeStyle = useMemo<CSSProperties>(() => {
    if (!preferences.sidebarDarkMode && !preferences.headerDarkMode) return {};
    const vars = getThemeColorVars(themeColor, true);
    return {
      '--admin-section-dark-primary': vars.primary,
      '--admin-section-dark-primary-hover': vars.hover,
      '--admin-section-dark-primary-active': vars.active,
      '--admin-section-dark-primary-light-default': vars.lightDefault,
      '--admin-section-dark-primary-light-hover': vars.lightHover,
      '--admin-section-dark-primary-light-active': vars.lightActive,
      '--admin-section-dark-sidebar-active': vars.sidebarActive,
    } as CSSProperties;
  }, [preferences.headerDarkMode, preferences.sidebarDarkMode, themeColor]);

  const adminLayoutEl = (
    <div className={layoutClassName} style={sectionDarkThemeStyle}>
      {/* Top bar for horizontal and mixed layouts */}
      {navLayout !== 'vertical' && navLayout !== 'double' && (
        <header className="admin-topbar">
          {(preferences.showLogo ?? true) && (
            <button
              type="button"
              className="admin-topbar__brand"
              style={{ cursor: 'pointer', background: 'transparent', border: 0, padding: 0, font: 'inherit', color: 'inherit' }}
              onClick={navigateHome}
              onKeyDown={handleNavigateHomeKey}
            >
              <AppLogo size={28} />
              <span className="admin-sidebar__title">{config.appTitle}</span>
            </button>
          )}
          <TopNavWithOverflow
            className="admin-topbar__nav"
            items={navLayout === 'mixed' ? mixedTopNavItems : navItems}
            selectedKeys={topNavSelectedKeys}
            onItemClick={navLayout === 'mixed' ? (key) => handleMixedTopSelect({ itemKey: key }) : undefined}
          />
          {headerActions}
        </header>
      )}

      <div className="admin-body">

{/* Sidebar — always in vertical, conditional in mixed, always in double */}
        {showSidebar && (
          navLayout === 'double' ? (
            <aside className={`admin-sidebar admin-sidebar--double${doubleSubItems.length === 0 ? ' admin-sidebar--double-no-sub' : ''}${stickyNavClass}`}>
              {/* Left icon rail */}
              <div className="double-sidebar__rail">
                {(preferences.showLogo ?? true) && (
                  <button
                    type="button"
                    className="double-sidebar__logo"
                    onClick={navigateHome}
                    onKeyDown={handleNavigateHomeKey}
                  >
                    <AppLogo size={26} />
                  </button>
                )}
                <div className="double-sidebar__rail-list">
                  {navItems.map((item) => {
                    const isActive = effectiveTopKey === item.itemKey;
                    return (
                      <button
                        key={item.itemKey}
                        type="button"
                        className={`double-sidebar__rail-item${isActive ? ' double-sidebar__rail-item--active' : ''}`}
                        onClick={() => handleDoubleRailClick(item)}
                        title={item.text}
                      >
                        <span className="double-sidebar__rail-icon">
                          {item.badge && item.badge.count > 0 ? (
                            <Badge count={item.badge.count} overflowCount={item.badge.overflowCount ?? 99}>
                              {item.icon}
                            </Badge>
                          ) : item.icon}
                        </span>
                        <span className="double-sidebar__rail-label">{item.text}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Right sub-nav */}
              <div className="double-sidebar__sub">
                {doubleSubItems.length > 0 && (
                  <>
                    <div className="double-sidebar__sub-title">
                      {navItems.find((i) => i.itemKey === effectiveTopKey)?.text ?? ''}
                    </div>
                    <Nav
                      className="admin-sidebar__nav double-sidebar__sub-nav"
                      mode="vertical"
                      items={doubleSubItems}
                      style={{ height: 'calc(100% - 48px)', overflow: 'hidden' }}
                      bodyStyle={{ paddingTop: 8 }}
                      isCollapsed={false}
                      selectedKeys={currentSelectedKeys}
                      openKeys={openKeys}
                      onOpenChange={handleSidebarOpenChange}
                      renderWrapper={renderWrapper}
                    />
                  </>
                )}
              </div>
            </aside>
          ) : (
            <aside className={sidebarClassName}>
              <Nav
                className="admin-sidebar__nav"
                mode="vertical"
                items={navLayout === 'mixed' ? mixedSidebarItems : navItems}
                style={{ height: '100%' }}
                bodyStyle={{ paddingTop: 8 }}
                isCollapsed={collapsed}
                selectedKeys={currentSelectedKeys}
                openKeys={collapsed ? [] : openKeys}
                onOpenChange={handleSidebarOpenChange}
                onCollapseChange={handleCollapseChange}
                header={
                  navLayout === 'vertical' && (preferences.showLogo ?? true)
                    ? {
                        logo: (
                          <button
                            type="button"
                            style={{ cursor: 'pointer', border: 0, padding: 0, background: 'transparent', display: 'flex' }}
                            onClick={navigateHome}
                            onKeyDown={handleNavigateHomeKey}
                          ><AppLogo size={28} /></button>
                        ),
                        text: (
                          <button
                            type="button"
                            className="admin-sidebar__title"
                            style={{ cursor: 'pointer', background: 'transparent', border: 0, padding: 0, font: 'inherit', color: 'inherit' }}
                            onClick={navigateHome}
                            onKeyDown={handleNavigateHomeKey}
                          >{config.appTitle}</button>
                        ),
                      }
                    : undefined
                }
                footer={{
                  collapseButton: true,
                  collapseText: (isCollapsed) => (isCollapsed ? '展开侧边栏' : '收起侧边栏'),
                }}
                renderWrapper={renderWrapper}
              />
            </aside>
          )
        )}


        {/* Main area */}
        <div className="admin-main">
          <NProgress />
          {/* Vertical mode has its own header bar */}
          {(navLayout === 'vertical' || navLayout === 'double') && (
            <header className="admin-header">
              {/* Left: breadcrumb (vertical / double layouts only) */}
              {preferences.showBreadcrumb && displayBreadcrumbs.length > 0 ? (
                <div className="admin-header__breadcrumb">
                  <Breadcrumb maxItemCount={10}>
                    {displayBreadcrumbs.map((crumb, index) => {
                      const isLast = index === displayBreadcrumbs.length - 1;
                      const isHome = crumb.path === '/';
                      const handleCrumbClick = (_item: unknown, e: React.MouseEvent) => {
                        e.preventDefault();
                        if (isHome) { navigateHome(); return; }
                        if (crumb.path) { navigate(crumb.path); return; }
                        if (crumb.menuChildren) {
                          const leaf = findFirstLeafPath(crumb.menuChildren);
                          if (leaf) navigate(leaf);
                        }
                      };
                      return (
                        <Breadcrumb.Item
                          key={crumb.title}
                          href={isLast ? undefined : '#'}
                          onClick={isLast ? undefined : handleCrumbClick}
                          noLink={isLast}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            {preferences.breadcrumbIcon && crumb.icon && <span style={{ display: 'flex', alignItems: 'center' }}>{renderLucideIcon(crumb.icon, 13)}</span>}
                            {isHome ? '首页' : crumb.title}
                          </span>
                        </Breadcrumb.Item>
                      );
                    })}
                  </Breadcrumb>
                </div>
              ) : (
                <div />
              )}
              {headerActions}
            </header>
          )}
          {/* Tabs bar — shown above breadcrumb for all layouts */}
          {preferences.enableTabs && tabs.length > 0 && (
            <div ref={tabsBarRef} className={`admin-tabs-bar${preferences.showBreadcrumb ? ' admin-tabs-bar--with-breadcrumb' : ''}`} data-tab-animation={preferences.tabAnimation} data-tab-style={preferences.tabStyle ?? 'line'}>
              {tabs.map((tab, tabIndex) => {
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
                  const hasClosableLeft = tabIndex > 0 && tabs.slice(0, tabIndex).some((t) => t.closable);
                  const hasClosableRight = tabs.slice(tabIndex + 1).some((t) => t.closable);
                  const hasClosableOthers = tabs.some((t) => t.closable && t.key !== tab.key);
                  const hasAnyClosable = tabs.some((t) => t.closable);
                  return (
                  <Dropdown
                    key={tab.key}
                    trigger="contextMenu"
                    position="bottomLeft"
                    clickToHide
                    render={
                      <Dropdown.Menu>
                        <Dropdown.Item icon={<RotateCcw size={14} />} onClick={() => handleTabRefresh(tab.key)}>刷新页面</Dropdown.Item>
                        <Dropdown.Item icon={<Copy size={14} />} onClick={() => void navigator.clipboard.writeText(tab.title)}>复制名称</Dropdown.Item>
                        {tab.key !== '/' && (
                          tab.pinned
                            ? <Dropdown.Item icon={<PinOff size={14} />} onClick={() => unpinTab(tab.key)}>取消固定</Dropdown.Item>
                            : <Dropdown.Item icon={<Pin size={14} />} onClick={() => pinTab(tab.key)}>固定标签页</Dropdown.Item>
                        )}
                        <Dropdown.Divider />
                        <Dropdown.Item icon={<X size={14} />} disabled={!tab.closable} onClick={() => handleTabClose(tab.key)}>关闭当前</Dropdown.Item>
                        <Dropdown.Item icon={<XCircle size={14} />} disabled={!hasClosableOthers} onClick={() => { const nextKey = closeOthers(tab.key); navigate(nextKey); }}>关闭其他</Dropdown.Item>
                        <Dropdown.Item icon={<ChevronLeft size={14} />} disabled={!hasClosableLeft} onClick={() => { const nextKey = closeLeft(tab.key); navigate(nextKey); }}>关闭左侧</Dropdown.Item>
                        <Dropdown.Item icon={<ChevronRight size={14} />} disabled={!hasClosableRight} onClick={() => { const nextKey = closeRight(tab.key); navigate(nextKey); }}>关闭右侧</Dropdown.Item>
                        <Dropdown.Item icon={<Trash2 size={14} />} disabled={!hasAnyClosable} onClick={() => { closeAll(); navigate('/'); }}>关闭全部</Dropdown.Item>
                      </Dropdown.Menu>
                    }
                  >
                    <div
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
                      onMouseDown={(e) => { if (e.button === 1 && tab.closable) { e.preventDefault(); handleTabClose(tab.key); } }}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleTabChange(tab.key); }}
                    >
                      {preferences.showTabIcon && pathIconMap[tab.key] && (
                        <span className="admin-tab-item__icon">{renderLucideIcon(pathIconMap[tab.key], 14)}</span>
                      )}
                      <span className="admin-tab-item__text">{tab.title}</span>
                      {tab.pinned && (
                        <span className="admin-tab-item__pin"><Pin size={10} /></span>
                      )}
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
                  </Dropdown>
                  );
              })}
            </div>
          )}
          <div className="admin-content" style={{ background: 'var(--color-layout-bg)', overflow: 'auto', position: 'relative' }}>
            <RouteErrorBoundary>
              <Outlet key={outletRefreshKey} />
            </RouteErrorBoundary>
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
                  {([
                    { value: 'vertical' as NavLayout, label: '左侧菜单' },
                    { value: 'horizontal' as NavLayout, label: '顶部菜单' },
                    { value: 'mixed' as NavLayout, label: '混合菜单' },
                    { value: 'double' as NavLayout, label: '双列菜单' },
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

              {!isDark && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>侧边栏深色模式</span>
                    <Switch checked={preferences.sidebarDarkMode ?? false} onChange={(v) => setPreferences({ sidebarDarkMode: v })} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>顶部栏深色模式</span>
                    <Switch checked={preferences.headerDarkMode ?? false} onChange={(v) => setPreferences({ headerDarkMode: v })} />
                  </div>
                </>
              )}

              {/* ── 主题色 ── */}
              <div>
                <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 500, color: 'var(--semi-color-text-0)' }}>主题颜色</div>
                <div className="theme-color-picker">
                  {THEME_COLOR_PRESETS.map((preset) => {
                    const colorIsDark = mode === 'dark' || (mode === 'system' && globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches);
                    const currentColor = colorIsDark ? preset.dark.primary : preset.light.primary;
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
                  <ColorPicker
                    alpha={false}
                    usePopover
                    value={themeColor.startsWith('#') ? ColorPicker.colorStringToValue(themeColor) : undefined}
                    onChange={(v) => setThemeColor(v.hex)}
                    popoverProps={{ position: 'top', zIndex: 10010 }}
                  >
                    <button
                      type="button"
                      className={`theme-color-swatch theme-color-swatch--custom${themeColor.startsWith('#') ? ' theme-color-swatch--active' : ''}`}
                      style={themeColor.startsWith('#') ? { backgroundColor: themeColor, color: themeColor } : {}}
                      title="自定义颜色"
                    >
                      {themeColor.startsWith('#')
                        ? <span className="theme-color-swatch__check"><Check size={14} strokeWidth={2.5} /></span>
                        : <span className="theme-color-swatch__icon"><Palette size={14} /></span>
                      }
                    </button>
                  </ColorPicker>
                </div>
              </div>

              {/* ── Logo 图标 ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>显示 Logo 图标</span>
                <Switch checked={preferences.showLogo ?? true} onChange={(v) => setPreferences({ showLogo: v })} />
              </div>

              {/* ── 动态标题 ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  动态浏览器标题
                  <Tooltip content="开启后浏览器标签页标题会随当前页面变化，如「用户管理 - Zenith Admin」；关闭后固定显示应用名称" position="right">
                    <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
                  </Tooltip>
                </span>
                <Switch checked={preferences.dynamicTitle ?? true} onChange={(v) => setPreferences({ dynamicTitle: v })} />
              </div>

              {/* ── 面包屑 ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  显示面包屑导航
                  <Tooltip content="在页面顶部显示路径导航（如：首页 / 系统管理 / 用户管理），帮助定位当前位置" position="right">
                    <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
                  </Tooltip>
                </span>
                <Switch checked={preferences.showBreadcrumb} onChange={(v) => setPreferences({ showBreadcrumb: v })} />
              </div>
              {preferences.showBreadcrumb && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>面包屑显示图标</span>
                    <Switch checked={preferences.breadcrumbIcon ?? false} onChange={(v) => setPreferences({ breadcrumbIcon: v })} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      面包屑从首页开始
                      <Tooltip content="开启后面包屑导航会以「首页」作为第一项，关闭后直接从当前页面的父级路径开始" position="right">
                        <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
                      </Tooltip>
                    </span>
                    <Switch checked={preferences.breadcrumbShowHome ?? true} onChange={(v) => setPreferences({ breadcrumbShowHome: v })} />
                  </div>
                </>
              )}

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
              {quickChatEnabled && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    显示快捷聊天按钮
                    <Tooltip content="在页面右下角显示浮动聊天按钮，可快速唤起 AI 助手" position="right">
                      <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
                    </Tooltip>
                  </span>
                  <Switch checked={preferences.showQuickChat ?? true} onChange={(v) => setPreferences({ showQuickChat: v })} />
                </div>
              )}

              {/* ── 文件默认视图 ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>文件列表默认视图</span>
                <RadioGroup
                  type="button"
                  value={preferences.filesViewMode ?? 'list'}
                  onChange={(e) => setPreferences({ filesViewMode: e.target.value as 'list' | 'grid' })}
                >
                  <Radio value="list">列表</Radio>
                  <Radio value="grid">网格</Radio>
                </RadioGroup>
              </div>

              {/* ── 侧边栏分组标题 sticky ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  侧边栏分组标题滚动固定
                  <Tooltip content="侧边栏菜单滚动时，分组标题吸附固定在顶部，便于识别当前菜单所属分组" position="right">
                    <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
                  </Tooltip>
                </span>
                <Switch checked={preferences.sidebarStickyScroll ?? true} onChange={(v) => setPreferences({ sidebarStickyScroll: v })} />
              </div>

              {/* ── 侧栏手风琴展开 ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  侧栏排他展开
                  <Tooltip content="开启后侧边栏同级菜单同时只允许展开一项，点击其他分组时自动收起之前展开的分组" position="right">
                    <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
                  </Tooltip>
                </span>
                <Switch checked={preferences.sidebarAccordion ?? false} onChange={(v) => setPreferences({ sidebarAccordion: v })} />
              </div>

              {/* ── 锁屏 ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  开启屏幕锁
                  <Tooltip content="开启后可通过 Alt+L 快捷键或用户菜单锁定屏幕，解锁需输入密码" position="right">
                    <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
                  </Tooltip>
                </span>
                <Switch
                  checked={preferences.enableLockScreen ?? false}
                  onChange={(v) => {
                    if (v) {
                      setLockPasswordModalMode('set');
                      setNewLockPassword('');
                      setConfirmLockPassword('');
                      setLockPasswordModalVisible(true);
                    } else {
                      clearLockPassword();
                      setPreferences({ enableLockScreen: false });
                    }
                  }}
                />
              </div>
              {(preferences.enableLockScreen ?? false) && hasPassword() && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>锁屏密码</span>
                  <Button
                    size="small"
                    theme="light"
                    onClick={() => {
                      setLockPasswordModalMode('change');
                      setNewLockPassword('');
                      setConfirmLockPassword('');
                      setLockPasswordModalVisible(true);
                    }}
                  >
                    修改密码
                  </Button>
                </div>
              )}

              <Divider style={{ margin: '0 -24px' }} />

              {/* ── 表格设置 ── */}
              <div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>显示表格边框</span>
                    <Switch checked={preferences.tableBordered ?? true} onChange={(v) => setPreferences({ tableBordered: v })} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>启用斑马纹</span>
                    <Switch checked={preferences.tableStriped ?? false} onChange={(v) => setPreferences({ tableStriped: v })} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>表格尺寸</span>
                    <RadioGroup
                      type="button"
                      value={preferences.tableSize ?? 'default'}
                      onChange={(e) => setPreferences({ tableSize: e.target.value as TableSizePreference })}
                    >
                      <Radio value="small">紧凑</Radio>
                      <Radio value="middle">适中</Radio>
                      <Radio value="default">宽松</Radio>
                    </RadioGroup>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>默认分页大小</span>
                    <Select
                      value={preferences.tablePageSize ?? 10}
                      onChange={(v) => setPreferences({ tablePageSize: v as number })}
                      style={{ width: 100 }}
                      optionList={[10, 20, 50, 100].map((v) => ({ value: v, label: `${v} 条` }))}
                    />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>显示表格列设置按钮</span>
                    <Switch checked={preferences.showTableColumnSettings ?? true} onChange={(v) => setPreferences({ showTableColumnSettings: v })} />
                  </div>
                </div>
              </div>

              <Divider style={{ margin: '0 -24px' }} />

              {/* ── 多标签页 ── */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>启用多标签页</span>
                <Switch checked={preferences.enableTabs} onChange={(v) => setPreferences({ enableTabs: v })} />
              </div>
              {preferences.enableTabs && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      保存标签页
                      <Tooltip content="刷新页面或重新登录后，自动恢复上次打开的标签页" position="right">
                        <Info size={13} style={{ color: 'var(--semi-color-text-2)', cursor: 'help' }} />
                      </Tooltip>
                    </span>
                    <Switch checked={preferences.keepTabs ?? true} onChange={(v) => setPreferences({ keepTabs: v })} />
                  </div>
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

                  {/* ── 标签页风格 ── */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>标签页风格</span>
                    <RadioGroup
                      type="button"
                      value={preferences.tabStyle ?? 'line'}
                      onChange={(e) => setPreferences({ tabStyle: e.target.value as 'line' | 'pill' | 'card' })}
                    >
                      <Radio value="line">线条</Radio>
                      <Radio value="pill">胶囊</Radio>
                      <Radio value="card">卡片</Radio>
                    </RadioGroup>
                  </div>

                  {/* ── 标签页动画 ── */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>标签页动画</span>
                    <RadioGroup
                      type="button"
                      value={preferences.tabAnimation ?? 'none'}
                      onChange={(e) => setPreferences({ tabAnimation: e.target.value as 'none' | 'fade' | 'slide' | 'scale' })}
                    >
                      {(['none', 'fade', 'slide', 'scale'] as const).map((anim) => {
                        const labels: Record<string, string> = { none: '无', fade: '淡入', slide: '滑入', scale: '缩放' };
                        const radio = <Radio value={anim}>{labels[anim]}</Radio>;
                        if (anim === 'none') return radio;
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
                            {radio}
                          </Popover>
                        );
                      })}
                    </RadioGroup>
                  </div>
                </>
              )}

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
                      },
                    });
                  }}
                >
                  重置所有设置
                </Button>
              </div>

            </div>
          </SideSheet>

          {/* ─── 锁屏密码设置 Modal ─── */}
          <Modal
            title={lockPasswordModalMode === 'set' ? '设置锁屏密码' : '修改锁屏密码'}
            visible={lockPasswordModalVisible}
            onCancel={() => {
              setLockPasswordModalVisible(false);
              setNewLockPassword('');
              setConfirmLockPassword('');
            }}
            onOk={() => {
              if (!newLockPassword) {
                Toast.warning('请输入密码');
                return;
              }
              if (newLockPassword.length < 4) {
                Toast.warning('密码长度不能少于 4 位');
                return;
              }
              if (newLockPassword !== confirmLockPassword) {
                Toast.warning('两次输入的密码不一致');
                return;
              }
              setLockPassword(newLockPassword);
              setPreferences({ enableLockScreen: true });
              setLockPasswordModalVisible(false);
              setNewLockPassword('');
              setConfirmLockPassword('');
              Toast.success(lockPasswordModalMode === 'set' ? '锁屏密码设置成功' : '锁屏密码修改成功');
            }}
            okText="确定"
            cancelText="取消"
            closeOnEsc
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Input
                type="password"
                placeholder="请输入密码（至少 4 位）"
                value={newLockPassword}
                onChange={(v) => setNewLockPassword(v)}
              />
              <Input
                type="password"
                placeholder="请再次输入密码"
                value={confirmLockPassword}
                onChange={(v) => setConfirmLockPassword(v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    (e.currentTarget.closest('.semi-modal')?.querySelector('.semi-button-primary') as HTMLButtonElement | null)?.click();
                  }
                }}
              />
            </div>
          </Modal>
        </div>
      </div>

      {/* ===== 锁屏遮罩 ===== */}
      {isLocked && (
        <LockScreen
          user={user}
          onVerify={verifyLockPassword}
          onUnlocked={doUnlock}
          onReLogin={() => { clearLockPassword(); disconnectWs(); onLogout(); }}
        />
      )}

      {/* ===== 快捷聊天浮动按钮 ===== */}
      {quickChatEnabled && (preferences.showQuickChat ?? true) && <QuickChatButton onHide={() => setPreferences({ showQuickChat: false })} />}

      {/* ===== 消息详情 Modal ===== */}
      <Modal
        title={selectedMessage?.title ?? ''}
        visible={selectedMessage !== null}
        onCancel={() => setSelectedMessage(null)}
        footer={null}
        width={640}
        closeOnEsc
      >
        {selectedMessage && (
          <div>
            <div style={{ marginBottom: 12, color: 'var(--semi-color-text-3)', fontSize: 12 }}>
              {selectedMessage.senderName ?? '系统'} · {formatDateTime(selectedMessage.createdAt)}
            </div>
            <div style={{ lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
              {selectedMessage.content}
            </div>
          </div>
        )}
      </Modal>

      {/* ===== 公告详情 Modal ===== */}
      <AnnouncementDetailModal
        announcement={selectedAnnouncement}
        visible={selectedAnnouncement !== null}
        onClose={() => setSelectedAnnouncement(null)}
      />
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
