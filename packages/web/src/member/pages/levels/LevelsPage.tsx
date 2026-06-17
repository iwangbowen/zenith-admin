import { useNavigate, useOutletContext } from 'react-router-dom';
import { Button } from '@douyinfe/semi-ui';
import { Crown, Info, Zap } from 'lucide-react';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import type { PublicOutletContext } from '../../layouts/PublicLayout';

const LEVELS = [
  {
    name: '普通会员',
    nameEn: 'Member',
    color: '#6b7280',
    bg: '#f3f4f6',
    req: '注册即得',
    perks: ['基础积分返还（1%）', '生日积分奖励', '专属会员通道'],
  },
  {
    name: '银牌会员',
    nameEn: 'Silver',
    color: '#64748b',
    bg: '#e2e8f0',
    req: '累计消费满 ¥500',
    perks: ['积分加速（1.5×）', '9.5 折商品优惠', '生日双倍积分', '优先客服响应'],
  },
  {
    name: '金牌会员',
    nameEn: 'Gold',
    color: '#d97706',
    bg: '#fef3c7',
    req: '累计消费满 ¥2,000',
    perks: ['积分加速（2×）', '9.2 折商品优惠', '生日礼包', '延保服务', '专属活动邀请'],
  },
  {
    name: '白金会员',
    nameEn: 'Platinum',
    color: '#7c3aed',
    bg: '#ede9fe',
    req: '累计消费满 ¥10,000',
    perks: ['积分加速（3×）', '88 折商品优惠', '豪华生日礼包', '限定商品优先购', '极速客服通道', '专属定制服务'],
  },
];

export default function LevelsPage() {
  const navigate = useNavigate();
  const { member } = useMemberAuth();
  const { openRegister } = useOutletContext<PublicOutletContext>();

  return (
    <>
      {/* Hero */}
      <section style={{ background: 'linear-gradient(135deg, #d97706, #f59e0b)', padding: '72px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: '#fff' }}>
            <Crown size={32} />
          </div>
          <h1 style={{ color: '#fff', fontSize: 36, fontWeight: 700, margin: '0 0 12px' }}>等级体系</h1>
          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16, margin: 0 }}>
            四大等级，持续成长，专属权益随等级提升不断解锁
          </p>
        </div>
      </section>

      {/* Placeholder notice */}
      <div style={{ background: '#fffbe6', borderBottom: '1px solid #ffe58f', padding: '12px 40px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#875400' }}>
        <Info size={14} />
        <span>这是一个示例占位页面，您可以在此基础上接入真实的会员等级数据与升级规则。</span>
      </div>

      {/* Levels */}
      <section className="mc-features-section">
        <div className="mc-section-container">
          <div className="mc-section-header">
            <h2 className="mc-section-title">会员等级一览</h2>
            <p className="mc-section-sub">累计消费自动升级，权益永久有效</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20 }}>
            {LEVELS.map((level) => (
              <div key={level.name} style={{ border: `2px solid ${level.color}40`, borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ background: level.bg, padding: '24px 20px', textAlign: 'center' }}>
                  <div style={{ width: 56, height: 56, borderRadius: '50%', background: level.color, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                    <Crown size={24} color="#fff" />
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: level.color }}>{level.name}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{level.nameEn}</div>
                </div>
                <div style={{ padding: '12px 20px', background: '#fff', borderBottom: `1px solid ${level.color}20`, fontSize: 12, color: '#6b7280', textAlign: 'center' }}>
                  {level.req}
                </div>
                <div style={{ padding: '16px 20px', background: '#fff' }}>
                  {level.perks.map((perk) => (
                    <div key={perk} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 13, color: 'var(--m-text)' }}>
                      <Zap size={12} color={level.color} style={{ flexShrink: 0 }} />
                      {perk}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      {!member && (
        <section className="mc-cta-section">
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ color: '#fff', fontSize: 26, fontWeight: 700, margin: '0 0 12px' }}>从普通会员开始，开启升级之路</h2>
            <p style={{ color: 'rgba(255,255,255,0.85)', margin: '0 0 28px' }}>注册即可成为普通会员，消费即可自动升级</p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <Button size="large" theme="solid" onClick={openRegister}
                style={{ background: '#fff', color: 'var(--m-primary)', fontWeight: 600 }}>
                立即注册
              </Button>
              <Button size="large" theme="borderless" onClick={() => navigate('/features')}
                style={{ color: '#fff', border: '1px solid rgba(255,255,255,0.5)' }}>
                查看全部特权
              </Button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
