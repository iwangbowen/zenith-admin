import { useEffect, useState, useCallback } from 'react';
import { Spin, Banner, Typography, Skeleton, Card } from '@douyinfe/semi-ui';
import { Users, UserCheck, UserMinus, Tags, Image, FileText, MessageSquare, Reply } from 'lucide-react';
import type { MpStats } from '@zenith/shared';
import { request } from '@/utils/request';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';

const CARD_DEFS: { key: keyof MpStats; label: string; icon: React.ReactNode; color: string }[] = [
  { key: 'fanTotal', label: '粉丝总数', icon: <Users size={20} />, color: '#3b82f6' },
  { key: 'fanSubscribed', label: '已关注', icon: <UserCheck size={20} />, color: '#10b981' },
  { key: 'fanUnsubscribed', label: '已取关', icon: <UserMinus size={20} />, color: '#9ca3af' },
  { key: 'tagTotal', label: '标签数', icon: <Tags size={20} />, color: '#8b5cf6' },
  { key: 'materialTotal', label: '素材数', icon: <Image size={20} />, color: '#f59e0b' },
  { key: 'draftTotal', label: '图文草稿', icon: <FileText size={20} />, color: '#06b6d4' },
  { key: 'messageIn', label: '收到消息', icon: <MessageSquare size={20} />, color: '#ec4899' },
  { key: 'autoReplyTotal', label: '自动回复', icon: <Reply size={20} />, color: '#14b8a6' },
];

export default function MpStatisticsPage() {
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const [stats, setStats] = useState<MpStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (accountId: number) => {
    setLoading(true);
    try {
      const res = await request.get<MpStats>(`/api/mp/stats?accountId=${accountId}`);
      setStats(res.data ?? null);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { if (currentId) void load(currentId); else setStats(null); }, [currentId, load]);

  const maxFan = Math.max(1, ...(stats?.fanTrend.map((d) => d.count) ?? [0]));
  const maxMsg = Math.max(1, ...(stats?.messageTrend.flatMap((d) => [d.in, d.out]) ?? [0]));

  return (
    <div className="page-container">
      <div style={{ marginBottom: 16 }}>
        <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
      </div>

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <Spin spinning={loading && !!stats}>
        {(loading && !stats) ? (
          <Skeleton
            loading
            active
            placeholder={
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
                  {Array.from({ length: 8 }, (_, i) => `sk-stat-${i}`).map((key) => (
                    <div key={key} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 16, background: 'var(--semi-color-bg-1)', display: 'flex', alignItems: 'center', gap: 12 }}>
                      <Skeleton.Avatar style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <Skeleton.Title style={{ width: '60%', marginBottom: 8 }} />
                        <Skeleton.Paragraph rows={1} style={{ width: '40%' }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
                  {Array.from({ length: 2 }, (_, i) => `sk-trend-${i}`).map((key) => (
                    <Card key={key} style={{ borderRadius: 8 }} bodyStyle={{ padding: 16 }}>
                      <Skeleton.Title style={{ width: '40%', marginBottom: 12 }} />
                      <Skeleton.Image style={{ width: '100%', height: 180 }} />
                    </Card>
                  ))}
                </div>
              </>
            }
          >{null}</Skeleton>
        ) : (
          <>{/* 指标卡片 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 12 }}>
          {CARD_DEFS.map((c) => (
            <div key={c.key} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 16, background: 'var(--semi-color-bg-1)', display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 8, background: `${c.color}1a`, color: c.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{c.icon}</div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 600, lineHeight: 1.1 }}>{(stats?.[c.key] as number) ?? 0}</div>
                <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>{c.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* 趋势 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          <TrendCard title="近 7 日粉丝增长">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 160, paddingTop: 12 }}>
              {(stats?.fanTrend ?? []).map((d) => (
                <Bar key={d.date} label={d.date.slice(5)} value={d.count} ratio={d.count / maxFan} color="#3b82f6" />
              ))}
            </div>
          </TrendCard>
          <TrendCard title="近 7 日消息收发">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 160, paddingTop: 12 }}>
              {(stats?.messageTrend ?? []).map((d) => (
                <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120 }}>
                    <span style={{ width: 10, height: `${Math.round((d.in / maxMsg) * 100)}%`, minHeight: 2, background: '#ec4899', borderRadius: 2 }} title={`收 ${d.in}`} />
                    <span style={{ width: 10, height: `${Math.round((d.out / maxMsg) * 100)}%`, minHeight: 2, background: '#10b981', borderRadius: 2 }} title={`发 ${d.out}`} />
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--semi-color-text-2)' }}>{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 8 }}>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#ec4899', borderRadius: 2, marginRight: 4 }} />收到</span>
              <span><span style={{ display: 'inline-block', width: 10, height: 10, background: '#10b981', borderRadius: 2, marginRight: 4 }} />发出</span>
            </div>
          </TrendCard>
        </div>
          </>
        )}
      </Spin>
    </div>
  );
}

function TrendCard({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 16, background: 'var(--semi-color-bg-1)' }}>
      <Typography.Text strong>{title}</Typography.Text>
      {children}
    </div>
  );
}

function Bar({ label, value, ratio, color }: Readonly<{ label: string; value: number; ratio: number; color: string }>) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--semi-color-text-2)' }}>{value}</span>
      <div style={{ width: 16, height: `${Math.round(ratio * 110)}px`, minHeight: 2, background: color, borderRadius: 3 }} />
      <span style={{ fontSize: 11, color: 'var(--semi-color-text-2)' }}>{label}</span>
    </div>
  );
}
