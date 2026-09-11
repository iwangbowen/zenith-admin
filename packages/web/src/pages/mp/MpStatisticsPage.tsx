import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Spin, Typography, Skeleton, Card, Button, Toast } from '@douyinfe/semi-ui';
import { Users, UserCheck, UserMinus, Tags, Image, FileText, MessageSquare, Reply, BarChart3 } from 'lucide-react';
import type { MpStats } from '@zenith/shared/mp';
import { formatDateForApi, shortDate } from '@/utils/date';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountRequiredBanner } from './MpAccountRequiredBanner';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import { BarChart, chartOptions, makeBarSpec, useChartPalette, StatCard, StatGrid } from '@/components/charts';
import { DateRangeFilter } from '@/components/search-filters';
import { mpStatsKeys, useMpDatacube, useMpStats, type MpDatacubeParams } from '@/hooks/queries/mp-stats';

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

const defaultRange = (): [Date, Date] => {
  const end = new Date(); end.setDate(end.getDate() - 1);
  const begin = new Date(); begin.setDate(begin.getDate() - 7);
  return [begin, end];
};

export default function MpStatisticsPage() {
  const queryClient = useQueryClient();
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const statsQuery = useMpStats(currentId);
  const stats = statsQuery.data ?? null;
  const [dcRange, setDcRange] = useState<[Date, Date]>(defaultRange());
  const [dcParams, setDcParams] = useState<MpDatacubeParams | null>(null);
  const datacubeQuery = useMpDatacube(currentId, dcParams ?? { beginDate: '', endDate: '' }, !!dcParams);
  const datacube = datacubeQuery.data ?? null;

  useEffect(() => {
    setDcParams(null);
  }, [currentId]);

  const loadDatacube = () => {
    if (!currentId) { Toast.error('请先选择公众号'); return; }
    const [begin, end] = dcRange;
    const params = { beginDate: formatDateForApi(begin), endDate: formatDateForApi(end) };
    setDcParams(params);
    void queryClient.invalidateQueries({ queryKey: mpStatsKeys.datacube(currentId, params) });
  };

  const palette = useChartPalette();
  const fanSpec = makeBarSpec({
    data: stats?.fanTrend ?? [],
    xField: 'date',
    series: [{ field: 'count', name: '粉丝数', color: '#3b82f6' }],
    palette,
    axis: { xLabel: shortDate },
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
    axis: { xLabel: shortDate },
    tooltip: { value: (v) => `${v} 条` },
  });

  return (
    <div className="page-container zx-flat-panels">
      <div style={{ marginBottom: 16 }}>
        <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
      </div>

      <MpAccountRequiredBanner loading={accountsLoading} accountCount={accounts.length} />

      <Spin spinning={statsQuery.isFetching && !!stats}>
        {(statsQuery.isFetching && !stats) ? (
          <Skeleton
            loading
            active
            placeholder={
              <>
                <StatGrid>
                  {Array.from({ length: 8 }, (_, i) => `sk-stat-${i}`).map((key) => (
                    <div key={key}>
                      <Skeleton.Title style={{ width: 64, height: 26, marginBottom: 10 }} />
                      <Skeleton.Paragraph rows={1} style={{ width: 80, marginBottom: 0 }} />
                    </div>
                  ))}
                </StatGrid>
                <div className="chart-grid" style={{ marginTop: 16 }}>
                  {Array.from({ length: 2 }, (_, i) => `sk-trend-${i}`).map((key) => (
                    <Card key={key} bodyStyle={{ padding: 16 }}>
                      <Skeleton.Title style={{ width: '40%', marginBottom: 12 }} />
                      <Skeleton.Image style={{ width: '100%', height: 180 }} />
                    </Card>
                  ))}
                </div>
              </>
            }
          >{null}</Skeleton>
        ) : (
          <>
            <StatGrid>
              {CARD_DEFS.map((c) => (
                <StatCard
                  key={c.key}
                  title={c.label}
                  value={(stats?.[c.key] as number) ?? 0}
                  icon={c.icon}
                  accent={c.color}
                />
              ))}
            </StatGrid>

            <div className="chart-grid" style={{ marginTop: 16 }}>
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
          <DateRangeFilter type="dateRange" density="compact" value={dcRange}
            onChange={(range) => { if (range) setDcRange(range); }} />
          <Button type="primary" size="small" loading={datacubeQuery.isFetching} disabled={!currentId} onClick={() => void loadDatacube()}>查询</Button>
          <Typography.Text type="tertiary" size="small">跨度 ≤ 7 天；数据 T+1，需账号已认证并有数据权限</Typography.Text>
        </div>

        {datacube ? (
          <div className="auto-grid" style={{ ['--auto-grid-min' as string]: '260px', ['--auto-grid-cols' as string]: 3, ['--auto-grid-gap' as string]: '12px' }}>
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

/** 数据立方小表：与 .zx-panel 同一语言，顶部一条细线起头 + 标题，不画外壳 */
function DatacubeTable({ title, head, rows }: Readonly<{ title: string; head: string[]; rows: string[][] }>) {
  return (
    <div className="zx-panel">
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

/** 趋势图容器：外层 .chart-grid 已负责分隔与内边距，这里只出标题 */
function TrendCard({ title, children }: Readonly<{ title: string; children: React.ReactNode }>) {
  return (
    <div>
      <Typography.Text strong>{title}</Typography.Text>
      {children}
    </div>
  );
}
