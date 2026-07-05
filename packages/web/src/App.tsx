import React, { useState, useEffect, useCallback, Suspense, useMemo } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { PageErrorBoundary } from '@/components/PageErrorBoundary';
import { useGlobalErrorHandler } from '@/hooks/useGlobalErrorHandler';
import { initTracker, identify, resetIdentity } from '@/utils/tracker';
import ElectronTitleBar from '@/components/ElectronTitleBar';
import { PermissionContext } from '@/hooks/usePermission';
import { PreferencesProvider } from '@/hooks/PreferencesProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { request } from '@/utils/request';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { queryClient } from '@/lib/query';
import MaintenanceOverlay from '@/components/MaintenanceOverlay';
import { config } from '@/config';
import { resolvePageLoader } from '@/utils/page-registry';
import type { Menu, User } from '@zenith/shared';

import AdminLayout from '@/layouts/AdminLayout';

const LoginPage = React.lazy(() => import('@/pages/login/LoginPage'));
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
const WorkflowDesignerPage = React.lazy(() => import('@/pages/workflow/designer/WorkflowDesignerPage'));
const WorkflowLaunchPage = React.lazy(() => import('@/pages/workflow/launchpad/WorkflowLaunchPage'));
const WorkflowInstancePage = React.lazy(() => import('@/pages/workflow/instances/WorkflowInstancePage'));
const FirewallPage = React.lazy(() => import('@/pages/system/firewall/FirewallPage'));
const NginxSitesPage = React.lazy(() => import('@/pages/system/nginx-sites/NginxSitesPage'));
const SslCertificatesPage = React.lazy(() => import('@/pages/system/ssl-certificates/SslCertificatesPage'));
const DashboardDesignerPage = React.lazy(() => import('@/pages/report/designer/DashboardDesignerPage'));
const PrintDesignerPage = React.lazy(() => import('@/pages/report/designer/PrintDesignerPage'));
const DashboardViewPage = React.lazy(() => import('@/pages/report/DashboardViewPage'));

const routeFallback = <div style={{ padding: 24 }}><span className="page-loading__dot" style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'var(--semi-color-primary)' }} /></div>;

const PageLoadingDots = () => (
  <div className="page-loading">
    <div className="page-loading__dots">
      <span className="page-loading__dot" />
      <span className="page-loading__dot" />
      <span className="page-loading__dot" />
    </div>
  </div>
);

/** 固定路由路径，不通过菜单动态加载 */
const FIXED_ROUTES = new Set(['/profile', '/announcements', '/inbox', '/system/firewall', '/system/nginx-sites']);

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
 */
function RedirectFromLogin() {
  const location = useLocation();
  const redirect = new URLSearchParams(location.search).get('redirect');
  const safe =
    !!redirect &&
    redirect.startsWith('/') &&
    !redirect.startsWith('//') &&
    !redirect.startsWith('/login');
  return <Navigate to={safe ? redirect! : '/'} replace />;
}

/**
 * Catch-all 路由守卫：区分 403（页面存在但无权限）和 404（页面不存在）。
 * 通过 allMenuPaths 判断当前路径是否对应一个已存在的页面组件。
 */
