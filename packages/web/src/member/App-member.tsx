import React, { Suspense, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Spin } from '@douyinfe/semi-ui';
import { MemberAuthProvider, useMemberAuth } from './hooks/useMemberAuth';
import { memberQueryClient } from './lib/member-query';
import PublicLayout from './layouts/PublicLayout';
import MemberLayout from './layouts/MemberLayout';
import { MemberAnalyticsBridge } from './components/MemberAnalyticsBridge';
import { AnalyticsConsentBanner } from './components/AnalyticsConsentBanner';

// 路由级代码分割：各页面按需加载，避免落地页访客下载全部会员中心页面
const LandingPage = React.lazy(() => import('./pages/landing/LandingPage'));
const FeaturesPage = React.lazy(() => import('./pages/features/FeaturesPage'));
const LevelsPage = React.lazy(() => import('./pages/levels/LevelsPage'));
const PromotionsPage = React.lazy(() => import('./pages/promotions/PromotionsPage'));
const AboutPage = React.lazy(() => import('./pages/about/AboutPage'));
const ForgotPasswordPage = React.lazy(() => import('./pages/auth/ForgotPasswordPage'));
const HomePage = React.lazy(() => import('./pages/home/HomePage'));
const PointsPage = React.lazy(() => import('./pages/points/PointsPage'));
const WalletPage = React.lazy(() => import('./pages/wallet/WalletPage'));
const CouponsPage = React.lazy(() => import('./pages/coupons/CouponsPage'));
const CheckinPage = React.lazy(() => import('./pages/checkin/CheckinPage'));
const LevelPage = React.lazy(() => import('./pages/level/LevelPage'));
const ProfilePage = React.lazy(() => import('./pages/profile/ProfilePage'));
const EditProfilePage = React.lazy(() => import('./pages/profile/EditProfilePage'));
const ChangePasswordPage = React.lazy(() => import('./pages/profile/ChangePasswordPage'));
const LoginHistoryPage = React.lazy(() => import('./pages/login-history/LoginHistoryPage'));
const NotificationsPage = React.lazy(() => import('./pages/notifications/NotificationsPage'));
const InvitePage = React.lazy(() => import('./pages/invite/InvitePage'));
const RenewalPage = React.lazy(() => import('./pages/renewal/RenewalPage'));
const ContributionsPage = React.lazy(() => import('./pages/contributions/ContributionsPage'));
const ContributionEditPage = React.lazy(() => import('./pages/contributions/ContributionEditPage'));
const FavoritesPage = React.lazy(() => import('./pages/favorites/FavoritesPage'));
const ViewHistoryPage = React.lazy(() => import('./pages/history/ViewHistoryPage'));
const MyCommentsPage = React.lazy(() => import('./pages/comments/MyCommentsPage'));

const routeFallback = (
  <div className="m-loading-wrap">
    <Spin size="large" />
  </div>
);

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
    <Suspense fallback={routeFallback}>
    <Routes>
      {/* Public routes under shared top-nav layout */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<LandingPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/levels" element={<LevelsPage />} />
        <Route path="/promotions" element={<PromotionsPage />} />
        <Route path="/about" element={<AboutPage />} />
      </Route>

      {/* Standalone public pages */}
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />

      {/* Legacy auth redirects */}
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/register" element={<Navigate to="/" replace />} />

      {/* Protected member-center routes */}
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
        <Route path="/checkin" element={<CheckinPage />} />
        <Route path="/level" element={<LevelPage />} />
        <Route path="/renewal" element={<RenewalPage />} />
        <Route path="/messages" element={<NotificationsPage />} />
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/contributions" element={<ContributionsPage />} />
        <Route path="/contributions/edit" element={<ContributionEditPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/my-comments" element={<MyCommentsPage />} />
        <Route path="/view-history" element={<ViewHistoryPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/profile/edit" element={<EditProfilePage />} />
        <Route path="/profile/password" element={<ChangePasswordPage />} />
        <Route path="/login-history" element={<LoginHistoryPage />} />
      </Route>

      <Route path="*" element={<Navigate to={member ? '/home' : '/'} replace />} />
    </Routes>
    </Suspense>
  );
}

export default function MemberApp() {
  return (
    <QueryClientProvider client={memberQueryClient}>
      <MemberAuthProvider>
        <HashRouter>
          {/* 埋点桥接：路由级 PV/PL 采集 + 登录身份关联，覆盖公开与受保护路由，全局挂载一次 */}
          <MemberAnalyticsBridge />
          <AppRoutes />
          <AnalyticsConsentBanner />
        </HashRouter>
      </MemberAuthProvider>
    </QueryClientProvider>
  );
}
