import { useEffect, useState, useCallback } from 'react';
import { Spin, Banner, Typography, Skeleton, Card, DatePicker, Button, Toast } from '@douyinfe/semi-ui';
import { Users, UserCheck, UserMinus, Tags, Image, FileText, MessageSquare, Reply, BarChart3 } from 'lucide-react';
import type { MpStats, MpDatacube } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateForApi } from '@/utils/date';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import { BarChart, chartOptions, makeBarSpec, useChartPalette } from '@/components/charts';

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
  const { accounts, currentId, currentIdRef, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const [stats, setStats] = useState<MpStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (accountId: number) => {
    setLoading(true);
    try {
      const res = await request.get<MpStats>(`/api/mp/stats?accountId=${accountId}`);
      if (currentIdRef.current !== accountId) return; // 账号已切换，丢弃过期响应
      setStats(res.data ?? null);
    } finally { setLoading(false); }
  }, [currentIdRef]);

  useEffect(() => { if (currentId) void load(currentId); else setStats(null); }, [currentId, load]);

  // ── 微信数据立方（真实接口） ──
  const [datacube, setDatacube] = useState<MpDatacube | null>(null);
  const [dcLoading, setDcLoading] = useState(false);
  const defaultRange = (): [Date, Date] => {
    const end = new Date(); end.setDate(end.getDate() - 1);
    const begin = new Date(); begin.setDate(begin.getDate() - 7);
    return [begin, end];
  };
  const [dcRange, setDcRange] = useState<[Date, Date]>(defaultRange());

  const loadDatacube = useCallback(async () => {
    if (!currentId) { Toast.error('请先选择公众号'); return; }
    const [begin, end] = dcRange;
    const reqId = currentId;
    setDcLoading(true);
    try {
      const q = new URLSearchParams({ accountId: String(currentId), beginDate: formatDateForApi(begin), endDate: formatDateForApi(end) });
      const res = await request.get<MpDatacube>(`/api/mp/stats/datacube?${q}`);
      if (currentIdRef.current !== reqId) return;
      if (res.code === 0) setDatacube(res.data ?? null);
    } finally {
      if (currentIdRef.current === reqId) setDcLoading(false);
    }
  }, [currentId, currentIdRef, dcRange]);

  useEffect(() => { setDatacube(null); }, [currentId]);

  const palette = useChartPalette();
  const fanSpec = makeBarSpec({
    data: stats?.fanTrend ?? [],
    xField: 'date',
    series: [{ field: 'count', name: '粉丝数', color: '#3b82f6' }],
    palette,
    axis: { xLabel: (v) => v.slice(5) },
    tooltip: { value: (v) => `${v} 人` },
  });
  const msgSpec = makeBarSpec({
    data: stats?.messageTrend ?? [],
    xField: 'date',
    series: [
      { field: 'in', name: '收到', color: '#ec4899' },
      { field: 'out', name: '发出', color: '#10b981' },
    ],
    palette,
    axis: { xLabel: (v) => v.slice(5) },
    tooltip: { value: (v) => `${v} 条` },
  });

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
            <BarChart {...fanSpec} options={chartOptions} height={160} />
          </TrendCard>
          <TrendCard title="近 7 日消息收发">
            <BarChart {...msgSpec} options={chartOptions} height={160} />
          </TrendCard>
        </div>
          </>
        )}
      </Spin>

      <Card style={{ marginTop: 16 }} bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Typography.Title heading={6} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}><BarChart3 size={16} /> 微信数据立方（真实接口）</Typography.Title>
          <DatePicker type="dateRange" density="compact" value={dcRange} style={{ width: 260 }}
            onChange={(v) => { if (Array.isArray(v) && v.length === 2) setDcRange([v[0] as Date, v[1] as Date]); }} />
          <Button type="primary" size="small" loading={dcLoading} disabled={!currentId} onClick={() => void loadDatacube()}>查询</Button>
          <Typography.Text type="tertiary" size="small">跨度 ≤ 7 天；数据 T+1，需账号已认证并有数据权限</Typography.Text>
        </div>

        {datacube ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            <DatacubeTable title="用户增减" head={['日期', '新增', '取关']}
              rows={datacube.userSummary.map((r) => [r.refDate.slice(5), String(r.newUser), String(r.cancelUser)])} />
            <DatacubeTable title="累计用户" head={['日期', '累计关注']}
              rows={datacube.userCumulate.map((r) => [r.refDate.slice(5), String(r.cumulateUser)])} />
            <DatacubeTable title="消息概况" head={['日期', '发送人数', '消息条数']}
              rows={datacube.upstreamMsg.map((r) => [r.refDate.slice(5), String(r.msgUser), String(r.msgCount)])} />
            <DatacubeTable title="图文阅读" head={['日期', '页面阅读']}
              rows={datacube.articleSummary.map((r) => [r.refDate.slice(5), String(r.pageReadCount)])} />
            <DatacubeTable title="图文分享转发" head={['日期', '转发次数', '转发人数']}
              rows={datacube.userShare.map((r) => [r.refDate.slice(5), String(r.shareCount), String(r.shareUser)])} />
            <DatacubeTable title="接口分析" head={['日期', '调用', '失败', '最大耗时ms']}
              rows={datacube.interfaceSummary.map((r) => [r.refDate.slice(5), String(r.callbackCount), String(r.failCount), String(r.maxTimeCost)])} />
          </div>
        ) : (
          <Typography.Text type="tertiary">点击「查询」拉取微信侧真实统计数据。</Typography.Text>
        )}
      </Card>
    </div>
  );
}

function DatacubeTable({ title, head, rows }: Readonly<{ title: string; head: string[]; rows: string[][] }>) {
  return (
    <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 12, background: 'var(--semi-color-bg-1)' }}>
      <Typography.Text strong style={{ fontSize: 13 }}>{title}</Typography.Text>
      <table style={{ width: '100%', marginTop: 8, fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr>{head.map((h) => <th key={h} style={{ textAlign: 'left', padding: '4px 6px', color: 'var(--semi-color-text-2)', borderBottom: '1px solid var(--semi-color-border)' }}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={head.length} style={{ padding: '8px 6px', color: 'var(--semi-color-text-3)' }}>无数据</td></tr>
            : rows.map((r, i) => <tr key={i}>{r.map((cell, j) => <td key={j} style={{ padding: '4px 6px', borderBottom: '1px solid var(--semi-color-fill-0)' }}>{cell}</td>)}</tr>)}
        </tbody>
      </table>
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
