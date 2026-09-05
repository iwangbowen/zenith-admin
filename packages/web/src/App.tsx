import React, { useState, useEffect, useCallback, Suspense, useMemo } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { PageErrorBoundary } from '@/components/PageErrorBoundary';
import FullPageRetry from '@/components/FullPageRetry';
import { useGlobalErrorHandler } from '@/hooks/useGlobalErrorHandler';
import { scheduleTrackerInit, trackerIdentify, trackerPrepareLogout, trackerResetIdentity } from '@/lib/tracker-boot';
import { prefetchAdminShell } from '@/lib/shell-prefetch';
import ElectronTitleBar from '@/components/ElectronTitleBar';
import { usePermission } from '@/hooks/usePermission';
import { PreferencesProvider } from '@/hooks/PreferencesProvider';
import { usePreferences } from '@/hooks/usePreferences';
import { hasPostLoginHome, clearPostLoginHome } from '@/lib/post-login';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { useQueryClient } from '@tanstack/react-query';
import MaintenanceOverlay from '@/components/MaintenanceOverlay';
import { maintenanceKeys, usePublicMaintenanceStatus } from '@/hooks/queries/maintenance';
import { lazyPageComponent } from '@/utils/page-registry';
import { useCurrentUserMenuTree, useMenuTree } from '@/hooks/queries/menus';
import type { Menu, User } from '@zenith/shared/identity';
import PageLoading from '@/components/PageLoading';

// AdminLayout 懒加载：后台布局静态依赖图很重（通知/文件预览/偏好面板/dnd-kit/DatePicker 等），
// 登录页与公开页（支付链接、公开报表、OAuth 授权）不应预载它
const AdminLayout = React.lazy(() => import('@/layouts/AdminLayout'));

// 登录页静态引入：未登录首屏只需关键路径本身，不再多一轮 chunk 下载；
// 它依赖的 Semi 表单控件登录后几乎每页都要用，放进入口闭包不产生额外代价
import LoginPage from '@/pages/login/LoginPage';
const ResetPasswordPage = React.lazy(() => import('@/pages/reset-password/ResetPasswordPage'));
const DashboardPage = React.lazy(() => import('@/pages/dashboard/DashboardPage'));
import DashboardSkeleton from '@/pages/dashboard/DashboardSkeleton';
const ProfilePage = React.lazy(() => import('@/pages/profile/ProfilePage'));
const AnnouncementsPage = React.lazy(() => import('@/pages/announcements/AnnouncementsPage'));
const InboxPage = React.lazy(() => import('@/pages/inbox/InboxPage'));
const NotFoundPage = React.lazy(() => import('@/pages/not-found/NotFoundPage'));
const ForbiddenPage = React.lazy(() => import('@/pages/forbidden/ForbiddenPage'));
const OAuthCallbackPage = React.lazy(() => import('@/pages/oauth/OAuthCallbackPage'));
const EnterpriseCallbackPage = React.lazy(() => import('@/pages/oauth/EnterpriseCallbackPage'));
const OAuth2AuthorizePage = React.lazy(() => import('@/pages/oauth2/OAuth2AuthorizePage'));
const EmbedPage = React.lazy(() => import('@/pages/embed/EmbedPage'));
const PaymentLinkPublicPage = React.lazy(() => import('@/pages/payment/PaymentLinkPublicPage'));
const PublicDashboardPage = React.lazy(() => import('@/pages/report/PublicDashboardPage'));
const PublicAiChatPage = React.lazy(() => import('@/pages/public-ai-chat/PublicAiChatPage'));
const PublicDriveSharePage = React.lazy(() => import('@/pages/drive/public/PublicSharePage'));
const WorkflowDesignerPage = React.lazy(() => import('@/pages/workflow/designer/WorkflowDesignerPage'));
const WorkflowLaunchPage = React.lazy(() => import('@/pages/workflow/launchpad/WorkflowLaunchPage'));
const WorkflowInstancePage = React.lazy(() => import('@/pages/workflow/instances/WorkflowInstancePage'));
const FirewallPage = React.lazy(() => import('@/pages/system/firewall/FirewallPage'));
const NginxSitesPage = React.lazy(() => import('@/pages/system/nginx-sites/NginxSitesPage'));
const DashboardDesignerPage = React.lazy(() => import('@/pages/report/designer/DashboardDesignerPage'));
const PrintDesignerPage = React.lazy(() => import('@/pages/report/designer/PrintDesignerPage'));
const DashboardViewPage = React.lazy(() => import('@/pages/report/DashboardViewPage'));
const FillEntryPage = React.lazy(() => import('@/pages/report/FillEntryPage'));
const OAuth2AppDetailPage = React.lazy(() => import('@/pages/open-platform/apps/OAuth2AppDetailPage'));