function NotFoundOrForbidden({ allMenuPaths }: Readonly<{ allMenuPaths: Map<string, string> }>) {
  const location = useLocation();
  const path = location.pathname;

  // 精确匹配或前缀匹配（如 /system/users/123 匹配 /system/users）
  const segments = path.split('/').filter(Boolean);
  let matched = false;
  for (let i = segments.length; i > 0; i--) {
    const partialPath = '/' + segments.slice(0, i).join('/');
    if (allMenuPaths.has(partialPath)) {
      matched = true;
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
function flattenMenus(menus: Menu[]): Menu[] {
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
function buildAllMenuPaths(menus: Menu[]): Map<string, string> {
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
  permissions: string[];
  logout: () => void;
  updateUser: (user: Omit<User, 'password'>) => void;
}

function AdminRouteLoader({ user, permissions, logout, updateUser }: Readonly<AdminRouteLoaderProps>) {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [allMenuPaths, setAllMenuPaths] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      request.get<Menu[]>('/api/menus/user'),
      request.get<Menu[]>('/api/menus', { silent: true }),
    ]).then(([userRes, allRes]) => {
      if (userRes.code === 0 && userRes.data) {
        setMenus(userRes.data);
      }
      if (allRes.code === 0 && allRes.data) {
        setAllMenuPaths(buildAllMenuPaths(allRes.data));
      }
    }).finally(() => setLoading(false));
  }, []);

  const dynamicRoutes = useMemo(() => flattenMenus(menus), [menus]);
  const embedRoutes = useMemo(() => flattenEmbedMenus(menus), [menus]);

  if (loading) {
    return <PageLoadingDots />;
  }

  return (
    <PermissionContext.Provider value={permissions}>
      <Routes>
        <Route path="/public/payment/link/:token" element={<Suspense fallback={routeFallback}><PaymentLinkPublicPage /></Suspense>} />
        <Route path="/public/report/:token" element={<Suspense fallback={routeFallback}><PublicDashboardPage /></Suspense>} />
        {/* OAuth2 同意授权页（独立页面，不在 AdminLayout 内）*/}
        <Route path="/oauth2/authorize" element={<Suspense fallback={routeFallback}><OAuth2AuthorizePage /></Suspense>} />
        <Route path="/enterprise/callback" element={<Suspense fallback={routeFallback}><EnterpriseCallbackPage /></Suspense>} />
        {/* 已登录用户访问认证页 → 重定向，避免落入 AdminLayout catch-all 404 并作为标签页出现 */}
        <Route path="/login" element={<RedirectFromLogin />} />
        <Route path="/reset-password" element={<Navigate to="/" replace />} />
        <Route path="/" element={<AdminLayout user={user} onLogout={logout} presetMenus={menus} />}>
        {/* 固定路由 */}
        <Route index element={<Suspense fallback={<DashboardSkeleton />}><DashboardPage /></Suspense>} />
        <Route path="profile" element={<Suspense fallback={routeFallback}><ProfilePage user={user} onUserUpdate={updateUser} /></Suspense>} />
        <Route path="announcements" element={<Suspense fallback={routeFallback}><AnnouncementsPage /></Suspense>} />
        <Route path="inbox" element={<Suspense fallback={routeFallback}><InboxPage /></Suspense>} />
        <Route path="workflow/designer/:id" element={<Suspense fallback={routeFallback}><WorkflowDesignerPage /></Suspense>} />
        <Route path="workflow/launch/:definitionId" element={<Suspense fallback={routeFallback}><WorkflowLaunchPage /></Suspense>} />
        <Route path="workflow/instance/:id" element={<Suspense fallback={routeFallback}><WorkflowInstancePage /></Suspense>} />
        <Route path="report/dashboards/:id/design" element={<Suspense fallback={routeFallback}><DashboardDesignerPage /></Suspense>} />
        <Route path="report/print/:id/design" element={<Suspense fallback={routeFallback}><PrintDesignerPage /></Suspense>} />
        <Route path="report/dashboards/:id/view" element={<Suspense fallback={routeFallback}><DashboardViewPage /></Suspense>} />
        <Route path="system/ssl-certificates" element={<Suspense fallback={routeFallback}><SslCertificatesPage /></Suspense>} />
        <Route path="system/firewall" element={permissions.includes('*') || permissions.includes('system:firewall:view') ? <Suspense fallback={routeFallback}><FirewallPage /></Suspense> : <Suspense fallback={routeFallback}><ForbiddenPage /></Suspense>} />
        <Route path="system/nginx-sites" element={permissions.includes('*') || permissions.includes('system:nginx:view') ? <Suspense fallback={routeFallback}><NginxSitesPage /></Suspense> : <Suspense fallback={routeFallback}><ForbiddenPage /></Suspense>} />
        <Route path="users" element={<Navigate to="/system/users" replace />} />
        <Route path="forbidden" element={<Suspense fallback={routeFallback}><ForbiddenPage /></Suspense>} />

        {/* 动态路由 */}
        {dynamicRoutes.map(m => {
          const importFn = resolvePageLoader(m.component);

          if (!importFn) {
            console.warn(`[Router] Component not found for path: ${m.path} -> ${m.component}`);
            return null;
          }

          const Component = React.lazy(importFn);
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

        <Route path="*" element={<Suspense fallback={routeFallback}><NotFoundOrForbidden allMenuPaths={allMenuPaths} /></Suspense>} />
      </Route>
      <Route path="*" element={<Suspense fallback={routeFallback}><NotFoundOrForbidden allMenuPaths={allMenuPaths} /></Suspense>} />
    </Routes>
    </PermissionContext.Provider>
  );
}

export default function App() {
  useGlobalErrorHandler();
  const { user, permissions, loading, login, verifyMfaLogin, register, logout, updateUser } = useAuth();

  const isSuperAdmin = user?.roles?.some((r) => r.code === 'super_admin') ?? false;

  // 退出登录 / 切换用户时清空服务端状态缓存，避免跨账号数据泄漏
  const userId = user?.id;
  useEffect(() => {
    if (!userId) queryClient.clear();
  }, [userId]);

  // 初始化埋点 SDK（自动采集 / Web Vitals / API 监控）
  useEffect(() => { initTracker(); }, []);
  // 登录身份合并（匿名 → 登录），退出时重置
  useEffect(() => {
    if (user?.id) identify(user.id, user.username);
    else resetIdentity();
  }, [user?.id, user?.username]);

  interface MaintenanceInfo {
    message: string;
    estimatedEndAt: string | null;
    startedAt: string | null;
  }
  const [maintenanceInfo, setMaintenanceInfo] = useState<MaintenanceInfo | null>(null);

  const handleMaintenanceResolved = useCallback(() => setMaintenanceInfo(null), []);

  // Poll maintenance status once auth has resolved
  const maintenanceCheckedRef = React.useRef(false);
  useEffect(() => {
    if (loading) return;
    if (maintenanceCheckedRef.current) return;
    maintenanceCheckedRef.current = true;
    fetch(`${config.apiBaseUrl}/api/maintenance/status`)
      .then((r) => r.json())
      .then((data: { code: number; data: MaintenanceInfo & { enabled: boolean } }) => {
        if (data.code === 0 && data.data?.enabled && !isSuperAdmin) {
          setMaintenanceInfo(data.data);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Listen for 503 events dispatched by request.ts
  useEffect(() => {
    const handler = (e: Event) => {
      if (!isSuperAdmin) {
        const detail = (e as CustomEvent<MaintenanceInfo>).detail;
        setMaintenanceInfo(detail ?? { message: '系统维护中，请稍后重试', estimatedEndAt: null, startedAt: null });
      }
    };
    globalThis.addEventListener('maintenance:enabled', handler);
    return () => globalThis.removeEventListener('maintenance:enabled', handler);
  }, [isSuperAdmin]);

  if (loading) {
    return <PageLoadingDots />;
  }

  // Electron file:// 协议不支持 BrowserRouter，需使用 HashRouter
  const RouterComponent = import.meta.env.VITE_ELECTRON === 'true' ? HashRouter : BrowserRouter;
  return (
    <QueryClientProvider client={queryClient}>
    <PageErrorBoundary>
    {maintenanceInfo && (
      <MaintenanceOverlay info={maintenanceInfo} onResolved={handleMaintenanceResolved} />
    )}
    {/* Electron 自定义标题栏（登录页和内容页共用） */}
    <ElectronTitleBar />
    <RouterComponent basename={import.meta.env.VITE_ELECTRON === 'true' ? undefined : (import.meta.env.BASE_URL.replace(/\/$/, '') || '/')}>
      {user ? (
        <PreferencesProvider>
          <ThemeProvider>
            <AdminRouteLoader user={user} permissions={permissions} logout={logout} updateUser={updateUser} />
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
              <Route path="*" element={<RedirectToLogin />} />
            </Routes>
          </PageErrorBoundary>
        </ThemeProvider>
      )}
    </RouterComponent>
    </PageErrorBoundary>
    {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
