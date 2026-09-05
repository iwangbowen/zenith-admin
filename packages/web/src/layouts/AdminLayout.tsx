import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { RouteErrorBoundary } from '@/components/PageErrorBoundary';
import { BackTop, Divider, SideSheet, Toast } from '@douyinfe/semi-ui';
import { Expand, Shrink } from 'lucide-react';
import { ensurePinyin } from '@/utils/pinyin';
import { copyText } from '@/utils/clipboard';
import MenuSearchInput, { type FlatMenuItem } from '@/components/MenuSearchInput';
import type { User, Menu } from '@zenith/shared/identity';
import type { ThemeMode } from '@/hooks/useTheme';
import { usePreferences, type NavLayout } from '@/hooks/usePreferences';
import { getThemeColorVars } from '@/lib/theme-color';
import { applyBorderRadius } from '@/lib/border-radius';
import { useThemeController } from '@/providers/theme-controller';
import { useTabsStore, type TabItem } from '@/hooks/useTabsStore';
import { useEventCallback } from '@/hooks/useEventCallback';
import { TabsMetaContext } from '@/hooks/useTabMeta';
import KeepAliveOutlet from './KeepAliveOutlet';
import { useWorkflowRealtime } from '@/hooks/useWorkflowNotifications';
import { useMarkMyInAppMessageRead } from '@/hooks/queries/in-app-messages';
import { config } from '@/config';
import NProgress from '@/components/NProgress';
import Watermark from '@/components/Watermark';
import { FeedbackWidget } from '@/components/FeedbackWidget';
import { usePublicConfig } from '@/hooks/queries/system-configs';
// 重依赖懒加载：快捷聊天（Semi Chat 组件树）、音视频通话、聊天通知、锁屏（lunar 农历 ~300KB）均不进首屏 chunk
const QuickChatButton = lazy(() => import('@/components/QuickChatButton'));
const CallOverlayHost = lazy(() => import('@/webrtc/CallOverlayHost'));
const ChatNotifierHost = lazy(() => import('@/pages/chat/ChatNotifierHost'));
const LockScreen = lazy(() => import('@/components/LockScreen').then((m) => ({ default: m.LockScreen })));
// 公告详情弹窗拖 FileAttachment→FilePreviewModal 依赖链，改为打开时按需加载
const AnnouncementDetailModal = lazy(() => import('@/components/AnnouncementDetailModal'));
import TaskTray from '@/components/TaskTray';
import { KeywordInput } from '@/components/search-filters';
import { TabSwitcher } from './TabSwitcher';
import { TabBarItem, type TabBarItemActions } from './admin/TabBarItem';
import { useLockScreen } from '@/hooks/useLockScreen';
import { useFavoriteMenus } from '@/hooks/useFavoriteMenus';
import { useRecentMenus } from '@/hooks/useRecentMenus';
import { usePageTracker } from '@/hooks/usePageTracker';
import { useMediaQuery, useIsMobile } from '@/hooks/useMediaQuery';
import { mediaDown } from '@/lib/breakpoints';
import { findBreadcrumbs, findNavItemAncestorKeys, updateMessageRead, computeTabClosableFlags } from './admin/utils';
import { useWatermarkConfig, useQuickChatEnabled } from './admin/useSystemConfigFlags';
import { useFullscreen } from './admin/useFullscreen';
import { usePreferencesPanel } from './admin/usePreferencesPanel';
import { useAutoLock } from './admin/useAutoLock';
import { useTabsBarScroll } from './admin/useTabsBarScroll';
import { useMaintenanceBanner } from './admin/useMaintenanceBanner';
import { useTenantSwitch } from './admin/useTenantSwitch';
import { useInAppNotifications, useChatUnread } from './admin/useInAppNotifications';
import { useLayoutWs } from './admin/useLayoutWs';
import { useSidebarOpenKeys } from './admin/useSidebarOpenKeys';
import { useLayoutShortcuts } from './admin/useLayoutShortcuts';
import { useFlatMenus, useBreadcrumbData, useNavItems, useMenuMaps, useAutoTopKey, useMixedNavItems, useKeepAlivePaths } from './admin/useMenuDerived';
import { useNavInteractions } from './admin/useNavInteractions';
import { useScrollMenuIntoView } from './admin/useScrollMenuIntoView';
import { useSectionDarkPopupContainer } from './admin/useSectionDarkPopup';
import { MobileQuickPagesPanel } from './admin/MobileQuickPagesPanel';
import { FavoritesPopover } from './admin/QuickAccessPopovers';
import { TenantSwitcher } from './admin/TenantSwitcher';
import { AnnouncementPopover, MessagePopover } from './admin/NotificationPopovers';
import { ThemeModeDropdown, PagesDropdown, MoreDropdown } from './admin/HeaderDropdowns';
import { UserDropdown } from './admin/UserDropdown';
import { MaintenanceBanner } from './admin/MaintenanceBanner';
import { MobileHeader, MobileNavSheet } from './admin/MobileNav';
import { TopBar } from './admin/TopBar';
import { DoubleSidebar } from './admin/DoubleSidebar';
import { SidebarNav } from './admin/SidebarNav';
import { HeaderBreadcrumb } from './admin/HeaderBreadcrumb';
import { PrefsLayoutSection, PrefsAppearanceSection, PrefsNavToolbarSection, PrefsSidebarSection, PrefsGeneralSection, PrefsTableSection, PrefsTabsSection, PrefsActionsSection } from './admin/PreferencesSections';
import { ShortcutsModal } from './admin/ShortcutsModal';
import { ImportPreferencesModal, LockPasswordModal, MessageDetailModal } from './admin/LayoutModals';
import './AdminLayout.css';

interface AdminLayoutProps {
  readonly user: Omit<User, 'password'>;
  readonly onLogout: () => void;
  /** 当前用户可见菜单树（由 App 的 TanStack Query 提供，本组件不再持有副本） */
  readonly menus: Menu[];
}