const routeFallback = <PageLoading inline />;

/** 固定路由路径，不通过菜单动态加载（导出供路由策略回归测试使用） */
export const FIXED_ROUTES = new Set(['/profile', '/announcements', '/inbox', '/system/firewall', '/system/nginx-sites']);

/**
 * 首页入口：登录后一次性应用「默认首页」偏好。
 * 仅当本次会话由登录落地首页（post-login 标记存在）且偏好 homePath 指向其他页面时跳转；
 * 用户日常手动访问 '/' 不受影响，始终进入首页仪表盘。
 */
function HomeEntry() {
  const { preferences, ready } = usePreferences();
  const [postLogin] = useState(hasPostLoginHome);
  // 偏好就绪后消费一次性标记（无论是否跳转）
  useEffect(() => {
    if (ready) clearPostLoginHome();
  }, [ready]);
  const homePath = (preferences.homePath ?? '/').trim();
  const safeTarget = homePath.startsWith('/') && !homePath.startsWith('//') && homePath !== '/' && !homePath.startsWith('/login');
  if (postLogin && !ready) {
    // 等待服务器偏好返回（毫秒级），避免跳转决策使用默认值
    return <DashboardSkeleton />;
  }
  if (postLogin && safeTarget) {
    return <Navigate to={homePath} replace />;
  }
  return <Suspense fallback={<DashboardSkeleton />}><DashboardPage /></Suspense>;
}

/** 未登录时保存来源路径并跳转登录 */
function RedirectToLogin() {
  const location = useLocation();
  const from = location.pathname + location.search;
  const loginUrl = from && from !== '/' ? `/login?redirect=${encodeURIComponent(from)}` : '/login';
  return <Navigate to={loginUrl} replace />;
}

/**
 * 已登录用户访问登录页时的重定向守卫。
 * 避免 /login 落入 AdminLayout 的 catch-all 404，从而作为标签页出现在多标签栏。
 * 若存在合法的 redirect 参数则跳转到目标页，否则回到首页。
 * 例外：?add_account=1 渲染登录页进入「添加账号」模式（保留当前登录，成功后切换为新账号）。
 */
function RedirectFromLogin() {
  const location = useLocation();
  const { login, verifyMfaLogin, register } = useAuth();
  const params = new URLSearchParams(location.search);
  if (params.get('add_account') === '1') {
    return <Suspense fallback={routeFallback}><LoginPage onLogin={login} onVerifyMfa={verifyMfaLogin} onRegister={register} /></Suspense>;
  }
  const redirect = params.get('redirect');
  const safe =
    !!redirect &&
    redirect.startsWith('/') &&
    !redirect.startsWith('//') &&
    !redirect.startsWith('/login');
  return <Navigate to={safe ? redirect! : '/'} replace />;
}

/**
 * Catch-all 路由守卫：区分 403（页面存在但无权限）和 404（页面不存在）。
 * 通过全量菜单树的 path → component 映射判断当前路径是否对应一个已存在的页面组件；
 * 若命中的页面用户本就有权限（路由已注册仍落入 catch-all），说明只是子路径不存在，按 404 处理。
 *
 * 全量菜单树（含全部按钮节点，数百 KB）只在真正落入 catch-all 时才请求：
 * 它不参与正常导航，不能作为首载 gate 让每个用户每次启动都下载一遍。
 */
function NotFoundOrForbidden({ userMenuPaths }: Readonly<{ userMenuPaths: Set<string> }>) {
  const location = useLocation();
  const path = location.pathname;
  const allMenusQuery = useMenuTree();
  const allMenuPaths = useMemo(() => buildAllMenuPaths(allMenusQuery.data ?? []), [allMenusQuery.data]);
  // 树未到达前不下结论：直接渲染 404 会对「有页面但无权限」的路径闪一下错误结论
  if (allMenusQuery.isPending) return <PageLoading />;

  // 精确匹配或前缀匹配（如 /system/users/123 匹配 /system/users）
  const segments = path.split('/').filter(Boolean);
  let matched = false;
  for (let i = segments.length; i > 0; i--) {
    const partialPath = '/' + segments.slice(0, i).join('/');
    if (allMenuPaths.has(partialPath)) {
      matched = !userMenuPaths.has(partialPath);
      break;
    }
  }

  // 固定路由也不属于 403
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  if (FIXED_ROUTES.has(normalizedPath) || normalizedPath === '/') {
    matched = false;
  }

return matched ? <ForbiddenPage /> : <NotFoundPage />;
}

