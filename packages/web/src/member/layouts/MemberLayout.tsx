import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, NavLink } from 'react-router-dom';
import { Nav, Avatar, Badge, Modal } from '@douyinfe/semi-ui';
import { Crown, House, Coins, Wallet, Ticket, UserCog, Lock, LogOut, ArrowLeft, History, CalendarCheck, Settings, Bell, Gift, User, PenLine, Star, Clock } from 'lucide-react';
import { useMemberAuth } from '../hooks/useMemberAuth';
import { useUnreadNotificationCount } from '../hooks/queries';

const NAV_ITEMS = [
  { itemKey: '/home', text: '会员概览', icon: <House size={15} /> },
  { itemKey: '/points', text: '我的积分', icon: <Coins size={15} /> },
  { itemKey: '/wallet', text: '我的钱包', icon: <Wallet size={15} /> },
  { itemKey: '/coupons', text: '我的卡券', icon: <Ticket size={15} /> },
  { itemKey: '/checkin', text: '每日签到', icon: <CalendarCheck size={15} /> },
  { itemKey: '/level', text: '等级权益', icon: <Crown size={15} /> },
  { itemKey: '/messages', text: '消息中心', icon: <Bell size={15} /> },
  { itemKey: '/contributions', text: '我的投稿', icon: <PenLine size={15} /> },
  { itemKey: '/favorites', text: '我的收藏', icon: <Star size={15} /> },
  { itemKey: '/view-history', text: '浏览历史', icon: <Clock size={15} /> },
  { itemKey: '/invite', text: '邀请有礼', icon: <Gift size={15} /> },
  { itemKey: '/profile', text: '个人设置', icon: <Settings size={15} /> },
  { itemKey: '/profile/edit', text: '编辑资料', icon: <UserCog size={15} /> },
  { itemKey: '/profile/password', text: '修改密码', icon: <Lock size={15} /> },
  { itemKey: '/login-history', text: '登录历史', icon: <History size={15} /> },
  { itemKey: '__home__', text: '返回前台', icon: <ArrowLeft size={15} /> },
  { itemKey: '__logout__', text: '退出登录', icon: <LogOut size={15} /> },
];

/** 移动端底部 TabBar（<768px 时替代侧边栏）*/
const TABBAR_ITEMS = [
  { key: '/home', label: '首页', icon: House },
  { key: '/coupons', label: '卡券', icon: Ticket },
  { key: '/checkin', label: '签到', icon: CalendarCheck },
  { key: '/messages', label: '消息', icon: Bell },
  { key: '/profile', label: '我的', icon: User },
];

export default function MemberLayout() {
  const { member, logout } = useMemberAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  const unreadQuery = useUnreadNotificationCount(!!member);
  const unread = unreadQuery.data?.count ?? 0;

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const selectedKey = (() => {
    const path = location.pathname;
    const exact = NAV_ITEMS.find((item) => item.itemKey === path);
    if (exact) return exact.itemKey;
    if (path.startsWith('/profile')) return '/profile/edit';
    const prefix = NAV_ITEMS.find(
      (item) => item.itemKey !== '__logout__' && path.startsWith(item.itemKey + '/'),
    );
    return prefix?.itemKey ?? '/home';
  })();

  const handleLogout = () => {
    Modal.confirm({
      title: '退出登录',
      content: '确定要退出当前账户吗？',
      okText: '退出',
      cancelText: '取消',
      onOk: () => {
        logout();
        navigate('/', { replace: true });
      },
    });
  };

  const handleSelect = ({ itemKey }: { itemKey: string | number }) => {
    const key = String(itemKey);
    if (key === '__logout__') {
      handleLogout();
      return;
    }
    if (key === '__home__') {
      navigate('/', { replace: false });
      return;
    }
    navigate(key);
  };

  const renderWrapper = useCallback(
    ({ itemElement, props }: { itemElement: React.ReactNode; props: { itemKey?: string | number } }) => {
      const key = String(props.itemKey ?? '');
      if (key === '__logout__' || key === '__home__') {
        return <div className={key === '__logout__' ? 'mc-nav-logout-wrapper' : 'mc-nav-home-wrapper'}>{itemElement}</div>;
      }
      if (!key.startsWith('/')) return itemElement;
      return (
        <NavLink to={key} style={{ display: 'contents' }}>
          {itemElement}
        </NavLink>
      );
    },
    [],
  );

  const sidebarWidth = collapsed ? 48 : 220;

  // 消息导航项带未读徽标
  const navItems = NAV_ITEMS.map((item) =>
    item.itemKey === '/messages' && unread > 0
      ? { ...item, icon: <Badge count={unread > 99 ? '99+' : unread} type="danger">{item.icon}</Badge> }
      : item,
  );

  if (isMobile) {
    return (
      <div className="mc-app">
        <main className="mc-main" style={{ marginLeft: 0, paddingBottom: 64 }}>
          <Outlet />
        </main>
        {/* 移动端底部 TabBar */}
        <nav
          style={{
            position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 100,
            display: 'flex', height: 56,
            background: '#fff', borderTop: '1px solid var(--m-border)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {TABBAR_ITEMS.map((tab) => {
            const Icon = tab.icon;
            const active = location.pathname === tab.key || location.pathname.startsWith(tab.key + '/');
            const color = active ? 'var(--m-primary)' : 'var(--m-text-secondary)';
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => navigate(tab.key)}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 2, background: 'none', border: 'none', cursor: 'pointer', color, minHeight: 44,
                }}
              >
                {tab.key === '/messages' && unread > 0
                  ? <Badge count={unread > 99 ? '99+' : unread} type="danger"><Icon size={20} /></Badge>
                  : <Icon size={20} />}
                <span style={{ fontSize: 11 }}>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    );
  }

  return (
    <div className="mc-app">
      <Nav
        className="mc-semi-nav"
        mode="vertical"
        style={{ height: '100vh', position: 'fixed', top: 0, left: 0, width: sidebarWidth, overflowY: 'auto' }}
        isCollapsed={collapsed}
        selectedKeys={[selectedKey]}
        onSelect={handleSelect}
        onCollapseChange={setCollapsed}
        items={navItems}
        header={{
          logo: (
            <Avatar
              size="small"
              src={member?.avatar ?? undefined}
              style={{ background: 'var(--m-primary)', flexShrink: 0 }}
            >
              {member?.nickname?.[0] ?? 'U'}
            </Avatar>
          ),
          text: (
            <div style={{ lineHeight: 1.35, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {member?.nickname ?? '会员'}
              </div>
              {member?.levelName && (
                <div className="mc-member-level" style={{ marginTop: 3 }}>
                  <Crown size={10} />
                  {member.levelName}
                </div>
              )}
            </div>
          ),
        }}
        footer={{
          collapseButton: true,
          collapseText: (isCollapsed?: boolean) => (isCollapsed ? '展开侧边栏' : '收起侧边栏'),
        }}
        renderWrapper={renderWrapper}
      />

      <main className="mc-main" style={{ marginLeft: sidebarWidth, transition: 'margin-left 0.2s' }}>
        <Outlet />
      </main>
    </div>
  );
}
