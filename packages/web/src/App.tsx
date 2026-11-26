import React, { useState, useEffect, useCallback, Suspense, useMemo, useRef } from 'react';
import { Button } from '@douyinfe/semi-ui';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, matchPath, useLocation } from 'react-router-dom';
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
import { maintenanceKeys, usePublicMaintenanceStatus, useMaintenanceAccess } from '@/hooks/queries/maintenance';
import { lazyPageComponent } from '@/utils/page-registry';
import { useCurrentUserMenuTree, useMenuPaths } from '@/hooks/queries/menus';
import { ADMIN_CONTEXT_ROUTES, ADMIN_SHELL_ROUTES, menuRoutePattern, type Menu, type User } from '@zenith/shared/identity';
import PageLoading from '@/components/PageLoading';
// 布局内页面的 Suspense 边界：占位 → 内容的揭示与路由切换共用 ViewTransition（体积极小，不会拖入 AdminLayout）
import RouteSuspense from '@/layouts/RouteSuspense';

// AdminLayout 懒加载：后台布局静态依赖图很重（通知/文件预览/偏好面板/dnd-kit/DatePicker 等），
// 登录页与公开页（支付链接、公开报表、OAuth 授权）不应预载它
const AdminLayout = React.lazy(() => import('@/layouts/AdminLayout'));
// 维护遮罩只在维护生效后加载，避免其 Empty 等组件进入每次登录的关键路径。
const MaintenanceOverlay = React.lazy(() => import('@/components/MaintenanceOverlay'));
const MaintenanceManagementPage = React.lazy(() => import('@/pages/system/maintenance/MaintenancePage'));
function MaintenanceManagementOnly({ onLogout }: { readonly onLogout: () => void }) {
  return <div style={{ padding: 16 }}><Button onClick={onLogout}>退出恢复管理</Button><Routes><Route path="/system/maintenance" element={<Suspense fallback={routeFallback}><MaintenanceManagementPage /></Suspense>} /><Route path="*" element={<Navigate to="/system/maintenance" replace />} /></Routes></div>;
}

// 登录页静态引入：未登录首屏只需关键路径本身，不再多一轮 chunk 下载。
// 代价是它的静态闭包直接决定匿名首屏体积：Semi Form（含 BaseForm）会静态拖入全部字段控件（≈770 KB / 210 KB gz），
// 因此登录页只能用 Input / Button 等轻量控件（pages/login/login-form.tsx），弹窗按需 lazy；
// `bundle-budget.json` 的 index.html 关键路径预算守住这一点。
import LoginPage from '@/pages/login/LoginPage';
const ResetPasswordPage = React.lazy(() => import('@/pages/reset-password/ResetPasswordPage'));
const DashboardPage = React.lazy(() => import('@/pages/dashboard/DashboardPage'));
import DashboardSkeleton from '@/pages/dashboard/DashboardSkeleton';
const ProfilePage = React.lazy(() => import('@/pages/profile/ProfilePage'));
const AnnouncementsPage = React.lazy(() => import('@/pages/announcements/AnnouncementsPage'));
const InboxPage = React.lazy(() => import('@/pages/inbox/InboxPage'));
const GlobalSearchPage = React.lazy(() => import('@/pages/search/GlobalSearchPage'));
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

const routeFallback = <PageLoading inline />;

/** 固定路由路径，不通过菜单动态加载（导出供路由策略回归测试使用） */
export const FIXED_ROUTES = ADMIN_SHELL_ROUTES;

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
  return <RouteSuspense fallback={<DashboardSkeleton />}><DashboardPage /></RouteSuspense>;
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
 * 全量目录/页面树只在真正落入 catch-all 时才请求，用于 403 / 404 判别：
 * 它不参与正常导航，不能作为首载 gate 让每个用户每次启动都下载一遍。
 */
export function isKnownMenuRoute(path: string, patterns: readonly string[]) {
  return patterns.some(pattern => matchPath({ path: pattern, end: true }, path) !== null);
}

function NotFoundOrForbidden() {
  const location = useLocation();
  const allPathsQuery = useMenuPaths();
  if (allPathsQuery.isPending) return <PageLoading />;
  if (allPathsQuery.isError) {
    return <FullPageRetry title="页面目录加载失败" description="刷新目录后可重新判断此地址的访问状态。" error={allPathsQuery.error}
      retrying={allPathsQuery.isFetching} onRetry={() => void allPathsQuery.refetch()} />;
  }
  return isKnownMenuRoute(location.pathname, allPathsQuery.data) ? <ForbiddenPage /> : <NotFoundPage />;
}

