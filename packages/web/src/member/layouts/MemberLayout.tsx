import { useCallback, useState } from 'react';
import { Outlet, useLocation, useNavigate, NavLink } from 'react-router-dom';
import { Nav, Avatar, Modal } from '@douyinfe/semi-ui';
import { Crown, House, Coins, Wallet, Ticket, UserCog, Lock, LogOut, ArrowLeft, History } from 'lucide-react';
import { useMemberAuth } from '../hooks/useMemberAuth';

const NAV_ITEMS = [
  { itemKey: '/home', text: '会员概览', icon: <House size={15} /> },
  { itemKey: '/points', text: '我的积分', icon: <Coins size={15} /> },
  { itemKey: '/wallet', text: '我的钱包', icon: <Wallet size={15} /> },
  { itemKey: '/coupons', text: '我的卡券', icon: <Ticket size={15} /> },
  { itemKey: '/level', text: '等级权益', icon: <Crown size={15} /> },
  { itemKey: '/profile/edit', text: '编辑资料', icon: <UserCog size={15} /> },
  { itemKey: '/profile/password', text: '修改密码', icon: <Lock size={15} /> },
  { itemKey: '/login-history', text: '登录历史', icon: <History size={15} /> },
  { itemKey: '__home__', text: '返回前台', icon: <ArrowLeft size={15} /> },
  { itemKey: '__logout__', text: '退出登录', icon: <LogOut size={15} /> },
];

export default function MemberLayout() {
  const { member, logout } = useMemberAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

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
        items={NAV_ITEMS}
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