/** 扁平化菜单以便注册路由 */
export function flattenMenus(menus: Menu[]): Menu[] {
  const routes: Menu[] = [];
  for (const m of menus) {
    if (m.path && m.component && !FIXED_ROUTES.has(m.path)) {
      routes.push(m);
    }
    if (m.children && m.children.length > 0) {
      routes.push(...flattenMenus(m.children));
    }
  }
  return routes;
}

/** 收集「外链 + 内嵌」菜单，注册为 /embed/{id} 内部路由 */
function flattenEmbedMenus(menus: Menu[]): Menu[] {
  const result: Menu[] = [];
  for (const m of menus) {
    if (m.isExternal && m.embed && m.path) {
      result.push(m);
    }
    if (m.children?.length) {
      result.push(...flattenEmbedMenus(m.children));
    }
  }
  return result;
}

/**
 * 从所有菜单中提取「path → component」映射，用于判断某个路径是否对应一个已存在的页面组件。
 * 这样可以在 catch-all 路由中区分 403（页面存在但无权限）和 404（页面不存在）。
 */
export function buildAllMenuPaths(menus: Menu[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of menus) {
    if (m.path && m.component && !FIXED_ROUTES.has(m.path)) {
      map.set(m.path, m.component);
    }
    if (m.children?.length) {
      const childPaths = buildAllMenuPaths(m.children);
      childPaths.forEach((v, k) => map.set(k, v));
    }
  }
  return map;
}

interface AdminRouteLoaderProps {
  user: Omit<User, 'password'>;
  logout: () => void;
}

const EMPTY_MENUS: Menu[] = [];

