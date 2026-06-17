import { useOutletContext } from 'react-router-dom';
import { Button } from '@douyinfe/semi-ui';
import { Building2, Info, Mail, Phone, MapPin, Users, Globe, Award } from 'lucide-react';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import type { PublicOutletContext } from '../../layouts/PublicLayout';

const STATS = [
  { label: '注册会员', value: '100,000+', icon: Users },
  { label: '合作品牌', value: '500+', icon: Award },
  { label: '城市覆盖', value: '50+', icon: MapPin },
  { label: '服务年限', value: '5年+', icon: Globe },
];

const CONTACTS = [
  { icon: Mail, label: '商务合作', value: 'business@example.com' },
  { icon: Phone, label: '客服热线', value: '400-000-0000' },
  { icon: MapPin, label: '公司地址', value: '北京市朝阳区示例大厦 888 号' },
];

export default function AboutPage() {
  const { member } = useMemberAuth();
  const { openRegister } = useOutletContext<PublicOutletContext>();

  return (
    <>
      {/* Hero */}
      <section style={{ background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', padding: '72px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: '#fff' }}>
            <Building2 size={32} />
          </div>
          <h1 style={{ color: '#fff', fontSize: 36, fontWeight: 700, margin: '0 0 12px' }}>关于我们</h1>
          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16, margin: 0 }}>
            致力于为每一位会员提供卓越的价值体验
          </p>
        </div>
      </section>

      {/* Placeholder notice */}
      <div style={{ background: '#fffbe6', borderBottom: '1px solid #ffe58f', padding: '12px 40px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#875400' }}>
        <Info size={14} />
        <span>这是一个示例占位页面，您可以在此基础上填写真实的公司介绍与联系方式。</span>
      </div>

      {/* Content */}
      <section className="mc-features-section">
        <div className="mc-section-container">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center', marginBottom: 64 }}>
            <div>
              <h2 className="mc-section-title" style={{ textAlign: 'left', marginBottom: 16 }}>我们的故事</h2>
              <p style={{ fontSize: 15, color: 'var(--m-text-secondary)', lineHeight: 1.8, marginBottom: 16 }}>
                我们成立于 2020 年，致力于通过创新的会员体系为用户创造独特的价值。从最初的百人团队到今天覆盖全国的服务网络，我们始终以"用户至上"为核心理念。
              </p>
              <p style={{ fontSize: 15, color: 'var(--m-text-secondary)', lineHeight: 1.8 }}>
                通过不断迭代的积分体系、等级权益和专属活动，我们已帮助超过 10 万名会员获得了超预期的消费体验。未来，我们将持续在技术与服务上深耕，让每一位会员都感受到真正的价值回馈。
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
              {STATS.map((stat) => {
                const Icon = stat.icon;
                return (
                  <div key={stat.label} style={{ border: '1px solid var(--m-border)', borderRadius: 12, padding: '24px 20px', textAlign: 'center' }}>
                    <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'var(--m-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                      <Icon size={20} color="var(--m-primary)" />
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--m-text)', marginBottom: 4 }}>{stat.value}</div>
                    <div style={{ fontSize: 13, color: 'var(--m-text-secondary)' }}>{stat.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Contact */}
          <div>
            <h2 className="mc-section-title" style={{ textAlign: 'left', marginBottom: 24 }}>联系我们</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
              {CONTACTS.map((contact) => {
                const Icon = contact.icon;
                return (
                  <div key={contact.label} className="mc-feature-card" style={{ textAlign: 'left', display: 'flex', gap: 16, padding: 20 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--m-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <Icon size={20} color="var(--m-primary)" />
                    </div>
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--m-text-tertiary)', marginBottom: 4 }}>{contact.label}</div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--m-text)' }}>{contact.value}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      {!member && (
        <section className="mc-cta-section">
          <div style={{ textAlign: 'center' }}>
            <h2 style={{ color: '#fff', fontSize: 26, fontWeight: 700, margin: '0 0 12px' }}>加入我们，一起创造价值</h2>
            <p style={{ color: 'rgba(255,255,255,0.85)', margin: '0 0 28px' }}>成为会员，享受专属服务与权益</p>
            <Button size="large" theme="solid" onClick={openRegister}
              style={{ background: '#fff', color: 'var(--m-primary)', fontWeight: 600 }}>
              免费注册
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
