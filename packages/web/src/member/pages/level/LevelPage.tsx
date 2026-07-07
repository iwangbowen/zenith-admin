import { Card, Progress, Spin, Tag } from '@douyinfe/semi-ui';
import { Crown, Check, TrendingUp } from 'lucide-react';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import { MemberPage } from '../../components/MemberPage';
import { useMemberLevels, useMyBenefits } from '../../hooks/queries';

function discountText(discount: number): string {
  if (discount >= 100) return '无折扣';
  return `${discount / 10} 折`;
}

export default function LevelPage() {
  const { member } = useMemberAuth();
  const levelsQuery = useMemberLevels();
  const benefitsQuery = useMyBenefits();
  const levels = levelsQuery.data ?? [];
  const benefits = benefitsQuery.data ?? null;

  const next = benefits?.nextLevel ?? null;
  const progressPercent = next
    ? Math.min(100, Math.round(((benefits?.growthValue ?? 0) / next.growthThreshold) * 100))
    : 100;

  return (
    <MemberPage title="等级权益" showBack noTabbar>
      <div
        style={{
          background: 'linear-gradient(135deg, var(--m-primary) 0%, var(--m-primary-dark) 100%)',
          borderRadius: 12,
          padding: '20px 24px',
          color: '#fff',
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <Crown size={36} color="#ffd75e" />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{member?.levelName ?? '普通会员'}</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
              当前成长值 {benefits?.growthValue ?? member?.growthValue ?? 0}
              {benefits && benefits.discount < 100 && ` · 专享 ${discountText(benefits.discount)}`}
            </div>
          </div>
        </div>
        {/* 升级进度 */}
        {next && (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, opacity: 0.9, marginBottom: 6 }}>
              <TrendingUp size={13} />
              距升级「{next.name}」还差 {next.growthGap} 成长值（{discountText(next.discount)}）
            </div>
            <Progress percent={progressPercent} stroke="#ffd75e" size="small" showInfo={false} aria-label="升级进度" />
          </div>
        )}
      </div>

      {levelsQuery.isFetching ? (
        <div className="m-loading-wrap"><Spin /></div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
          {levels.map((lv) => {
            const current = member?.levelId === lv.id;
            return (
              <Card
                key={lv.id}
                style={current ? { border: '1.5px solid var(--m-primary)' } : undefined}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {lv.name}
                    {current && <Tag color="green" size="small">当前等级</Tag>}
                  </div>
                }
              >
                <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginBottom: 8 }}>
                  成长值 ≥ {lv.growthThreshold}{'　·　'}消费折扣：{discountText(lv.discount)}
                </div>
                {lv.benefits.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {lv.benefits.map((b, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                        <Check size={13} color="var(--m-primary)" />
                        {b}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </MemberPage>
  );
}