export default function AdminLayout({ user, onLogout, menus: menuTree }: AdminLayoutProps) {
  const { preferences, setPreferences, resetPreferences } = usePreferences();
  // hover 模式下侧边栏应保持收起：刷新页面后依据偏好恢复收起状态
  const [collapsed, setCollapsed] = useState(() => preferences.sidebarHoverTrigger ?? false);
  const autoCollapsedRef = useRef(false);
  // hover 模式：鼠标悬浮时侧边栏临时滑出
  const [sidebarHovered, setSidebarHovered] = useState(false);
  // 响应式断点统一走 useMediaQuery，断点值来自 @/lib/breakpoints（与 CSS 对齐）
  const isMobileNav = useIsMobile();                 // < 768：启用移动端导航
  const isBelowLg = useMediaQuery(mediaDown('lg'));  // < 992：侧边栏自动收起
  const [mobileNavVisible, setMobileNavVisible] = useState(false);
  const [mobilePagesVisible, setMobilePagesVisible] = useState(false);

  const flatMenus = useFlatMenus(menuTree);
  // hover 模式下实际用于渲染的 collapsed：开启 hover 模式且已收起且鼠标悬浮时临时展开
  const effectiveCollapsed = (preferences.sidebarHoverTrigger && collapsed && sidebarHovered) ? false : collapsed;
  const { mode, themeColor, isDark, setThemeMode, setThemeColor } = useThemeController();

  const handleThemeModeChange = useCallback((newMode: ThemeMode) => {
    setThemeMode(newMode);
  }, [setThemeMode]);

  // ─── 响应式侧边栏断点 ──────────────────────────────────────────────────────
  // < 992：自动收起侧栏；变宽时仅在「自动收起」状态下还原，尊重用户的手动操作
  useEffect(() => {
    if (isBelowLg) {
      autoCollapsedRef.current = true;
      setCollapsed(true);
    } else if (autoCollapsedRef.current) {
      autoCollapsedRef.current = false;
      setCollapsed(false);
    }
  }, [isBelowLg]);

  // 离开移动端时关闭移动导航相关浮层
  useEffect(() => {
    if (!isMobileNav) {
      setMobileNavVisible(false);
      setMobilePagesVisible(false);
    }
  }, [isMobileNav]);

  const handleCollapseChange = useCallback((isCollapsed: boolean) => {
    autoCollapsedRef.current = false;
    setCollapsed(isCollapsed);
  }, []);

  // ─── hover 模式开关联动 ─────────────────────────────────────────────────────
  // 开启时收起侧边栏（含服务器偏好异步覆盖本地缓存的场景）；从开启切回关闭时还原展开。
  // 定义在断点效果之后，确保宽窗口下 hover 模式的收起优先生效。
  const sidebarHoverTrigger = preferences.sidebarHoverTrigger ?? false;
  const prevHoverTriggerRef = useRef(sidebarHoverTrigger);
  useEffect(() => {
    const prev = prevHoverTriggerRef.current;
    prevHoverTriggerRef.current = sidebarHoverTrigger;
    if (sidebarHoverTrigger) {
      autoCollapsedRef.current = false;
      setSidebarHovered(false);
      setCollapsed(true);
    } else if (prev && !isBelowLg) {
      // 仅在「开启 → 关闭」时还原，避免干扰手动收起或断点自动收起
      setCollapsed(false);
    }
  }, [sidebarHoverTrigger, isBelowLg]);

  // ─── 全局圆角 ──────────────────────────────────────────────────────────────
  // 覆盖 body 上的 Semi 圆角 token，Portal 弹层同样生效
  useEffect(() => {
    applyBorderRadius(preferences.borderRadius ?? 'medium');
  }, [preferences.borderRadius]);

  const reduceMotion = preferences.reduceMotion ?? false;

  // ─── 水印配置 ──────────────────────────────────────────────────────────────
  const watermarkConfig = useWatermarkConfig();

  // ─── 快捷聊天系统开关 ─────────────────────────────────────────────────────
  const quickChatEnabled = useQuickChatEnabled();

  // ─── 意见反馈入口（feedback_entry_enabled 系统配置控制显隐）───────────────
  const feedbackEntryQuery = usePublicConfig('feedback_entry_enabled');
  const feedbackEntryEnabled = feedbackEntryQuery.data?.configValue === 'true';
  const [feedbackVisible, setFeedbackVisible] = useState(false);

  // Fullscreen
  const { isFullscreen, toggleFullscreen } = useFullscreen();

  // 每次 App 会话只弹一次：见过一次后不再重复
  const evictToastShownRef = useRef(false);
  const { tabs, activeKey, setActiveKey, addTab, setTabMeta, removeTab, closeOthers, closeLeft, closeRight, closeAll, reorderTabs, pinTab, unpinTab } = useTabsStore(
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
    preferences.tabEvictPolicy ?? 'fifo',
    preferences.openTabBehavior ?? 'append',
  );
  const {
    prefsVisible, setPrefsVisible,
    prefsSearch, setPrefsSearch,
    matchesPref, prefSection, handleCopyPreferences,
    importPrefsVisible, setImportPrefsVisible,
    importPrefsText, setImportPrefsText,
    handleImportPreferences,
  } = usePreferencesPanel(preferences, setPreferences);

  // 默认首页候选：当前用户可见的菜单页面
  const homePathOptions = useMemo(() => [
    { value: '/', label: '首页（默认）' },
    ...flatMenus.map((m) => ({
      value: m.path,
      label: m.breadcrumb.length ? `${m.breadcrumb.join(' / ')} / ${m.title}` : m.title,
    })),
  ], [flatMenus]);
  const [shortcutsVisible, setShortcutsVisible] = useState(false);
  const { favorites, isFavorite, toggle: toggleFavorite } = useFavoriteMenus();
  const [isContentFullscreen, setIsContentFullscreen] = useState(false);
  const [lockPasswordModalVisible, setLockPasswordModalVisible] = useState(false);
  const [lockPasswordModalMode, setLockPasswordModalMode] = useState<'set' | 'change'>('set');
  const [newLockPassword, setNewLockPassword] = useState('');
  const [confirmLockPassword, setConfirmLockPassword] = useState('');
  const { isLocked, lock, verifyLockPassword, doUnlock, setLockPassword, clearLockPassword, hasPassword } = useLockScreen();

  // ─── 无操作自动锁屏 ─────────────────────────────────────────────────────────
  const autoLockMinutes = Number(preferences.autoLockMinutes) || 0;
  useAutoLock(autoLockMinutes, preferences.enableLockScreen, isLocked, hasPassword, lock);
  const dragSrcKey = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [exitingTabKeys, setExitingTabKeys] = useState<Set<string>>(new Set());
  const [enteringTabKeys, setEnteringTabKeys] = useState<Set<string>>(new Set());
  const prevTabsLengthRef = useRef(0);
  const [manualTopKey, setManualTopKey] = useState<string | null>(null);
  const [tabRefreshVersion, setTabRefreshVersion] = useState<Record<string, number>>({});
  const navigate = useNavigate();
  const location = useLocation();
  const { recents, clear: clearRecents, remove: removeRecent } = useRecentMenus(flatMenus, location.pathname);

  // 全局页面浏览埋点：自动记录所有后台页面的 PV / 停留时长（无需逐页接入 usePageTracker）
  const currentPageTitle = useMemo(
    () => flatMenus.find((m) => m.path === location.pathname)?.title,
    [flatMenus, location.pathname],
  );
  usePageTracker(currentPageTitle);

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
  const { activeTabRef, tabsBarRef, tabsScrollRef } = useTabsBarScroll(activeKey, tabs.length, preferences.enableTabs);

  // ─── 租户切换（仅平台管理员） ─────────────────────────────────────────────
  const isPlatformAdmin = config.multiTenantMode && !user.tenantId && user.roles?.some((r) => r.code === 'super_admin');
  const isSuperAdmin = user.roles?.some((r) => r.code === 'super_admin') ?? false;

  // ─── 维护模式横幅（超管提示） ─────────────────────────────────────────
  const { maintenanceBannerEnabled, maintenanceBannerMsg, disablingMaintenance, handleDisableMaintenance } = useMaintenanceBanner(isSuperAdmin);
  const { tenantList, viewingTenantId, handleSwitchTenant } = useTenantSwitch(isPlatformAdmin, user.viewingTenantId);

  // ─── 公告 ──────────────────────────────────────────────────────────────────
  const {
    inAppMessages, setInAppMessages,
    unreadCount, setUnreadCount,
    announcementUnreadCount,
    announcementPopVisible, setAnnouncementPopVisible,
    recentAnnouncements,
    selectedAnnouncement, setSelectedAnnouncement,
    messagePopVisible, setMessagePopVisible,
    selectedMessage, setSelectedMessage,
    recentInAppMessageRef,
    fetchRecentAnnouncements, markAnnouncementAsRead, fetchInAppMessages,
  } = useInAppNotifications();

  // ─── 聊天未读数 ────────────────────────────────────────────────────────────
  const { chatUnreadCount, setChatUnreadCount } = useChatUnread();

  // ─── 工作流实时刷新 ─────────────────────────────────────────────────────────
  useWorkflowRealtime();

  // ─── WebSocket ──────────────────────────────────────────────────────────────
  const { disconnectWs } = useLayoutWs({
    onLogout,
    clearLockPassword,
    fetchInAppMessages,
    setInAppMessages,
    setUnreadCount,
    setChatUnreadCount,
    recentInAppMessageRef,
    userTenantId: user.tenantId,
    viewingTenantId,
  });

  // 空闲时预热拼音词典（菜单/标签/命令面板搜索用），不占首屏关键路径
  useEffect(() => {
    if ('requestIdleCallback' in window) requestIdleCallback(() => { void ensurePinyin(); });
    else setTimeout(() => { void ensurePinyin(); }, 2000);
  }, []);

  const markMyMessageRead = useMarkMyInAppMessageRead();
  const markAsRead = (id: number) => {
    markMyMessageRead.mutate({ params: { id } }, {
      onSuccess: () => {
        setInAppMessages(updateMessageRead(id));
        setUnreadCount((c) => Math.max(0, c - 1));
      },
    });
  };

  const { currentSectionKeys, displayBreadcrumbs } = useBreadcrumbData(menuTree, location.pathname, preferences.breadcrumbShowHome);
  const { openKeys, setOpenKeys } = useSidebarOpenKeys(currentSectionKeys, preferences.sidebarAccordion);

  // ─── 锁屏快捷键 Alt+L / 侧边栏 toggle Alt+S ────────────────────────────────
  useLayoutShortcuts({
    enableShortcuts: preferences.enableShortcuts,
    enableLockScreen: preferences.enableLockScreen,
    hasPassword,
    lock,
    collapsed,
    handleCollapseChange,
    isContentFullscreen,
    setIsContentFullscreen,
  });

  const navItems = useNavItems(menuTree, chatUnreadCount);

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

  const { resolveTitle, resolveIcon } = useMenuMaps(menuTree);

  // ─── Nav layout helpers ────────────────────────────────────────────────────
  const navLayout: NavLayout = preferences.navLayout ?? 'vertical';

  const autoTopKey = useAutoTopKey(navLayout, navItems, location.pathname, setManualTopKey);

  // 进入消息中心页面时重置聊天未读数
  useEffect(() => {
    if (location.pathname.startsWith('/chat')) {
      setChatUnreadCount(0);
    }
  }, [location.pathname, setChatUnreadCount]);

  const effectiveTopKey = manualTopKey ?? autoTopKey;

  const { mixedTopNavItems, mixedSidebarItems, doubleSubItems } = useMixedNavItems(navLayout, navItems, effectiveTopKey);

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
      // 整页路由（非菜单页面）可通过导航 state 携带标题/图标，避免标签页闪现原始路径；
      // 优先级：导航 state > 页面 setTabMeta 暂存 > resolveTitle 兜底
      const navState = location.state as { tabTitle?: string; tabIcon?: string } | null;
      addTab(location.pathname, navState?.tabTitle, navState?.tabIcon, resolveTitle(location.pathname));
      // addTab 对已存在的页签只激活不改标题；带 state 再次进入时刷新标题/图标
      if (navState?.tabTitle || navState?.tabIcon) {
        setTabMeta(location.pathname, { title: navState.tabTitle, icon: navState.tabIcon });
      }
    }
  }, [location.pathname, location.state, preferences.enableTabs, resolveTitle, addTab, setTabMeta]);

  const tabsMetaValue = useMemo(
    () => ({ enabled: !!preferences.enableTabs, setTabMeta, closeTab: removeTab }),
    [preferences.enableTabs, setTabMeta, removeTab],
  );

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

  const handleTabChange = useEventCallback((key: string) => {
    setActiveKey(key);
    navigate(key);
  });

  const handleTabClose = useEventCallback((key: string) => {
    if (preferences.tabAnimation === 'none') {
      doRemoveTab(key);
      return;
    }
    setExitingTabKeys((s) => new Set([...s, key]));
    setTimeout(() => {
      setExitingTabKeys((s) => { const n = new Set(s); n.delete(key); return n; });
      doRemoveTab(key);
    }, 280);
  });

  const handleTabRefresh = useEventCallback((key: string) => {
    if (location.pathname !== key) {
      navigate(key);
    }
    setTabRefreshVersion((prev) => ({
      ...prev,
      [key]: (prev[key] ?? 0) + 1,
    }));
  });

  // ─── 页签操作 ──────────────────────────────────────────────────────────────
  const handleTabDoubleClick = useEventCallback((tab: TabItem) => {
    const action = preferences.tabDoubleClickAction ?? 'refresh';
    if (action === 'refresh') handleTabRefresh(tab.key);
    else if (action === 'close' && tab.closable) handleTabClose(tab.key);
  });

  const handleTabPinToggle = useEventCallback((tab: TabItem) => {
    if (tab.pinned) unpinTab(tab.key);
    else pinTab(tab.key);
  });

  const handleToggleContentFullscreen = useEventCallback(() => {
    setIsContentFullscreen((v) => !v);
  });

  const toggleFavoriteById = useEventCallback((menuId: number) => {
    toggleFavorite(menuId);
  });

  const handleCopyTabName = useEventCallback((tab: TabItem) => {
    void copyText(tab.title);
  });

  const handleCopyTabLink = useEventCallback((tab: TabItem) => {
    void copyText(`${window.location.origin}${tab.key}`);
  });

  const handleCopyTabBreadcrumb = useEventCallback((tab: TabItem) => {
    const crumbs = findBreadcrumbs(menuTree, tab.key);
    const path = crumbs.length > 0 ? crumbs.map((c) => c.title).join(' / ') : tab.title;
    void copyText(path);
  });

  const handleOpenTabInNewWindow = useEventCallback((tab: TabItem) => {
    window.open(tab.key, '_blank');
  });

  const handleCloseOthers = useEventCallback((key: string) => {
    navigate(closeOthers(key));
  });

  const handleCloseLeft = useEventCallback((key: string) => {
    navigate(closeLeft(key));
  });

  const handleCloseRight = useEventCallback((key: string) => {
    navigate(closeRight(key));
  });

  const handleCloseAll = useEventCallback(() => {
    closeAll();
    navigate('/');
  });

  const handleDragLeave = useEventCallback(() => {
    setDragOverKey(null);
  });

  // 操作集合经 useEventCallback 全部稳定化，此 useMemo 因而只计算一次；
  // 这是 memo 化的 TabBarItem 能在 AdminLayout 无关重渲染时整体跳过的前提。
  const tabActions = useMemo<TabBarItemActions>(() => ({
    onSelect: handleTabChange,
    onClose: handleTabClose,
    onRefresh: handleTabRefresh,
    onDoubleClick: handleTabDoubleClick,
    onMiddleClick: (tab) => handleTabClose(tab.key),
    onPinToggle: handleTabPinToggle,
    onToggleFullscreen: handleToggleContentFullscreen,
    onToggleFavorite: toggleFavoriteById,
    onCopyName: handleCopyTabName,
    onCopyLink: handleCopyTabLink,
    onCopyBreadcrumb: handleCopyTabBreadcrumb,
    onOpenInNewWindow: handleOpenTabInNewWindow,
    onCloseOthers: handleCloseOthers,
    onCloseLeft: handleCloseLeft,
    onCloseRight: handleCloseRight,
    onCloseAll: handleCloseAll,
    onDragStart: handleDragStart,
    onDragOver: handleDragOver,
    onDrop: handleDrop,
    onDragEnd: handleDragEnd,
    onDragLeave: handleDragLeave,
  }), [
    handleTabChange, handleTabClose, handleTabRefresh, handleTabDoubleClick,
    handleTabPinToggle, handleToggleContentFullscreen, toggleFavoriteById,
    handleCopyTabName, handleCopyTabLink, handleCopyTabBreadcrumb, handleOpenTabInNewWindow,
    handleCloseOthers, handleCloseLeft, handleCloseRight, handleCloseAll,
    handleDragStart, handleDragOver, handleDrop, handleDragEnd, handleDragLeave,
  ]);

  const outletRefreshKey = `${location.pathname}:${tabRefreshVersion[location.pathname] ?? 0}`;

  // 页面缓存白名单：菜单开启 keepAlive 的路径（外链内嵌菜单取内部路由 /embed/{id}）
  const keepAlivePaths = useKeepAlivePaths(menuTree);
  const openTabPaths = useMemo(() => new Set(tabs.map((t) => t.key)), [tabs]);

  // 「关闭左侧/右侧/其他/全部」的可用性：一次 O(n) 前缀扫描得出，
  // 替代此前在 tabs.map 内部对每个页签重复 slice/some 的 O(n²) 写法。
  const tabClosableFlags = useMemo(() => computeTabClosableFlags(tabs), [tabs]);

  // 收藏态：仅在开启收藏功能时按 path 建索引，避免每个页签各做一次 flatMenus.find
  const showTabFavorites = preferences.showFavorites ?? false;
  const tabFavMenuIds = useMemo(() => {
    if (!showTabFavorites) return null;
    const byPath = new Map(flatMenus.map((m) => [m.path, m.id]));
    return tabs.map((t) => byPath.get(t.key) ?? null);
  }, [showTabFavorites, flatMenus, tabs]);
  const pageCacheEnabled = preferences.enableTabs && (preferences.enablePageCache ?? true) && keepAlivePaths.size > 0;

  // 页签悬浮提示：完整菜单路径（如「系统设置 / 运维管理 / 接口限流」）。
  // 动态参数路径（/workflow/designer/1）按最长前缀回退，未命中菜单时退回页签标题。
  const tabHoverTitles = useMemo(() => {
    const entries = flatMenus.map((m) => ({
      path: m.path,
      label: m.breadcrumb.length > 0 ? `${m.breadcrumb.join(' / ')} / ${m.title}` : m.title,
    }));
    const byPath = new Map(entries.map((m) => [m.path, m.label]));
    return tabs.map((t) => {
      const exact = byPath.get(t.key);
      if (exact) return exact;
      let best: string | undefined;
      let bestLength = -1;
      for (const m of entries) {
        if (m.path.length > bestLength && t.key.startsWith(`${m.path}/`)) {
          best = m.label;
          bestLength = m.path.length;
        }
      }
      return best ?? t.title;
    });
  }, [flatMenus, tabs]);

  const recentMenus = recents
    .map((id) => flatMenus.find((m) => m.id === id))
    .filter((menu): menu is FlatMenuItem => Boolean(menu));

  // ─── Render wrappers ──────────────────────────────────────────────────────
  const { renderWrapper, renderMobileWrapper, handleDoubleRailClick, handleMixedTopSelect } = useNavInteractions({
    navItems,
    navigate,
    setMobileNavVisible,
    setManualTopKey,
  });

  const currentSelectedKeys = useMemo(
    () => (location.pathname === '/users' ? ['/system/users'] : [location.pathname]),
    [location.pathname],
  );

  const mobileQuickPagesPanel = (
    <MobileQuickPagesPanel
      tabs={tabs}
      activeKey={activeKey}
      resolveIcon={resolveIcon}
      recentMenus={recentMenus}
      setMobilePagesVisible={setMobilePagesVisible}
      handleTabChange={handleTabChange}
      handleTabClose={handleTabClose}
      clearRecents={clearRecents}
      removeRecent={removeRecent}
      navigate={navigate}
    />
  );

  // ─── Header actions (reused in both topbar and vertical header) ────────────
  const headerActions = (
    <div className="admin-header__actions">
      {(preferences.showMenuSearch ?? true) && <div className="admin-menu-search"><MenuSearchInput menus={flatMenus} recentMenus={recentMenus} onClearRecents={clearRecents} /></div>}
      {/* 收藏菜单快捷入口 */}
      {(preferences.showFavorites ?? false) && (
        <FavoritesPopover
          favorites={favorites}
          flatMenus={flatMenus}
          navigate={navigate}
          toggleFavorite={toggleFavorite}
        />
      )}
      {isPlatformAdmin && tenantList.length > 0 && (
        <TenantSwitcher
          tenantList={tenantList}
          viewingTenantId={viewingTenantId}
          handleSwitchTenant={handleSwitchTenant}
        />
      )}
      <TaskTray />
      <AnnouncementPopover
        announcementPopVisible={announcementPopVisible}
        setAnnouncementPopVisible={setAnnouncementPopVisible}
        fetchRecentAnnouncements={fetchRecentAnnouncements}
        recentAnnouncements={recentAnnouncements}
        markAnnouncementAsRead={markAnnouncementAsRead}
        setSelectedAnnouncement={setSelectedAnnouncement}
        announcementUnreadCount={announcementUnreadCount}
        navigate={navigate}
      />
      <MessagePopover
        messagePopVisible={messagePopVisible}
        setMessagePopVisible={setMessagePopVisible}
        fetchInAppMessages={fetchInAppMessages}
        inAppMessages={inAppMessages}
        markAsRead={markAsRead}
        setSelectedMessage={setSelectedMessage}
        unreadCount={unreadCount}
        navigate={navigate}
      />
      <ThemeModeDropdown mode={mode} handleThemeModeChange={handleThemeModeChange} />
      {/* 移动端页面入口与常用功能入口分离 */}
      <PagesDropdown
        isMobileNav={isMobileNav}
        mobilePagesVisible={mobilePagesVisible}
        setMobilePagesVisible={setMobilePagesVisible}
        mobileQuickPagesPanel={mobileQuickPagesPanel}
      />
      <MoreDropdown
        navigate={navigate}
        announcementUnreadCount={announcementUnreadCount}
        unreadCount={unreadCount}
        mode={mode}
        handleThemeModeChange={handleThemeModeChange}
      />
      {(preferences.showFullscreen ?? true) && (
        <button className="admin-theme-btn admin-theme-btn--fullscreen" title={isFullscreen ? '退出全屏' : '全屏显示'} onClick={toggleFullscreen}>
          {isFullscreen ? <Shrink size={16} strokeWidth={1.5} /> : <Expand size={16} strokeWidth={1.5} />}
        </button>
      )}
      <Divider layout="vertical" margin="4px" style={{ height: 16, borderLeftColor: 'var(--color-border)' }} />
      <UserDropdown
        user={user}
        navigate={navigate}
        unreadCount={unreadCount}
        announcementUnreadCount={announcementUnreadCount}
        feedbackEntryEnabled={feedbackEntryEnabled}
        setFeedbackVisible={setFeedbackVisible}
        setPrefsVisible={setPrefsVisible}
        setShortcutsVisible={setShortcutsVisible}
        enableLockScreen={preferences.enableLockScreen}
        confirmLogout={preferences.confirmLogout}
        hasPassword={hasPassword}
        lock={lock}
        disconnectWs={disconnectWs}
        clearLockPassword={clearLockPassword}
        onLogout={onLogout}
      />
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
  // 水平布局：把当前路径的祖先目录 key 一并加入 selectedKeys，
  // 以便顶级目录（Semi Nav 的 sub-title）在子页面时也高亮（sub-title-selected 只看自身 itemKey）
  const horizontalSelectedKeys = (() => {
    const path = currentSelectedKeys[0];
    if (!path) return currentSelectedKeys;
    const ancestors = findNavItemAncestorKeys(navItems, path);
    return ancestors && ancestors.length ? [path, ...ancestors] : currentSelectedKeys;
  })();
  const topNavSelectedKeys = navLayout === 'mixed' ? mixedTopSelectedKeys : horizontalSelectedKeys;
  const stickyNavClass = preferences.sidebarStickyScroll === false ? '' : ' admin-sidebar--sticky-nav';
  const mobileHeaderTitle = currentPageTitle ?? displayBreadcrumbs.at(-1)?.title ?? config.appTitle;

  // 分区深色走 Semi 官方的局部暗色：区域根元素挂 .semi-always-dark，整套 --semi-color-* 由 Semi 提供
  const sidebarDark = Boolean(preferences.sidebarDarkMode);
  const headerDark = Boolean(preferences.headerDarkMode);
  const alwaysDarkClass = ' semi-always-dark';
  const sidebarClassName = `admin-sidebar${effectiveCollapsed ? ' admin-sidebar--collapsed' : ''}${stickyNavClass}${sidebarDark ? alwaysDarkClass : ''}`;

  useScrollMenuIntoView(currentSelectedKeys, effectiveCollapsed, preferences.scrollMenuIntoView, reduceMotion);
  const layoutClassName = [
    'admin-layout',
    sidebarDark ? 'admin-layout--sidebar-dark' : '',
    headerDark ? 'admin-layout--header-dark' : '',
    isContentFullscreen ? 'admin-layout--content-fullscreen' : '',
    preferences.grayscale ? 'admin-layout--grayscale' : '',
    preferences.colorBlind ? 'admin-layout--color-blind' : '',
    reduceMotion ? 'admin-layout--reduce-motion' : '',
    (preferences.contentWidth ?? 'fluid') === 'fixed' ? 'admin-layout--content-fixed' : '',
    preferences.darkSidebarTone === 'bg-0' ? 'admin-layout--dark-sidebar-deep' : '',
    preferences.darkHeaderTone === 'bg-0' ? 'admin-layout--dark-header-deep' : '',
    preferences.darkContentTone === 'bg-0' ? 'admin-layout--dark-content-deep' : '',
  ].filter(Boolean).join(' ');
  // .semi-always-dark 会把 --semi-color-primary 复位成 Semi 默认蓝，品牌主色需按深色档重新注入
  const sectionDarkVars = useMemo((): Record<string, string> => {
    if (!sidebarDark && !headerDark) return {};
    const vars = getThemeColorVars(themeColor, true);
    return {
      '--admin-section-dark-primary': vars.primary,
      '--admin-section-dark-primary-hover': vars.hover,
      '--admin-section-dark-primary-active': vars.active,
      '--admin-section-dark-primary-light-default': vars.lightDefault,
      '--admin-section-dark-primary-light-hover': vars.lightHover,
      '--admin-section-dark-primary-light-active': vars.lightActive,
      '--admin-section-dark-sidebar-active': vars.sidebarActive,
    };
  }, [headerDark, sidebarDark, themeColor]);
  // 导航类弹层（折叠飞出菜单、折叠项 Tooltip、顶部子菜单与溢出菜单）跟随分区深色；
  // 头部功能面板（消息、公告、用户菜单等）不接入，保持全局配色
  const getSidebarPopupContainer = useSectionDarkPopupContainer(sidebarDark, sectionDarkVars);
  const getHeaderPopupContainer = useSectionDarkPopupContainer(headerDark, sectionDarkVars);

  const adminLayoutEl = (
    <div
      className={layoutClassName}
      style={{
        ...(sectionDarkVars as CSSProperties),
        ...(preferences.sidebarWidth && preferences.sidebarWidth !== 216
          ? { '--sidebar-width': `${preferences.sidebarWidth}px` } as CSSProperties
          : {}),
      }}
    >
      {/* 维护模式横幅（仅超级管理员可见） */}
      {isSuperAdmin && maintenanceBannerEnabled && (
        <MaintenanceBanner
          maintenanceBannerMsg={maintenanceBannerMsg}
          disablingMaintenance={disablingMaintenance}
          handleDisableMaintenance={handleDisableMaintenance}
        />
      )}
      {isMobileNav && (
        <MobileHeader
          setMobileNavVisible={setMobileNavVisible}
          navigateHome={navigateHome}
          handleNavigateHomeKey={handleNavigateHomeKey}
          mobileHeaderTitle={mobileHeaderTitle}
          headerActions={headerActions}
        />
      )}

      {isMobileNav && (
        <MobileNavSheet
          mobileNavVisible={mobileNavVisible}
          setMobileNavVisible={setMobileNavVisible}
          navigateHome={navigateHome}
          handleNavigateHomeKey={handleNavigateHomeKey}
          navItems={navItems}
          currentSelectedKeys={currentSelectedKeys}
          openKeys={openKeys}
          handleSidebarOpenChange={handleSidebarOpenChange}
          renderMobileWrapper={renderMobileWrapper}
          showMenuSearch={preferences.showMenuSearch ?? true}
          toggleIconPosition={preferences.sidebarToggleIconPosition ?? 'right'}
        />
      )}

      {/* Top bar for horizontal and mixed layouts */}
      {!isMobileNav && navLayout !== 'vertical' && navLayout !== 'double' && (
        <TopBar
          showLogo={preferences.showLogo ?? true}
          navigateHome={navigateHome}
          handleNavigateHomeKey={handleNavigateHomeKey}
          navLayout={navLayout}
          mixedTopNavItems={mixedTopNavItems}
          navItems={navItems}
          topNavSelectedKeys={topNavSelectedKeys}
          renderWrapper={renderWrapper}
          handleMixedTopSelect={handleMixedTopSelect}
          headerActions={headerActions}
          darkClassName={headerDark ? ' semi-always-dark' : ''}
          getPopupContainer={getHeaderPopupContainer}
        />
      )}

      <div className="admin-body">

{/* Sidebar — always in vertical, conditional in mixed, always in double */}
        {!isMobileNav && showSidebar && (
          navLayout === 'double' ? (
            <DoubleSidebar
              doubleSubItems={doubleSubItems}
              stickyNavClass={stickyNavClass}
              showLogo={preferences.showLogo ?? true}
              navigateHome={navigateHome}
              handleNavigateHomeKey={handleNavigateHomeKey}
              navItems={navItems}
              effectiveTopKey={effectiveTopKey}
              handleDoubleRailClick={handleDoubleRailClick}
              currentSelectedKeys={currentSelectedKeys}
              openKeys={openKeys}
              handleSidebarOpenChange={handleSidebarOpenChange}
              renderWrapper={renderWrapper}
              darkClassName={sidebarDark ? ' semi-always-dark' : ''}
              getPopupContainer={getSidebarPopupContainer}
              toggleIconPosition={preferences.sidebarToggleIconPosition ?? 'right'}
            />
          ) : (
            <SidebarNav
              sidebarClassName={sidebarClassName}
              onMouseEnter={() => { if (preferences.sidebarHoverTrigger && collapsed) setSidebarHovered(true); }}
              onMouseLeave={() => { if (preferences.sidebarHoverTrigger) setSidebarHovered(false); }}
              items={navLayout === 'mixed' ? mixedSidebarItems : navItems}
              effectiveCollapsed={effectiveCollapsed}
              currentSelectedKeys={currentSelectedKeys}
              openKeys={openKeys}
              handleSidebarOpenChange={handleSidebarOpenChange}
              handleCollapseChange={handleCollapseChange}
              showBrand={navLayout === 'vertical' && (preferences.showLogo ?? true)}
              navigateHome={navigateHome}
              handleNavigateHomeKey={handleNavigateHomeKey}
              renderWrapper={renderWrapper}
              getPopupContainer={getSidebarPopupContainer}
              toggleIconPosition={preferences.sidebarToggleIconPosition ?? 'right'}
            />
          )
        )}


        {/* Main area */}
        <div className="admin-main">
          {(preferences.showProgressBar ?? true) && <NProgress />}
          {/* Vertical mode has its own header bar */}
          {!isMobileNav && (navLayout === 'vertical' || navLayout === 'double') && (
            <header className={`admin-header${headerDark ? ' semi-always-dark' : ''}`}>
              {/* Left: breadcrumb (vertical / double layouts only) */}
              {preferences.showBreadcrumb && displayBreadcrumbs.length > 0 ? (
                <HeaderBreadcrumb
                  displayBreadcrumbs={displayBreadcrumbs}
                  breadcrumbIcon={preferences.breadcrumbIcon}
                  breadcrumbSubMenu={preferences.breadcrumbSubMenu}
                  breadcrumbClickable={preferences.breadcrumbClickable}
                  showFavorites={preferences.showFavorites}
                  navigateHome={navigateHome}
                  navigate={navigate}
                  pathname={location.pathname}
                  flatMenus={flatMenus}
                  isFavorite={isFavorite}
                  toggleFavorite={toggleFavorite}
                />
              ) : (
                <div />
              )}
              {headerActions}
            </header>
          )}
          {/* Tabs bar — shown above breadcrumb for all layouts */}
          {preferences.enableTabs && tabs.length > 0 && (
            <div ref={tabsBarRef} className={`admin-tabs-bar${preferences.showBreadcrumb ? ' admin-tabs-bar--with-breadcrumb' : ''}`} data-tab-animation={reduceMotion ? 'none' : preferences.tabAnimation} data-tab-style={preferences.tabStyle ?? 'line'}>
              <div ref={tabsScrollRef} className="admin-tabs-bar__scroll">
              {tabs.map((tab, tabIndex) => {
                  const favMenuId = tabFavMenuIds?.[tabIndex] ?? null;
                  return (
                    <TabBarItem
                      key={tab.key}
                      tab={tab}
                      actions={tabActions}
                      isActive={tab.key === activeKey}
                      isEntering={enteringTabKeys.has(tab.key)}
                      isExiting={exitingTabKeys.has(tab.key)}
                      isDragging={dragSrcKey.current === tab.key}
                      isDragOver={dragOverKey === tab.key}
                      hasClosableLeft={tabClosableFlags[tabIndex].hasClosableLeft}
                      hasClosableRight={tabClosableFlags[tabIndex].hasClosableRight}
                      hasClosableOthers={tabClosableFlags[tabIndex].hasClosableOthers}
                      hasAnyClosable={tabClosableFlags[tabIndex].hasAnyClosable}
                      favMenuId={favMenuId}
                      faved={favMenuId !== null && isFavorite(favMenuId)}
                      showIcon={!!preferences.showTabIcon}
                      iconName={tab.icon ?? resolveIcon(tab.key)}
                      hoverTitle={tabHoverTitles[tabIndex]}
                      isContentFullscreen={isContentFullscreen}
                      innerRef={tab.key === activeKey ? activeTabRef : undefined}
                    />
                  );
              })}
              </div>
              {(preferences.showTabSwitcher ?? true) && (
              <TabSwitcher
                tabs={tabs}
                activeKey={activeKey}
                resolveIcon={resolveIcon}
                onNavigate={(key) => { setActiveKey(key); navigate(key); }}
                onClose={(key) => handleTabClose(key)}
              />
              )}
            </div>
          )}
          <div className="admin-content" style={{ overflow: 'auto', position: 'relative' }}>
            <RouteErrorBoundary>
              <TabsMetaContext.Provider value={tabsMetaValue}>
                {pageCacheEnabled ? (
                  <KeepAliveOutlet
                    keepAlivePaths={keepAlivePaths}
                    openPaths={openTabPaths}
                    refreshVersion={tabRefreshVersion}
                    animationClass={!reduceMotion && preferences.routeAnimation && preferences.routeAnimation !== 'none'
                      ? `route-anim--${preferences.routeAnimation}`
                      : undefined}
                  />
                ) : (
                  <div
                    key={outletRefreshKey}
                    style={{ height: '100%' }}
                    className={!reduceMotion && preferences.routeAnimation && preferences.routeAnimation !== 'none'
                      ? `route-anim--${preferences.routeAnimation}`
                      : undefined}
                  >
                    <Outlet key={outletRefreshKey} />
                  </div>
                )}
              </TabsMetaContext.Provider>
            </RouteErrorBoundary>
            {(preferences.showBackTop ?? true) && (
              <BackTop
                target={() => (document.querySelector('.admin-content') as HTMLElement) ?? document.body}
                style={{ right: 24, bottom: 24 }}
              />
            )}
          </div>

          {/* Preferences SideSheet */}
          <SideSheet
            title="偏好设置"
            visible={prefsVisible}
            onCancel={() => { setPrefsVisible(false); setPrefsSearch(''); }}
            width={380}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 24 }}>
              <KeywordInput placeholder="搜索设置项…" value={prefsSearch} onChange={(v) => setPrefsSearch(v)} />

              <PrefsLayoutSection
                prefSection={prefSection}
                matchesPref={matchesPref}
                preferences={preferences}
                setPreferences={setPreferences}
                navLayout={navLayout}
              />

              <PrefsAppearanceSection
                prefSection={prefSection}
                matchesPref={matchesPref}
                preferences={preferences}
                setPreferences={setPreferences}
                mode={mode}
                handleThemeModeChange={handleThemeModeChange}
                isDark={isDark}
                themeColor={themeColor}
                setThemeColor={setThemeColor}
              />

              <PrefsNavToolbarSection
                prefSection={prefSection}
                matchesPref={matchesPref}
                preferences={preferences}
                setPreferences={setPreferences}
                prefsSearch={prefsSearch}
                quickChatEnabled={quickChatEnabled}
              />

              <PrefsSidebarSection
                prefSection={prefSection}
                matchesPref={matchesPref}
                preferences={preferences}
                setPreferences={setPreferences}
                navLayout={navLayout}
              />

              <PrefsGeneralSection
                prefSection={prefSection}
                matchesPref={matchesPref}
                preferences={preferences}
                setPreferences={setPreferences}
                homePathOptions={homePathOptions}
                autoLockMinutes={autoLockMinutes}
                hasPassword={hasPassword}
                clearLockPassword={clearLockPassword}
                openLockPasswordModal={(m) => {
                  setLockPasswordModalMode(m);
                  setNewLockPassword('');
                  setConfirmLockPassword('');
                  setLockPasswordModalVisible(true);
                }}
              />

              <PrefsTableSection
                prefSection={prefSection}
                matchesPref={matchesPref}
                preferences={preferences}
                setPreferences={setPreferences}
              />

              <PrefsTabsSection
                prefSection={prefSection}
                matchesPref={matchesPref}
                preferences={preferences}
                setPreferences={setPreferences}
                prefsSearch={prefsSearch}
              />

              {/* ── 复制 / 导入 / 重置 ── */}
              <PrefsActionsSection
                handleCopyPreferences={handleCopyPreferences}
                onOpenImport={() => setImportPrefsVisible(true)}
                resetPreferences={resetPreferences}
              />

            </div>
          </SideSheet>

          {/* ─── 快捷键 Modal ─── */}
          <ShortcutsModal shortcutsVisible={shortcutsVisible} setShortcutsVisible={setShortcutsVisible} />

          {/* ─── 导入偏好 Modal ─── */}
          <ImportPreferencesModal
            importPrefsVisible={importPrefsVisible}
            setImportPrefsVisible={setImportPrefsVisible}
            importPrefsText={importPrefsText}
            setImportPrefsText={setImportPrefsText}
            handleImportPreferences={handleImportPreferences}
          />

          {/* ─── 锁屏密码设置 Modal ─── */}
          <LockPasswordModal
            lockPasswordModalMode={lockPasswordModalMode}
            lockPasswordModalVisible={lockPasswordModalVisible}
            setLockPasswordModalVisible={setLockPasswordModalVisible}
            newLockPassword={newLockPassword}
            setNewLockPassword={setNewLockPassword}
            confirmLockPassword={confirmLockPassword}
            setConfirmLockPassword={setConfirmLockPassword}
            setLockPassword={setLockPassword}
            setPreferences={setPreferences}
          />
        </div>
      </div>

      {/* ===== 锁屏遮罩 ===== */}
      {isLocked && (
        <Suspense fallback={null}>
          <LockScreen
            user={user}
            onVerify={verifyLockPassword}
            onUnlocked={doUnlock}
            onReLogin={() => { clearLockPassword(); disconnectWs(); onLogout(); }}
          />
        </Suspense>
      )}

      {/* ===== 快捷聊天浮动按钮 ===== */}
      {quickChatEnabled && (preferences.showQuickChat ?? true) && (
        <Suspense fallback={null}>
          <QuickChatButton onHide={() => setPreferences({ showQuickChat: false })} />
        </Suspense>
      )}

      {/* ===== 意见反馈弹层 ===== */}
      {feedbackEntryEnabled && (
        <FeedbackWidget visible={feedbackVisible} onClose={() => setFeedbackVisible(false)} />
      )}

      {/* ===== 音视频通话全局宿主 ===== */}
      <Suspense fallback={null}>
        <CallOverlayHost />
      </Suspense>

      {/* ===== 全局聊天通知（桌面通知 + 提示音）===== */}
      <Suspense fallback={null}>
        <ChatNotifierHost userId={user.id} />
      </Suspense>

      {/* ===== 消息详情 Modal ===== */}
      <MessageDetailModal selectedMessage={selectedMessage} setSelectedMessage={setSelectedMessage} />

      {/* ===== 公告详情 Modal ===== */}
      {selectedAnnouncement !== null && (
        <Suspense fallback={null}>
          <AnnouncementDetailModal
            announcement={selectedAnnouncement}
            visible
            onClose={() => setSelectedAnnouncement(null)}
          />
        </Suspense>
      )}
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
      isDark={isDark}
    >
      {adminLayoutEl}
    </Watermark>
  );
}
