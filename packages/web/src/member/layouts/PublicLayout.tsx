import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Avatar, Button, Dropdown } from '@douyinfe/semi-ui';
import { Crown, House, Coins, Wallet, Ticket, LogOut } from 'lucide-react';
import { useMemberAuth } from '../hooks/useMemberAuth';
import { AuthModal } from '../components/AuthModal';

// eslint-disable-next-line react-refresh/only-export-components
export const PUBLIC_NAV = [
  { to: '/features', label: '会员特权' },
  { to: '/levels', label: '等级体系' },
  { to: '/promotions', label: '优惠活动' },
  { to: '/about', label: '关于我们' },
] as const;

export type PublicOutletContext = {
  openLogin: () => void;
  openRegister: () => void;
};

export default function PublicLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { member, logout } = useMemberAuth();
  const [authVisible, setAuthVisible] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');

  const openLogin = () => { setAuthTab('login'); setAuthVisible(true); };
  const openRegister = () => { setAuthTab('register'); setAuthVisible(true); };

  const avatarMenu = (
    <Dropdown.Menu>
      <Dropdown.Title>欢迎，{member?.nickname ?? '会员'}</Dropdown.Title>
      <Dropdown.Item icon={<House size={14} />} onClick={() => navigate('/home')}>会员概览</Dropdown.Item>
      <Dropdown.Item icon={<Coins size={14} />} onClick={() => navigate('/points')}>我的积分</Dropdown.Item>
      <Dropdown.Item icon={<Wallet size={14} />} onClick={() => navigate('/wallet')}>我的钱包</Dropdown.Item>
      <Dropdown.Item icon={<Ticket size={14} />} onClick={() => navigate('/coupons')}>我的卡券</Dropdown.Item>
      <Dropdown.Divider />
      <Dropdown.Item icon={<LogOut size={14} />} type="danger" onClick={() => logout()}>退出登录</Dropdown.Item>
    </Dropdown.Menu>
  );

  return (
    <div className="mc-landing">
      <header className="mc-landing-header">
        <div
          className="mc-landing-logo"
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
          onClick={() => navigate('/')}
          onKeyDown={(e) => e.key === 'Enter' && navigate('/')}
        >
          <Crown size={20} color="var(--m-primary)" />
          <span>会员中心</span>
        </div>

        <nav className="mc-landing-nav">
          {PUBLIC_NAV.map((link) => (
            <button
              key={link.to}
              type="button"
              className={`mc-landing-nav-link${location.pathname === link.to ? ' active' : ''}`}
              onClick={() => navigate(link.to)}
            >
              {link.label}
            </button>
          ))}
        </nav>

        <div className="mc-landing-actions">
          {member ? (
            <Dropdown render={avatarMenu} position="bottomRight" trigger="click">
              <div className="mc-landing-avatar">
                <Avatar size="small" src={member.avatar ?? undefined} style={{ background: 'var(--m-primary)', flexShrink: 0 }}>
                  {member.nickname?.[0] ?? 'U'}
                </Avatar>
                <span className="mc-landing-avatar-name">{member.nickname ?? '会员'}</span>
                {member.levelName && (
                  <span className="mc-member-level" style={{ fontSize: 11 }}>{member.levelName}</span>
                )}
              </div>
            </Dropdown>
          ) : (
            <>
              <Button theme="borderless" onClick={openLogin}>登录</Button>
              <Button theme="solid" onClick={openRegister} style={{ background: 'var(--m-primary)' }}>
                免费注册
              </Button>
            </>
          )}
        </div>
      </header>

      <Outlet context={{ openLogin, openRegister } satisfies PublicOutletContext} />

      <footer className="mc-landing-footer" id="about-footer">
        <div className="mc-landing-logo">
          <Crown size={15} color="var(--m-primary)" />
          <span>会员中心</span>
        </div>
        <div className="mc-footer-links">
          {PUBLIC_NAV.map((link) => (
            <a key={link.to} onClick={() => navigate(link.to)} style={{ cursor: 'pointer' }}>
              {link.label}
            </a>
          ))}
        </div>
        <span>© 2026 会员中心. All rights reserved.</span>
      </footer>

      <AuthModal
        visible={authVisible}
        onClose={() => setAuthVisible(false)}
        defaultTab={authTab}
      />
    </div>
  );
}