function AdminRouteLoader({ user, logout }: Readonly<AdminRouteLoaderProps>) {
  const { permissions } = usePermission();
  const userMenusQuery = useCurrentUserMenuTree();

  const menus = userMenusQuery.data ?? EMPTY_MENUS;
  const dynamicRoutes = useMemo(() => flattenMenus(menus), [menus]);
  const userMenuPaths = useMemo(() => new Set(dynamicRoutes.map((m) => m.path!)), [dynamicRoutes]);
  const embedRoutes = useMemo(() => flattenEmbedMenus(menus), [menus]);

  // 首载 gate 只等用户可见菜单树（有凭证时已在应用挂载期与 /me 并行预取）；后台 refetch 保留旧数据，不会重新进入此分支
  if (userMenusQuery.isPending) {
    return <PageLoading />;
  }
  // 导航树失败必须显式可重试——空菜单渲染会把故障伪装成「全部页面 404」。
  if (userMenusQuery.isError) {
    return (
      <FullPageRetry
        title="导航菜单加载失败"
        description="网络异常或服务暂不可用，请稍后重试。"
        offlineDescription="设备当前处于离线状态，恢复网络后会自动重新加载菜单。"
        error={userMenusQuery.error}
        retrying={userMenusQuery.isFetching}
        onRetry={() => void userMenusQuery.refetch()}
        secondaryAction={{ label: '退出登录', onClick: logout }}
      />
    );
  }

  return (
    <Routes>
        <Route path="/public/payment/link/:token" element={<Suspense fallback={routeFallback}><PaymentLinkPublicPage /></Suspense>} />
        <Route path="/public/report/:token" element={<Suspense fallback={routeFallback}><PublicDashboardPage /></Suspense>} />
        <Route path="/public/ai-chat/:token" element={<Suspense fallback={routeFallback}><PublicAiChatPage /></Suspense>} />
        <Route path="/public/drive/:token" element={<Suspense fallback={routeFallback}><PublicDriveSharePage /></Suspense>} />
        {/* OAuth2 同意授权页（独立页面，不在 AdminLayout 内）*/}
        <Route path="/oauth2/authorize" element={<Suspense fallback={routeFallback}><OAuth2AuthorizePage /></Suspense>} />
        <Route path="/enterprise/callback" element={<Suspense fallback={routeFallback}><EnterpriseCallbackPage /></Suspense>} />
        {/* 已登录用户从个人中心发起「绑定第三方账号」后回到这里，由同一回调页走 bind 分支 */}
        <Route path="/oauth/callback/:provider" element={<Suspense fallback={routeFallback}><OAuthCallbackPage /></Suspense>} />
        {/* 已登录用户访问认证页 → 重定向，避免落入 AdminLayout catch-all 404 并作为标签页出现 */}
        <Route path="/login" element={<RedirectFromLogin />} />
        <Route path="/reset-password" element={<Navigate to="/" replace />} />
        <Route path="/" element={<Suspense fallback={<PageLoading />}><AdminLayout user={user} onLogout={logout} menus={menus} /></Suspense>}>
        {/* 固定路由 */}
        <Route index element={<HomeEntry />} />
        <Route path="profile" element={<Suspense fallback={routeFallback}><ProfilePage user={user} /></Suspense>} />
        <Route path="announcements" element={<Suspense fallback={routeFallback}><AnnouncementsPage /></Suspense>} />
        <Route path="inbox" element={<Suspense fallback={routeFallback}><InboxPage /></Suspense>} />
        <Route path="workflow/designer/:id" element={<Suspense fallback={routeFallback}><WorkflowDesignerPage /></Suspense>} />
        <Route path="workflow/launch/:definitionId" element={<Suspense fallback={routeFallback}><WorkflowLaunchPage /></Suspense>} />
        <Route path="workflow/instance/:id" element={<Suspense fallback={routeFallback}><WorkflowInstancePage /></Suspense>} />
        <Route path="report/dashboards/:id/design" element={<Suspense fallback={routeFallback}><DashboardDesignerPage /></Suspense>} />
        <Route path="report/print/:id/design" element={<Suspense fallback={routeFallback}><PrintDesignerPage /></Suspense>} />
        <Route path="report/dashboards/:id/view" element={<Suspense fallback={routeFallback}><DashboardViewPage /></Suspense>} />
        <Route
          path="report/fill/:code"
          element={permissions.includes('*') || permissions.includes('report:fill:record:create') || permissions.includes('report:fill:record:update')
            ? <Suspense fallback={routeFallback}><FillEntryPage /></Suspense>
            : <Suspense fallback={routeFallback}><ForbiddenPage /></Suspense>}
        />
        <Route path="system/firewall" element={permissions.includes('*') || permissions.includes('system:firewall:view') ? <Suspense fallback={routeFallback}><FirewallPage /></Suspense> : <Suspense fallback={routeFallback}><ForbiddenPage /></Suspense>} />
        <Route path="system/nginx-sites" element={permissions.includes('*') || permissions.includes('system:nginx:view') ? <Suspense fallback={routeFallback}><NginxSitesPage /></Suspense> : <Suspense fallback={routeFallback}><ForbiddenPage /></Suspense>} />
        <Route path="system/oauth2-apps/:id" element={permissions.includes('*') || permissions.includes('system:oauth2-apps:view') ? <Suspense fallback={routeFallback}><OAuth2AppDetailPage /></Suspense> : <Suspense fallback={routeFallback}><ForbiddenPage /></Suspense>} />
        <Route path="users" element={<Navigate to="/system/users" replace />} />
        <Route path="forbidden" element={<Suspense fallback={routeFallback}><ForbiddenPage /></Suspense>} />

        {/* 动态路由 */}
        {dynamicRoutes.map(m => {
          const Component = lazyPageComponent(m.component);

          if (!Component) {
            console.warn(`[Router] Component not found for path: ${m.path} -> ${m.component}`);
            return null;
          }

          // 为了适配嵌套 path（去掉前面的 /）
          const routePath = m.path!.startsWith('/') ? m.path!.slice(1) : m.path!;

          return (
            <Route
              key={m.id}
              path={routePath}
              element={
                <Suspense fallback={routeFallback}>
                  <Component />
                </Suspense>
              }
            />
          );
        })}

        {/* 外链内嵌路由：iframe 打开外部页面 */}
        {embedRoutes.map((m) => (
          <Route
            key={`embed-${m.id}`}
            path={`embed/${m.id}`}
            element={<Suspense fallback={routeFallback}><EmbedPage src={m.path!} title={m.title} /></Suspense>}
          />
        ))}

        <Route path="*" element={<Suspense fallback={routeFallback}><NotFoundOrForbidden userMenuPaths={userMenuPaths} /></Suspense>} />
      </Route>
      <Route path="*" element={<Suspense fallback={routeFallback}><NotFoundOrForbidden userMenuPaths={userMenuPaths} /></Suspense>} />
    </Routes>
  );
}

/**
 * 分流前的应用外壳
 *
 * checking / unavailable 分支在 Router 之前就 return，若不带上 ThemeProvider，
 * body[theme-mode] 永远不会被设置——深色用户会先吃一屏纯白；
 * Electron 下还会缺掉自定义标题栏，窗口无法拖动与关闭。
 */
function AppChrome({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ThemeProvider>
      <div className="app-chrome">
        <ElectronTitleBar />
        {children}
      </div>
    </ThemeProvider>
  );
}

