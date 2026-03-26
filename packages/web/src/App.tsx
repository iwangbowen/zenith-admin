import React, { useState, useEffect, Suspense, useMemo } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from '@douyinfe/semi-ui';
import { useAuth } from './hooks/useAuth';
import { PermissionContext } from './hooks/usePermission';
import { request } from './utils/request';
import type { Menu } from '@zenith/shared';

import AdminLayout from './layouts/AdminLayout';
import LoginPage from './pages/login/LoginPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import ProfilePage from './pages/profile/ProfilePage';
import NotificationsPage from './pages/notifications/NotificationsPage';
import NotFoundPage from './pages/not-found/NotFoundPage';
import ForbiddenPage from './pages/forbidden/ForbiddenPage';

const modules = import.meta.glob('./pages/**/*.tsx');

/** 固定路由路径，不通过菜单动态加载 */
const FIXED_ROUTES = new Set(['/profile', '/notifications']);

/** 扁平化菜单以便注册路由 */
function flattenMenus(menus: Menu[]): Menu[] {
  let routes: Menu[] = [];
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

function AdminRouteLoader({ user, permissions, logout, updateUser }: any) {
  const [menus, setMenus] = useState<Menu[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    request.get<Menu[]>('/api/menus/user').then((res) => {
      if (res.code === 0 && res.data) {
        setMenus(res.data);
      }
    }).finally(() => setLoading(false));
  }, []);

  const dynamicRoutes = useMemo(() => flattenMenus(menus), [menus]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <PermissionContext.Provider value={permissions}>
      <Routes>
        <Route path="/" element={<AdminLayout user={user} onLogout={logout} presetMenus={menus} />}>
        {/* 固定路由 */}
        <Route index element={<DashboardPage />} />
        <Route path="profile" element={<ProfilePage user={user} onUserUpdate={updateUser} />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="users" element={<Navigate to="/system/users" replace />} />
        <Route path="forbidden" element={<ForbiddenPage />} />

        {/* 动态路由 */}
        {dynamicRoutes.map(m => {
          // 由于 vite glob 是以 ./pages 开头的，我们需要拼接
          const importPath = `./pages/${m.component}.tsx`;
          const importFn = modules[importPath] as () => Promise<{ default: React.ComponentType<any> }>;

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
                <Suspense fallback={<div style={{ padding: 24 }}><Spin /></div>}>
                  <Component />
                </Suspense>
              }
            />
          );
        })}

        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </PermissionContext.Provider>
  );
}

export default function App() {
  const { user, permissions, loading, login, register, logout, updateUser } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      {user ? (
        <AdminRouteLoader user={user} permissions={permissions} logout={logout} updateUser={updateUser} />
      ) : (
        <Routes>
          <Route path="/login" element={<LoginPage onLogin={login} onRegister={register} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
