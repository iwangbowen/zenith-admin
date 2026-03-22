import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Spin } from '@douyinfe/semi-ui';
import { useAuth } from './hooks/useAuth';
import AdminLayout from './layouts/AdminLayout';
import LoginPage from './pages/login/LoginPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import UsersPage from './pages/users/UsersPage';
import ComponentsPage from './pages/components/ComponentsPage';

export default function App() {
  const { user, loading, login, register, logout } = useAuth();

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
          <Route path="users" element={<UsersPage />} />
          <Route path="components" element={<ComponentsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
