import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Dropdown } from '@douyinfe/semi-ui';
import { Crown, Coins, Tag, Gift, Star, ChevronRight, LogOut, House, Wallet, Ticket } from 'lucide-react';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import { AuthModal } from '../../components/AuthModal';

const NAV_LINKS = [
  { key: 'features', label: '会员特权' },
  { key: 'levels', label: '等级体系' },
  { key: 'coupons', label: '优惠活动' },
  { key: 'about', label: '关于我们' },
];

const FEATURES = [
  { icon: Coins, title: '积分奖励', desc: '每笔消费均可获得积分，积分可兑换专属礼品与优惠' },
  { icon: Tag, title: '专属折扣', desc: '会员等级越高，享受的消费折扣越大，最高享受9折优惠' },
  { icon: Gift, title: '生日礼包', desc: '生日当月享受专属礼包和额外积分奖励，感谢您的陪伴' },
  { icon: Star, title: '优先服务', desc: '高级会员享有专属客服通道与优先响应，让体验更极致' },
];

export default function LandingPage() {
  const navigate = useNavigate();
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
      {/* ── Top Navbar ── */}
      <header className="mc-landing-header">
        <div className="mc-landing-logo">
          <Crown size={20} color="var(--m-primary)" />
          <span>会员中心</span>
        </div>

        <nav className="mc-landing-nav">
          {NAV_LINKS.map((link) => (
            <a key={link.key} href={`#${link.key}`} className="mc-landing-nav-link">
              {link.label}
            </a>
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
                {member.levelName && <span className="m-level-badge" style={{ fontSize: 11 }}>{member.levelName}</span>}
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

      {/* ── Hero Section ── */}
      <section className="mc-hero" id="features">
        <div className="mc-hero-content">
          <div className="mc-hero-icon">
            <Crown size={52} color="#ffd75e" />
          </div>
          <h1 className="mc-hero-title">加入我们，开启专属会员体验</h1>
          <p className="mc-hero-sub">
            积分奖励、专属折扣、优先服务 —— 我们为每一位会员提供独特的价值
          </p>
          <div className="mc-hero-actions">
            {member ? (
              <Button
                size="large"
                theme="solid"
                icon={<ChevronRight size={16} />}
                iconPosition="right"
                onClick={() => navigate('/home')}
                style={{ background: 'var(--m-primary)' }}
              >
                进入会员中心
              </Button>
            ) : (
              <>
                <Button size="large" theme="solid" onClick={openRegister} style={{ background: 'var(--m-primary)' }}>
                  立即加入
                </Button>
                <Button size="large" theme="light" onClick={openLogin}>
                  已有账户？登录
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section className="mc-features-section" id="levels">
        <div className="mc-section-container">
          <h2 className="mc-section-title">会员专属权益</h2>
          <p className="mc-section-sub">丰富的会员权益，让每一分价值都被珍视</p>
          <div className="mc-features-grid">
            {FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="mc-feature-card">
                  <div className="mc-feature-icon">
                    <Icon size={26} color="var(--m-primary)" />
                  </div>
                  <h3 className="mc-feature-title">{f.title}</h3>
                  <p className="mc-feature-desc">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── CTA Section ── */}
      {!member && (
        <section className="mc-cta-section" id="coupons">
          <div className="mc-section-container" style={{ textAlign: 'center' }}>
            <h2 style={{ color: '#fff', fontSize: 28, fontWeight: 700, margin: '0 0 12px' }}>
              立即加入，享受专属礼遇
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.85)', margin: '0 0 32px' }}>
              注册即享新人优惠券，开启你的会员之旅
            </p>
            <Button
              size="large"
              theme="solid"
              onClick={openRegister}
              style={{ background: '#fff', color: 'var(--m-primary)', fontWeight: 600 }}
            >
              免费注册
            </Button>
          </div>
        </section>
      )}

      {/* ── Footer ── */}
      <footer className="mc-landing-footer">
        <div className="mc-landing-logo">
          <Crown size={15} color="var(--m-primary)" />
          <span>会员中心</span>
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
