import { useOutletContext } from 'react-router-dom';
import { Button, Tag } from '@douyinfe/semi-ui';
import { Ticket, Info, Clock, Percent, Gift } from 'lucide-react';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import type { PublicOutletContext } from '../../layouts/PublicLayout';

const PROMOTIONS = [
  {
    type: '新人礼包',
    title: '注册即享新人大礼包',
    desc: '完成注册后系统自动发放，包含积分、折扣券各一张',
    tag: '新人专享',
    tagColor: '#07c160',
    icon: Gift,
    deadline: '长期有效',
  },
  {
    type: '限时折扣',
    title: '全场商品 9 折优惠',
    desc: '银牌及以上会员专享，每月首次购买自动生效',
    tag: '银牌+',
    tagColor: '#64748b',
    icon: Percent,
    deadline: '每月限 1 次',
  },
  {
    type: '积分活动',
    title: '双倍积分周',
    desc: '每周五至周日消费积分双倍计算，积分永不过期',
    tag: '全员参与',
    tagColor: '#f59e0b',
    icon: Ticket,
    deadline: '每周五-日',
  },
  {
    type: '生日特惠',
    title: '生日月专属礼包',
    desc: '金牌及以上会员生日当月自动发放，包含积分、礼品券',
    tag: '金牌+',
    tagColor: '#d97706',
    icon: Gift,
    deadline: '生日当月有效',
  },
  {
    type: '节日活动',
    title: '双十一超级优惠',
    desc: '全年最大力度优惠，多重满减叠加，积分三倍奖励',
    tag: '全员参与',
    tagColor: '#ec4899',
    icon: Percent,
    deadline: '11月11日',
  },
  {
    type: '推荐奖励',
    title: '邀请好友得积分',
    desc: '成功邀请好友注册并完成首次消费，双方各获 200 积分',
    tag: '长期有效',
    tagColor: '#6366f1',
    icon: Ticket,
    deadline: '长期有效',
  },
];

export default function PromotionsPage() {
  const { member } = useMemberAuth();
  const { openRegister } = useOutletContext<PublicOutletContext>();

  return (
    <>
      {/* Hero */}
      <section style={{ background: 'linear-gradient(135deg, #ec4899, #f43f5e)', padding: '72px 40px', textAlign: 'center' }}>
        <div style={{ maxWidth: 600, margin: '0 auto' }}>
          <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px', color: '#fff' }}>
            <Ticket size={32} />
          </div>
          <h1 style={{ color: '#fff', fontSize: 36, fontWeight: 700, margin: '0 0 12px' }}>优惠活动</h1>
          <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16, margin: 0 }}>
            专属会员优惠持续进行，每一天都有惊喜等你来
          </p>
        </div>
      </section>

      {/* Placeholder notice */}
      <div style={{ background: '#fffbe6', borderBottom: '1px solid #ffe58f', padding: '12px 40px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#875400' }}>
        <Info size={14} />
        <span>这是一个示例占位页面，您可以在此基础上接入真实的促销活动数据与优惠券系统。</span>
      </div>

      {/* Grid */}
      <section className="mc-features-section">
        <div className="mc-section-container">
          <div className="mc-section-header">
            <h2 className="mc-section-title">当前优惠活动</h2>
            <p className="mc-section-sub">多重优惠叠加享用，注册会员即可参与</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {PROMOTIONS.map((promo) => {
              const Icon = promo.icon;
              return (
                <div key={promo.title} className="mc-feature-card" style={{ textAlign: 'left', position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 12, right: 12 }}>
                    <Tag size="small" style={{ background: `${promo.tagColor}15`, color: promo.tagColor, border: 'none' }}>
                      {promo.tag}
                    </Tag>
                  </div>
                  <div style={{ width: 44, height: 44, borderRadius: 10, background: `${promo.tagColor}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                    <Icon size={22} color={promo.tagColor} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--m-text-tertiary)', marginBottom: 4 }}>{promo.type}</div>
                  <h3 className="mc-feature-title" style={{ marginBottom: 8 }}>{promo.title}</h3>
                  <p className="mc-feature-desc" style={{ marginBottom: 12 }}>{promo.desc}</p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--m-text-tertiary)' }}>
                    <Clock size={11} />
                    {promo.deadline}
                  </div>
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
            <h2 style={{ color: '#fff', fontSize: 26, fontWeight: 700, margin: '0 0 12px' }}>立即注册，领取新人大礼包</h2>
            <p style={{ color: 'rgba(255,255,255,0.85)', margin: '0 0 28px' }}>注册即享专属优惠，第一份礼物已经准备好了</p>
            <Button size="large" theme="solid" onClick={openRegister}
              style={{ background: '#fff', color: 'var(--m-primary)', fontWeight: 600 }}>
              免费注册领礼包
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
