import { useNavigate, useOutletContext } from 'react-router-dom';
import { Button, Tag } from '@douyinfe/semi-ui';
import { Coins, Gift, Star, Shield, Zap, Crown, Info } from 'lucide-react';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import type { PublicOutletContext } from '../../layouts/PublicLayout';

const PRIVILEGES = [
  {
    icon: Coins,
    title: '积分返还',
    badge: '全等级',
    desc: '每次消费按比例获得积分，积分可抵扣现金或兑换礼品。消费越多，积分越多。',
    color: '#f59e0b',
  },
  {
    icon: Star,
    title: '专属折扣',
    badge: '银牌+',
    desc: '银牌及以上会员享受商品折扣优惠，等级越高折扣越大，最高享受88折。',
    color: '#6366f1',
  },
  {
    icon: Gift,
    title: '生日礼包',
    badge: '金牌+',
    desc: '生日当月系统自动发放专属礼包，包含积分奖励、优惠券及神秘惊喜。',
    color: '#ec4899',
  },
  {
    icon: Crown,
    title: '限定商品',
    badge: '白金',
    desc: '白金会员可提前购买限定版商品，享受优先选购权与专属定制服务。',
    color: '#8b5cf6',
  },
  {
    icon: Shield,
    title: '延保服务',
    badge: '金牌+',
    desc: '金牌及以上会员购买指定商品享受额外延长保修，无忧售后体验。',
    color: '#07c160',
  },
  {
    icon: Zap,
    title: '极速响应',
    badge: '白金',
    desc: '白金会员享有专属客服通道，工作日 30 分钟内响应，假期 2 小时内响应。',
    color: '#f97316',
  },
];

export default function FeaturesPage() {
  const navigate = useNavigate();
  const { member } = useMemberAuth();
  const { openRegister } = useOutletContext<PublicOutletContext>();

  return (
    <>
      {/* Hero */}
      <section style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', padding: '72px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: '#fff' }}>
            <Crown size={32} />
          </div>
          <h1 style={{ color: '#fff', fontSize: 36, fontWeight: 700, margin: '0 0 12px' }}>会员特权</h1>
          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16, margin: 0 }}>
            多重权益叠加，让每一位会员都能感受到专属价值
          </p>
        </div>
      </section>

      {/* Placeholder notice */}
      <div style={{ background: '#fffbe6', borderBottom: '1px solid #ffe58f', padding: '12px 40px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#875400' }}>
        <Info size={14} />
        <span>这是一个示例占位页面，您可以在此基础上实现自定义的会员特权展示逻辑。</span>
      </div>

      {/* Privileges Grid */}
      <section className="mc-features-section">
        <div className="mc-section-container">
          <div className="mc-section-header">
            <h2 className="mc-section-title">全部权益一览</h2>
            <p className="mc-section-sub">不同等级解锁不同特权，持续成长，持续获益</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
            {PRIVILEGES.map((p) => {
              const Icon = p.icon;
              return (
                <div key={p.title} className="mc-feature-card" style={{ textAlign: 'left' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: `${p.color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={22} color={p.color} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--m-text)' }}>{p.title}</div>
                      <Tag size="small" style={{ background: `${p.color}18`, color: p.color, border: 'none', marginTop: 2 }}>{p.badge}</Tag>
                    </div>
                  </div>
                  <p className="mc-feature-desc">{p.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      {!member && (
        <section className="mc-cta-section">
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ color: '#fff', fontSize: 26, fontWeight: 700, margin: '0 0 12px' }}>立即注册，解锁基础权益</h2>
            <p style={{ color: 'rgba(255,255,255,0.85)', margin: '0 0 28px' }}>注册即成为普通会员，开启你的特权之旅</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <Button size="large" theme="solid" onClick={openRegister}
                style={{ background: '#fff', color: 'var(--m-primary)', fontWeight: 600 }}>
                免费注册
              </Button>
              <Button size="large" theme="borderless" onClick={() => navigate('/levels')}
                style={{ color: '#fff', border: '1px solid rgba(255,255,255,0.5)' }}>
                查看等级体系
              </Button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
