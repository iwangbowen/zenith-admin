import { MaintenanceBoundary } from '@/components/MaintenanceBoundary';
import { lazy, Suspense, useSyncExternalStore } from 'react';
import { HashRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Spin } from '@douyinfe/semi-ui';
import { TOKEN_KEY } from '@zenith/shared/core';
import { approvalQueryClient } from './lib/query-client';
import { ApprovalPreferencesBoundary } from './components/ApprovalPreferencesBoundary';
import { approvalSessionScope, subscribeApprovalSession } from './lib/session';
const ApprovalSessionBoundary = lazy(() => import('./components/ApprovalSessionBoundary'));

// 页面级懒加载：入口只带路由壳，TaskDetail/LaunchForm 携带的全能表单渲染器
// （富文本、附件、地区选择等重依赖）不再进入首屏预载
const LoginPage = lazy(() => import('./pages/LoginPage'));
const TaskListPage = lazy(() => import('./pages/TaskListPage'));
const TaskDetailPage = lazy(() => import('./pages/TaskDetailPage'));
const LaunchListPage = lazy(() => import('./pages/LaunchListPage'));
const LaunchFormPage = lazy(() => import('./pages/LaunchFormPage'));

const routeFallback = (
  <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
    <Spin size="large" />
  </div>
);

/** 路由守卫：无 token 时跳登录（token 失效由请求层 401→refresh→登录页兜底） */
function RequireAuth() {
  const scope = useSyncExternalStore(subscribeApprovalSession, approvalSessionScope);
  const location = useLocation();
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return <Navigate to="/login" state={{ returnTo: location.pathname + location.search }} replace />;
  return <ApprovalSessionBoundary key={scope}><ApprovalPreferencesBoundary><Outlet /></ApprovalPreferencesBoundary></ApprovalSessionBoundary>;
}

export default function ApprovalApp() {
  return (
    <QueryClientProvider client={approvalQueryClient}>
      <MaintenanceBoundary><HashRouter>
        <Suspense fallback={routeFallback}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/" element={<TaskListPage />} />
              <Route path="/detail/:instanceId" element={<TaskDetailPage />} />
              <Route path="/detail/:instanceId/:taskId" element={<TaskDetailPage />} />
              <Route path="/launch" element={<LaunchListPage />} />
              <Route path="/launch/:definitionId" element={<LaunchFormPage />} />
              <Route path="/draft/:instanceId" element={<LaunchFormPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </HashRouter></MaintenanceBoundary>
    </QueryClientProvider>
  );
}
