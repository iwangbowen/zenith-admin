import React, { useState, useEffect, useCallback, Suspense, useMemo } from 'react';
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { PageErrorBoundary } from '@/components/PageErrorBoundary';
import { useGlobalErrorHandler } from '@/hooks/useGlobalErrorHandler';
import ElectronTitleBar from '@/components/ElectronTitleBar';
import { PermissionContext } from '@/hooks/usePermission';
import { PreferencesProvider } from '@/hooks/PreferencesProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { request } from '@/utils/request';
import MaintenanceOverlay from '@/components/MaintenanceOverlay';
import { config } from '@/config';
import type { Menu, User } from '@zenith/shared';

import AdminLayout from '@/layouts/AdminLayout';

const modules = import.meta.glob(['./pages/**/*.tsx', '!./pages/**/**Skeleton.tsx']);
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
const OAuth2AuthorizePage = React.lazy(() => import('@/pages/oauth2/OAuth2AuthorizePage'));
const WorkflowDesignerPage = React.lazy(() => import('@/pages/workflow/designer/WorkflowDesignerPage'));

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
const FIXED_ROUTES = new Set(['/profile', '/announcements', '/inbox']);

/** 未登录时保存来源路径并跳转登录 */
function RedirectToLogin() {
  const location = useLocation();
  const from = location.pathname + location.search;
  const loginUrl = from && from !== '/' ? `/login?redirect=${encodeURIComponent(from)}` : '/login';
  return <Navigate to={loginUrl} replace />;
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

  if (loading) {
    return <PageLoadingDots />;
  }

  return (
    <PermissionContext.Provider value={permissions}>
      <Routes>
        {/* OAuth2 同意授权页（独立页面，不在 AdminLayout 内）*/}
        <Route path="/oauth2/authorize" element={<Suspense fallback={routeFallback}><OAuth2AuthorizePage /></Suspense>} />
        <Route path="/" element={<AdminLayout user={user} onLogout={logout} presetMenus={menus} />}>
        {/* 固定路由 */}
        <Route index element={<Suspense fallback={<DashboardSkeleton />}><DashboardPage /></Suspense>} />
        <Route path="profile" element={<Suspense fallback={routeFallback}><ProfilePage user={user} onUserUpdate={updateUser} /></Suspense>} />
        <Route path="announcements" element={<Suspense fallback={routeFallback}><AnnouncementsPage /></Suspense>} />
        <Route path="inbox" element={<Suspense fallback={routeFallback}><InboxPage /></Suspense>} />
        <Route path="workflow/designer/:id" element={<Suspense fallback={routeFallback}><WorkflowDesignerPage /></Suspense>} />
        <Route path="users" element={<Navigate to="/system/users" replace />} />
        <Route path="forbidden" element={<Suspense fallback={routeFallback}><ForbiddenPage /></Suspense>} />

        {/* 动态路由 */}
        {dynamicRoutes.map(m => {
          // 由于 vite glob 是以 ./pages 开头的，我们需要拼接
          const importPath = `./pages/${m.component}.tsx`;
          const importFn = modules[importPath] as () => Promise<{ default: React.ComponentType }>;

          if (!importFn) {
            console.warn(`[Router] Component not found for path: ${m.path} -> ${importPath}`);
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

        <Route path="*" element={<Suspense fallback={routeFallback}><NotFoundOrForbidden allMenuPaths={allMenuPaths} /></Suspense>} />
      </Route>
      <Route path="*" element={<Suspense fallback={routeFallback}><NotFoundOrForbidden allMenuPaths={allMenuPaths} /></Suspense>} />
    </Routes>
    </PermissionContext.Provider>
  );
}

export default function App() {
  useGlobalErrorHandler();
  const { user, permissions, loading, login, register, logout, updateUser } = useAuth();

  const isSuperAdmin = user?.roles?.some((r) => r.code === 'super_admin') ?? false;

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
              <Route path="/login" element={<Suspense fallback={routeFallback}><LoginPage onLogin={login} onRegister={register} /></Suspense>} />
              <Route path="/reset-password" element={<Suspense fallback={routeFallback}><ResetPasswordPage /></Suspense>} />
              <Route path="/oauth/callback/:provider" element={<Suspense fallback={routeFallback}><OAuthCallbackPage /></Suspense>} />
              <Route path="/oauth2/authorize" element={<Suspense fallback={routeFallback}><OAuth2AuthorizePage /></Suspense>} />
              <Route path="*" element={<RedirectToLogin />} />
            </Routes>
          </PageErrorBoundary>
        </ThemeProvider>
      )}
    </RouterComponent>
    </PageErrorBoundary>
  );
}
