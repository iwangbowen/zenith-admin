import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Spin, Typography, Empty } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { useCmsDashboardStats } from '@/hooks/queries/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { DataBar } from '@/components/data-viz/DataBar';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

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
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const statsQuery = useCmsDashboardStats(siteId);
  const stats = statsQuery.data;

  const maxTrend = Math.max(1, ...(stats?.publishTrend ?? []).map((t) => t.count));
  const maxChannel = Math.max(1, ...(stats?.channelDistribution ?? []).map((c) => c.count));

  const topColumns: ColumnProps<NonNullable<typeof stats>['topViewed'][number]>[] = [
    {
      title: '标题',
      dataIndex: 'title',
      render: (v: string, record) => (
        <Typography.Text
          link
          ellipsis={{ showTooltip: true }}
          style={{ maxWidth: 300 }}
          onClick={() => navigate(`/cms/contents/edit?id=${record.id}&siteId=${siteId}`)}
        >
          {v}
        </Typography.Text>
      ),
    },
    { title: '栏目', dataIndex: 'channelName', width: 140, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    { title: '浏览量', dataIndex: 'viewCount', width: 100, align: 'right' },
  ];

  return (
    <div className="page-container zx-flat-panels">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={setSiteId} width={200} />
      </SearchToolbar>

      <Spin spinning={statsQuery.isFetching && !stats}>
        {/* 状态统计卡片 */}
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

        {/* 发布趋势（近 14 天） */}
        <Card title="发布趋势（近 14 天）" style={{ marginTop: 12 }} bodyStyle={{ padding: '16px 20px' }}>
          {stats && stats.publishTrend.some((t) => t.count > 0) ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140 }}>
              {stats.publishTrend.map((t) => (
                <div key={t.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 0 }}>
                  <span style={{ fontSize: 11, color: 'var(--semi-color-text-2)' }}>{t.count > 0 ? t.count : ''}</span>
                  <div
                    title={`${t.date}：${t.count} 篇`}
                    style={{
                      width: '60%',
                      height: `${Math.max(2, Math.round((t.count / maxTrend) * 100))}px`,
                      background: t.count > 0 ? 'var(--semi-color-primary)' : 'var(--semi-color-fill-1)',
                      borderRadius: 'var(--semi-border-radius-small)',
                    }}
                  />
                  <span style={{ fontSize: 11, color: 'var(--semi-color-text-3)', whiteSpace: 'nowrap' }}>{t.date.slice(5)}</span>
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
                stats.channelDistribution.map((ch) => (
                  <div key={ch.channelId} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
                      <span>{ch.channelName}</span>
                      <span style={{ color: 'var(--semi-color-text-2)' }}>{ch.count}</span>
                    </div>
                    <DataBar value={ch.count} max={maxChannel} track="var(--semi-color-fill-0)" />
                  </div>
                ))
              ) : (
                <Empty description="暂无内容" style={{ padding: '24px 0' }} />
              )}
          </Card>
        </div>
      </Spin>
    </div>
  );
}
