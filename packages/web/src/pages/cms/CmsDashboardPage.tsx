import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Card, Empty, Spin, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { DataBar } from '@/components/data-viz/DataBar';
import { usePermission } from '@/hooks/usePermission';
import { useCmsDashboardStats } from '@/hooks/queries/cms';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { CmsSiteSelect } from './CmsSiteSelect';

const STAT_CARDS: { key: 'published' | 'draft' | 'pending' | 'offline' | 'rejected' | 'recycled'; label: string; color: string }[] = [
  { key: 'published', label: '已发布', color: 'var(--semi-color-success)' },
  { key: 'draft', label: '草稿', color: 'var(--semi-color-text-2)' },
  { key: 'pending', label: '待审核', color: 'var(--semi-color-warning)' },
  { key: 'offline', label: '已下线', color: 'var(--semi-color-tertiary)' },
  { key: 'rejected', label: '已驳回', color: 'var(--semi-color-danger)' },
  { key: 'recycled', label: '回收站', color: 'var(--semi-color-text-3)' },
];

export default function CmsDashboardPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canViewDashboard = hasPermission('cms:dashboard:view');
  const canListSites = hasPermission('cms:site:list');
  const canOpenDashboard = canViewDashboard && canListSites;
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const statsQuery = useCmsDashboardStats(canOpenDashboard ? siteId : undefined);
  const stats = statsQuery.data;

  const maxTrend = Math.max(1, ...(stats?.publishTrend ?? []).map((trend) => trend.count));
  const maxChannel = Math.max(1, ...(stats?.channelDistribution ?? []).map((channel) => channel.count));

  const topColumns: ColumnProps<NonNullable<typeof stats>['topViewed'][number]>[] = [
    {
      title: '标题',
      dataIndex: 'title',
      render: (value: string, record) => (
        <Typography.Text
          link
          ellipsis={{ showTooltip: true }}
          style={{ maxWidth: 300 }}
          onClick={() => navigate(`/cms/contents/edit?id=${record.id}&siteId=${siteId}`)}
        >
          {value}
        </Typography.Text>
      ),
    },
    { title: '栏目', dataIndex: 'channelName', width: 140, render: (value: string | null) => value || EMPTY_PLACEHOLDER },
    { title: '浏览量', dataIndex: 'viewCount', width: 100, align: 'right' },
  ];

  return (
    <div className="page-container zx-flat-panels">
      {canOpenDashboard ? (
        <>
          <SearchToolbar>
            <CmsSiteSelect value={siteId} onChange={setSiteId} width={200} />
          </SearchToolbar>

          <Spin spinning={statsQuery.isFetching && !stats}>
            <StatGrid minItemWidth={160}>
              {STAT_CARDS.map((card) => (
                <StatCard key={card.key} title={card.label} value={stats?.totals[card.key] ?? 0} accent={card.color} />
              ))}
            </StatGrid>

            <StatGrid minItemWidth={160} style={{ marginTop: 12 }}>
              <StatCard title="今日发布" value={stats?.todayPublished ?? 0} />
              <StatCard title="累计浏览量" value={stats?.totalViews ?? 0} />
              <StatCard
                title="待审核评论"
                value={stats?.pendingComments ?? 0}
                accent={stats?.pendingComments ? 'var(--semi-color-warning)' : undefined}
              />
            </StatGrid>

            <Card title="发布趋势（近 14 天）" style={{ marginTop: 12 }} bodyStyle={{ padding: '16px 20px' }}>
              {stats && stats.publishTrend.some((trend) => trend.count > 0) ? (
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
                  {stats.publishTrend.map((trend) => (
                    <div key={trend.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
                      <span style={{ fontSize: 11, color: 'var(--semi-color-text-2)' }}>{trend.count > 0 ? trend.count : ''}</span>
                      <div
                        title={`${trend.date}：${trend.count} 篇`}
                        style={{
                          width: '60%',
                          height: `${Math.max(2, Math.round((trend.count / maxTrend) * 100))}px`,
                          background: trend.count > 0 ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-1)',
                          borderRadius: 'var(--semi-border-radius-small)',
                        }}
                      />
                      <span style={{ fontSize: 11, color: 'var(--semi-color-text-3)', whiteSpace: 'nowrap' }}>{trend.date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty description="近 14 天暂无发布" style={{ padding: '24px 0' }} />
              )}
            </Card>

            <div className="chart-grid chart-grid--aside" style={{ ['--chart-aside-main' as string]: '1.4fr', ['--chart-aside-side' as string]: '1fr', marginTop: 12 }}>
              <Card title="热门内容 TOP10（按浏览量）" bodyStyle={{ padding: 0 }}>
                <ConfigurableTable
                  columnSettingsKey="cms-dashboard-top-viewed"
                  columns={topColumns}
                  dataSource={stats?.topViewed ?? []}
                  rowKey="id"
                  size="small"
                  pagination={false}
                  empty="暂无已发布内容"
                  onRefresh={() => void statsQuery.refetch()}
                  refreshLoading={statsQuery.isFetching}
                />
              </Card>
              <Card title="栏目内容分布 TOP10" bodyStyle={{ padding: '16px 20px' }}>
                {stats && stats.channelDistribution.length > 0 ? (
                  stats.channelDistribution.map((channel) => (
                    <div key={channel.channelId} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                        <span>{channel.channelName}</span>
                        <span style={{ color: 'var(--semi-color-text-2)' }}>{channel.count}</span>
                      </div>
                      <DataBar value={channel.count} max={maxChannel} track="var(--semi-color-fill-0)" />
                    </div>
                  ))
                ) : (
                  <Empty description="暂无内容" style={{ padding: '24px 0' }} />
                )}
              </Card>
            </div>
          </Spin>
        </>
      ) : (
        <Banner type="warning" description="使用数据看板需要 CMS 看板查询和站点查询权限。" />
      )}
    </div>
  );
}
