import { useNavigate, useOutletContext } from 'react-router-dom';
import { Button } from '@douyinfe/semi-ui';
import { Crown, Coins, Tag, Gift, Star, ChevronRight } from 'lucide-react';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import type { PublicOutletContext } from '../../layouts/PublicLayout';

const FEATURES = [
  { icon: Coins, title: '积分奖励', desc: '每笔消费均可获得积分，积分可兑换专属礼品与优惠' },
  { icon: Tag, title: '专属折扣', desc: '会员等级越高，享受的消费折扣越大，最高享受9折优惠' },
  { icon: Gift, title: '生日礼包', desc: '生日当月享受专属礼包和额外积分奖励，感谢您的陪伴' },
  { icon: Star, title: '优先服务', desc: '高级会员享有专属客服通道与优先响应，让体验更极致' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const { member } = useMemberAuth();
  const { openLogin, openRegister } = useOutletContext<PublicOutletContext>();

  return (
    <>
      {/* ── Hero ── */}
      <section className="mc-hero">
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
                style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.5)', color: '#fff' }}
              >
                进入会员中心
              </Button>
            ) : (
              <>
                <Button size="large" theme="solid" onClick={openRegister}
                  style={{ background: '#fff', color: 'var(--m-primary)', fontWeight: 600 }}>
                  立即加入
                </Button>
                <Button size="large" theme="borderless" onClick={openLogin}
                  style={{ color: '#fff', border: '1px solid rgba(255,255,255,0.5)' }}>
                  已有账户？登录
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Features Grid ── */}
      <section className="mc-features-section">
        <div className="mc-section-container">
          <div className="mc-section-header">
            <h2 className="mc-section-title">会员专属权益</h2>
            <p className="mc-section-sub">丰富的会员权益，让每一分价值都被珍视</p>
          </div>
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

      {/* ── CTA ── */}
      {!member && (
        <section className="mc-cta-section">
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
    </>
  );
}