/** 扁平化菜单以便注册路由 */
export function flattenMenus(menus: Menu[]): Menu[] {
  const routes: Menu[] = [];
  for (const m of menus) {
    const path = menuRoutePattern(m);
    if (path && !m.isExternal) {
      routes.push({ ...m, path });
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
  const contextRoutes = useMemo(() => {
    const assignedKeys = new Set(dynamicRoutes.map(menu => menu.name));
    return ADMIN_CONTEXT_ROUTES.filter(route => (!route.owner || assignedKeys.has(route.owner))
      && (permissions.includes('*') || route.anyPermission.some(code => permissions.includes(code))));
  }, [dynamicRoutes, permissions]);
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
        <Route path="profile" element={<RouteSuspense><ProfilePage user={user} /></RouteSuspense>} />
        <Route path="announcements" element={<RouteSuspense><AnnouncementsPage /></RouteSuspense>} />
        <Route path="inbox" element={<RouteSuspense><InboxPage /></RouteSuspense>} />
        <Route path="search" element={<RouteSuspense><GlobalSearchPage /></RouteSuspense>} />
        {contextRoutes.map(route => {
          const Component = lazyPageComponent(route.component);
          return Component ? <Route key={route.path} path={route.path.slice(1)}
            element={<RouteSuspense><Component /></RouteSuspense>} /> : null;
        })}
        <Route path="users" element={<Navigate to="/system/users" replace />} />
        <Route path="forbidden" element={<RouteSuspense><ForbiddenPage /></RouteSuspense>} />

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
                <RouteSuspense>
                  <Component />
                </RouteSuspense>
              }
            />
          );
        })}

        {/* 外链内嵌路由：iframe 打开外部页面 */}
        {embedRoutes.map((m) => (
          <Route
            key={`embed-${m.id}`}
            path={`embed/${m.id}`}
            element={<RouteSuspense><EmbedPage src={m.path!} title={m.title} /></RouteSuspense>}
          />
        ))}

        <Route path="*" element={<RouteSuspense><NotFoundOrForbidden /></RouteSuspense>} />
      </Route>
      <Route path="*" element={<Suspense fallback={routeFallback}><NotFoundOrForbidden /></Suspense>} />
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

  const [maintenanceLogin, setMaintenanceLogin] = useState(false);
  const maintenanceAccess = useMaintenanceAccess(status === 'authenticated');

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
  const { data: maintenance } = usePublicMaintenanceStatus({ enabled: status !== 'checking', refetchInterval: 30_000 });
  const wasMaintaining = useRef(false);
  useEffect(() => {
    if (wasMaintaining.current && maintenance && !maintenance.enabled) void queryClient.invalidateQueries();
    wasMaintaining.current = !!maintenance?.enabled;
  }, [maintenance, queryClient]);
  const activeMaintenanceAccess = status === 'authenticated' ? maintenanceAccess.data : undefined;
  const canManageMaintenance = activeMaintenanceAccess?.canManage || activeMaintenanceAccess?.canView || activeMaintenanceAccess?.canViewLogs;
  const showMaintenance = !!maintenance?.enabled && !activeMaintenanceAccess?.canBypass && !canManageMaintenance && !(maintenanceLogin && !user);
  useEffect(() => {
    if (maintenance?.version === undefined) return;
    void queryClient.invalidateQueries({ queryKey: maintenanceKeys.status });
    void queryClient.invalidateQueries({ queryKey: maintenanceKeys.logs });
  }, [maintenance?.version, queryClient]);

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

  // 维护期间不再挂载后台壳：页面内的定时查询会持续收到 503，每次 503 都会派发
  // maintenance:enabled 让状态失效，遮罩里的刷新图标就会被动地反复转圈。
  // 只渲染遮罩可以把这些请求一起停掉；维护结束后由遮罩自身的 30 秒轮询解除。
  if (maintenance?.enabled && status === 'authenticated' && maintenanceAccess.isPending) return <AppChrome><PageLoading /></AppChrome>;
  if (showMaintenance && maintenance) {
    return <AppChrome><Suspense fallback={routeFallback}><MaintenanceOverlay info={maintenance} onAdminLogin={() => {
      setMaintenanceLogin(true); if (user) handleLogout();
      if (import.meta.env.VITE_ELECTRON === 'true') window.location.hash = '/login';
      else window.history.replaceState(null, '', import.meta.env.BASE_URL + 'login');
    }} /></Suspense></AppChrome>;
  }

  // Electron file:// 协议不支持 BrowserRouter，需使用 HashRouter
  const RouterComponent = import.meta.env.VITE_ELECTRON === 'true' ? HashRouter : BrowserRouter;
  return (
    <>
    <PageErrorBoundary>
    {/* Electron 自定义标题栏（登录页和内容页共用） */}
    <ElectronTitleBar />
    <RouterComponent basename={import.meta.env.VITE_ELECTRON === 'true' ? undefined : (import.meta.env.BASE_URL.replace(/\/$/, '') || '/')}>
      {user ? (
        <PreferencesProvider>
          <ThemeProvider>
            {maintenance?.enabled && canManageMaintenance && !activeMaintenanceAccess?.canBypass ? <MaintenanceManagementOnly onLogout={handleLogout} /> : <AdminRouteLoader user={user} logout={handleLogout} />}
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
