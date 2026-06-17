import { type ReactNode } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Spin } from '@douyinfe/semi-ui';
import { MemberAuthProvider, useMemberAuth } from './hooks/useMemberAuth';
import MemberLayout from './layouts/MemberLayout';
import LandingPage from './pages/landing/LandingPage';
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage';
import HomePage from './pages/home/HomePage';
import PointsPage from './pages/points/PointsPage';
import WalletPage from './pages/wallet/WalletPage';
import CouponsPage from './pages/coupons/CouponsPage';
import LevelPage from './pages/level/LevelPage';
import ProfilePage from './pages/profile/ProfilePage';
import EditProfilePage from './pages/profile/EditProfilePage';
import ChangePasswordPage from './pages/profile/ChangePasswordPage';

/** 受保护路由：未登录跳转首页（可通过弹窗登录） */
function RequireMember({ children }: Readonly<{ children: ReactNode }>) {
  const { member, loading } = useMemberAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="m-loading-wrap">
        <Spin size="large" />
      </div>
    );
  }
  if (!member) {
    return <Navigate to="/" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  const { member } = useMemberAuth();
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      {/* Legacy auth redirects */}
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/register" element={<Navigate to="/" replace />} />
      <Route
        element={
          <RequireMember>
            <MemberLayout />
          </RequireMember>
        }
      >
        <Route path="/home" element={<HomePage />} />
        <Route path="/points" element={<PointsPage />} />
        <Route path="/wallet" element={<WalletPage />} />
        <Route path="/coupons" element={<CouponsPage />} />
        <Route path="/level" element={<LevelPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/edit" element={<EditProfilePage />} />
        <Route path="/profile/password" element={<ChangePasswordPage />} />
      </Route>
      <Route path="*" element={<Navigate to={member ? '/home' : '/'} replace />} />
    </Routes>
  );
}

export default function MemberApp() {
  return (
    <MemberAuthProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </MemberAuthProvider>
  );
}
