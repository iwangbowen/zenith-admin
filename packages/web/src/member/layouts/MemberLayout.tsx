import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate, NavLink } from 'react-router-dom';
import { Nav, Avatar, Modal } from '@douyinfe/semi-ui';
import { Crown } from 'lucide-react';
import { useMemberAuth } from '../hooks/useMemberAuth';
import { useUnreadNotificationCount } from '../hooks/queries';
import { MEMBER_NAV_ITEMS, MemberNavIcon, getSelectedMemberNavKey } from './member-nav';

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

  const selectedKey = getSelectedMemberNavKey(location.pathname);

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
  const navItems = MEMBER_NAV_ITEMS.map((item) => ({
    itemKey: item.key,
    text: item.label,
    icon: <MemberNavIcon item={item} unread={unread} size={15} />,
  }));

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
          {MEMBER_NAV_ITEMS.filter((item) => item.mobile).map((tab) => {
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
                <MemberNavIcon item={tab} active={active} unread={unread} size={20} />
                <span style={{ fontSize: 11 }}>{tab.mobileLabel ?? tab.label}</span>
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
        style={{ height: '100vh', position: 'fixed', top: 0, left: 0, width: sidebarWidth }}
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

      <main className="mc-main" style={{ marginLeft: sidebarWidth }}>
        <Outlet />
      </main>
    </div>
  );
}
