import { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Card, Spin, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
// 只取卡片壳（无 vchart 依赖），画面本体见各懒加载 chunk
import { ChartCard } from '@/components/charts/ChartCard';
import { usePermission } from '@/hooks/usePermission';
import { useCmsDashboardStats, useCmsVisitStats } from '@/hooks/queries/cms-stats';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { CmsSiteSelect } from './CmsSiteSelect';
import CmsTodoStrip from './CmsTodoStrip';
import { cmsContentsViewUrl } from './cms-contents-view';

const CmsPublishVisitTrendChart = lazy(() => import('./CmsPublishVisitTrendChart'));
const CmsChannelDistributionChart = lazy(() => import('./CmsChannelDistributionChart'));
const CmsContentTypeDonut = lazy(() => import('./CmsContentTypeDonut'));

const STAT_CARDS: { key: 'published' | 'draft' | 'pending' | 'offline' | 'rejected' | 'recycled'; label: string; color: string; tab?: 'published' | 'pending' | 'recycle' }[] = [
  { key: 'published', label: '已发布', color: 'var(--semi-color-success)', tab: 'published' },
  { key: 'draft', label: '草稿', color: 'var(--semi-color-text-2)' },
  { key: 'pending', label: '待审核', color: 'var(--semi-color-warning)', tab: 'pending' },
  { key: 'offline', label: '已下线', color: 'var(--semi-color-tertiary)' },
  { key: 'rejected', label: '已驳回', color: 'var(--semi-color-danger)' },
  { key: 'recycled', label: '回收站', color: 'var(--semi-color-text-3)', tab: 'recycle' },
];

export default function CmsDashboardPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canViewDashboard = hasPermission('cms:dashboard:view');
  const canListSites = hasPermission('cms:site:list');
  const canOpenDashboard = canViewDashboard && canListSites;
  const canViewStats = hasPermission('cms:stat:view');
  const canAuditComments = hasPermission('cms:comment:list');
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const statsQuery = useCmsDashboardStats(canOpenDashboard ? siteId : undefined);
  const stats = statsQuery.data;
  const visitsQuery = useCmsVisitStats(canViewStats ? siteId : undefined, 14);
  const loading = statsQuery.isFetching && !stats;

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
    { title: '赞 / 藏', width: 100, align: 'right', render: (_: unknown, record) => `${record.likeCount} / ${record.favoriteCount}` },
    { title: '评论数', dataIndex: 'commentCount', width: 90, align: 'right' },
    { title: '发布时间', dataIndex: 'publishedAt', width: 180, render: (value: string | null) => value || EMPTY_PLACEHOLDER },
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
                <StatCard
                  key={card.key}
                  title={card.label}
                  value={stats?.totals[card.key] ?? 0}
                  accent={card.color}
                  onClick={card.tab && siteId !== undefined ? () => navigate(cmsContentsViewUrl(siteId, { tab: card.tab })) : undefined}
                />
              ))}
            </StatGrid>

            <StatGrid minItemWidth={160} style={{ marginTop: 12 }}>
              <StatCard title="今日发布" value={stats?.todayPublished ?? 0} />
              <StatCard title="累计浏览量" value={stats?.totalViews ?? 0} />
              <StatCard
                title="待审核评论"
                value={stats?.pendingComments ?? 0}
                accent={stats?.pendingComments ? 'var(--semi-color-warning)' : undefined}
                onClick={canAuditComments ? () => navigate('/cms/comments') : undefined}
              />
            </StatGrid>

            <CmsTodoStrip siteId={siteId} />

            <Suspense fallback={<ChartCard title="发布与访问趋势（近 14 天）" loading>{null}</ChartCard>}>
              <div style={{ marginTop: 12 }}>
                <CmsPublishVisitTrendChart
                  publishTrend={stats?.publishTrend}
                  visitsTrend={visitsQuery.data?.trend}
                  loading={loading}
                />
              </div>
            </Suspense>

            <div className="chart-grid chart-grid--aside" style={{ ['--chart-aside-main' as string]: '1.4fr', ['--chart-aside-side' as string]: '1fr', marginTop: 12 }}>
              <Suspense fallback={<ChartCard title="栏目内容分布 TOP10" loading>{null}</ChartCard>}>
                <CmsChannelDistributionChart
                  data={stats?.channelDistribution}
                  loading={loading}
                  onSelectChannel={siteId === undefined ? undefined : (channelId) => navigate(cmsContentsViewUrl(siteId, { channelId }))}
                />
              </Suspense>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
                <Suspense fallback={<ChartCard title="内容形态分布" loading>{null}</ChartCard>}>
                  <CmsContentTypeDonut
                    data={stats?.contentTypeDistribution}
                    loading={loading}
                  />
                </Suspense>
              </div>
            </div>

            <Card title="热门内容 TOP10（按浏览量）" bodyStyle={{ padding: 0 }} style={{ marginTop: 12 }}>
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
          </Spin>
        </>
      ) : (
        <Banner type="warning" description="使用数据看板需要 CMS 看板查询和站点查询权限。" />
      )}
    </div>
  );
}
