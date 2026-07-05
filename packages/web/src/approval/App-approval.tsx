import { HashRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { TOKEN_KEY } from '@zenith/shared';
import { approvalQueryClient } from './lib/queries';
import LoginPage from './pages/LoginPage';
import TaskListPage from './pages/TaskListPage';
import TaskDetailPage from './pages/TaskDetailPage';
import LaunchListPage from './pages/LaunchListPage';
import LaunchFormPage from './pages/LaunchFormPage';

/** 路由守卫：无 token 时跳登录（token 失效由请求层 401→refresh→登录页兜底） */
function RequireAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function ApprovalApp() {
  return (
    <QueryClientProvider client={approvalQueryClient}>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<TaskListPage />} />
            <Route path="/detail/:instanceId" element={<TaskDetailPage />} />
            <Route path="/detail/:instanceId/:taskId" element={<TaskDetailPage />} />
            <Route path="/launch" element={<LaunchListPage />} />
            <Route path="/launch/:definitionId" element={<LaunchFormPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </QueryClientProvider>
  );
}
