import { useEffect, useState } from 'react';
import { Card, Spin, Tag } from '@douyinfe/semi-ui';
import { Crown, Check } from 'lucide-react';
import type { MemberLevel } from '@zenith/shared';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import { memberRequest } from '../../utils/member-request';
import { MemberPage } from '../../components/MemberPage';

function discountText(discount: number): string {
  if (discount >= 100) return '无折扣';
  return `${discount / 10} 折`;
}

export default function LevelPage() {
  const { member } = useMemberAuth();
  const [levels, setLevels] = useState<MemberLevel[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    memberRequest.get<MemberLevel[]>('/api/member/levels', { silent: true }).then((r) => {
      setLoading(false);
      if (r.code === 0) setLevels(r.data);
    });
  }, []);

  return (
    <MemberPage title="等级权益" showBack noTabbar>
      <div
        style={{
          background: 'linear-gradient(135deg, var(--m-primary) 0%, var(--m-primary-dark) 100%)',
          borderRadius: 12,
          padding: '20px 24px',
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <Crown size={36} color="#ffd75e" />
        <div>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{member?.levelName ?? '普通会员'}</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
            当前成长值 {member?.growthValue ?? 0}
          </div>
        </div>
      </div>

      {loading ? (
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
