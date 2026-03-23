import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from '@douyinfe/semi-ui';
import { useAuth } from './hooks/useAuth';
import AdminLayout from './layouts/AdminLayout';
import LoginPage from './pages/login/LoginPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import UsersPage from './pages/users/UsersPage';
import ComponentsPage from './pages/components/ComponentsPage';
import ProfilePage from './pages/profile/ProfilePage';
import MenusPage from './pages/system/menus/MenusPage';
import RolesPage from './pages/system/roles/RolesPage';
import DictsPage from './pages/system/dicts/DictsPage';
import FileStorageConfigsPage from './pages/system/file-configs/FileStorageConfigsPage';
import FilesPage from './pages/system/files/FilesPage';
import MonitorPage from './pages/system/monitor/MonitorPage';
import NotFoundPage from './pages/not-found/NotFoundPage';

export default function App() {
  const { user, loading, login, register, logout, updateUser } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            user ? <Navigate to="/" replace /> : <LoginPage onLogin={login} onRegister={register} />
          }
        />
        <Route
          path="/"
          element={user ? <AdminLayout user={user} onLogout={() => { logout(); }} /> : <Navigate to="/login" replace />}
        >
          <Route index element={<DashboardPage />} />
          <Route path="users" element={<Navigate to="/system/users" replace />} />
          <Route path="system/users" element={<UsersPage />} />
          <Route path="components" element={<ComponentsPage />} />
          <Route path="profile" element={<ProfilePage user={user!} onUserUpdate={updateUser} />} />
          <Route path="system/menus" element={<MenusPage />} />
          <Route path="system/roles" element={<RolesPage />} />
          <Route path="system/dicts" element={<DictsPage />} />
          <Route path="system/file-configs" element={<FileStorageConfigsPage />} />
          <Route path="system/files" element={<FilesPage />} />
          <Route path="system/monitor" element={<MonitorPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BrowserRouter>
  );
}