export default function App() {
  useGlobalErrorHandler();
  const queryClient = useQueryClient();
  const { user, status, refreshing, error, login, verifyMfaLogin, register, logout, refresh } = useAuth();
  const handleLogout = useCallback(() => {
    trackerPrepareLogout();
    logout();
  }, [logout]);

  const isSuperAdmin = user?.roles?.some((r) => r.code === 'super_admin') ?? false;

  // 埋点 SDK 延后到空闲时初始化；有本地凭证时同时投机预取后台壳的 chunk 与图标表
  useEffect(() => {
    prefetchAdminShell(queryClient);
    scheduleTrackerInit();
  }, [queryClient]);
  // 登录身份合并（匿名 → 登录），退出时重置
  useEffect(() => {
    if (user?.id) trackerIdentify(user.id, user.username);
    else trackerResetIdentity();
  }, [user?.id, user?.username]);

  // 维护状态收敛为单一查询（与超管横幅、维护遮罩共用缓存），
  // 不再各自裸取 + 用本地 state 保存。auth 未就绪前不发起。
  const { data: maintenance } = usePublicMaintenanceStatus({ enabled: status !== 'checking' });
  const showMaintenance = !!maintenance?.enabled && !isSuperAdmin;

  // http-client 在 React 树之外拦截 503，只能靠事件通知；事件仅作失效触发器，
  // 真实状态始终以服务端返回为准。
  useEffect(() => {
    const handler = () => void queryClient.invalidateQueries({ queryKey: maintenanceKeys.publicStatus });
    globalThis.addEventListener('maintenance:enabled', handler);
    return () => globalThis.removeEventListener('maintenance:enabled', handler);
  }, [queryClient]);

  if (status === 'checking') {
    return <AppChrome><PageLoading /></AppChrome>;
  }
  if (status === 'unavailable') {
    return (
      <AppChrome>
        <FullPageRetry
          title="暂时无法连接服务器"
          description="登录凭证已保留，请检查网络后重试。"
          offlineDescription="设备当前处于离线状态，登录凭证已保留，恢复网络后会自动重试。"
          error={error}
          retrying={refreshing}
          onRetry={() => void refresh()}
          secondaryAction={{ label: '重新登录', onClick: handleLogout }}
        />
      </AppChrome>
    );
  }

  // Electron file:// 协议不支持 BrowserRouter，需使用 HashRouter
  const RouterComponent = import.meta.env.VITE_ELECTRON === 'true' ? HashRouter : BrowserRouter;
  return (
    <>
    <PageErrorBoundary>
    {showMaintenance && maintenance && (
      <MaintenanceOverlay info={maintenance} />
    )}
    {/* Electron 自定义标题栏（登录页和内容页共用） */}
    <ElectronTitleBar />
    <RouterComponent basename={import.meta.env.VITE_ELECTRON === 'true' ? undefined : (import.meta.env.BASE_URL.replace(/\/$/, '') || '/')}>
      {user ? (
        <PreferencesProvider>
          <ThemeProvider>
            <AdminRouteLoader user={user} logout={handleLogout} />
          </ThemeProvider>
        </PreferencesProvider>
      ) : (
        <ThemeProvider>
          <PageErrorBoundary>
            <Routes>
              <Route path="/login" element={<Suspense fallback={routeFallback}><LoginPage onLogin={login} onVerifyMfa={verifyMfaLogin} onRegister={register} /></Suspense>} />
              <Route path="/reset-password" element={<Suspense fallback={routeFallback}><ResetPasswordPage /></Suspense>} />
              <Route path="/oauth/callback/:provider" element={<Suspense fallback={routeFallback}><OAuthCallbackPage /></Suspense>} />
              <Route path="/enterprise/callback" element={<Suspense fallback={routeFallback}><EnterpriseCallbackPage /></Suspense>} />
              <Route path="/oauth2/authorize" element={<Suspense fallback={routeFallback}><OAuth2AuthorizePage /></Suspense>} />
              <Route path="/public/payment/link/:token" element={<Suspense fallback={routeFallback}><PaymentLinkPublicPage /></Suspense>} />
              <Route path="/public/report/:token" element={<Suspense fallback={routeFallback}><PublicDashboardPage /></Suspense>} />
              <Route path="/public/ai-chat/:token" element={<Suspense fallback={routeFallback}><PublicAiChatPage /></Suspense>} />
              <Route path="/public/drive/:token" element={<Suspense fallback={routeFallback}><PublicDriveSharePage /></Suspense>} />
              <Route path="*" element={<RedirectToLogin />} />
            </Routes>
          </PageErrorBoundary>
        </ThemeProvider>
      )}
    </RouterComponent>
    </PageErrorBoundary>
    </>
  );
}
