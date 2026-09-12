import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Empty, List, Spin, Typography } from '@douyinfe/semi-ui';
import { Archive, BookOpen, CalendarClock, FileCheck2, FileClock, FileText, Flame, MessageSquare, SearchX, TrendingUp, UserRound, UserX } from 'lucide-react';
import {
  AreaChart, BarChart, EmptyChart, StatCard, StatGrid, chartOptions, isEmptyValues,
  makeAreaSpec, makeBarSpec, useChartPalette,
} from '@/components/charts';
import { RefreshButton } from '@/components/toolbar-controls';
import {
  useWikiContributors, useWikiHotDocs, useWikiOpsStats, useWikiStaleDocs, useWikiStatsOverview,
} from '@/hooks/queries/wiki-stats';
import { shortDate } from '@/utils/date';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const { Text } = Typography;

export default function WikiStatsPage() {
  const navigate = useNavigate();
  const palette = useChartPalette();
  const overviewQuery = useWikiStatsOverview();
  const hotDocsQuery = useWikiHotDocs(10);
  const contributorsQuery = useWikiContributors(10);
  const staleDocsQuery = useWikiStaleDocs(10);
  const opsQuery = useWikiOpsStats();

  const overview = overviewQuery.data;
  const ops = opsQuery.data;
  const refreshing = overviewQuery.isFetching || hotDocsQuery.isFetching
    || contributorsQuery.isFetching || staleDocsQuery.isFetching || opsQuery.isFetching;

  function handleRefresh() {
    void overviewQuery.refetch();
    void hotDocsQuery.refetch();
    void contributorsQuery.refetch();
    void staleDocsQuery.refetch();
    void opsQuery.refetch();
  }

  const trendSpec = useMemo(() => makeAreaSpec({
    data: ops?.createdTrend ?? [],
    xField: 'date',
    series: [{ field: 'count', name: '新建文档', color: palette.primary }],
    palette,
    fillOpacity: 0.24,
    axis: { xLabel: shortDate },
    tooltip: { title: (value) => `日期：${value}`, value: (value) => `${value} 篇` },
  }), [ops?.createdTrend, palette]);

  const spaceSpec = useMemo(() => makeBarSpec({
    data: ops?.spaceDistribution ?? [],
    xField: 'spaceName',
    series: [{ field: 'count', name: '文档数', color: palette.active }],
    palette,
    horizontal: true,
    barMinHeight: 3,
    cornerRadius: 5,
    showLabel: true,
    categoryAxisWidth: 96,
    tooltip: { value: (value) => `${value} 篇` },
  }), [ops?.spaceDistribution, palette]);

  const searchRate = ops && ops.searchCount30d > 0
    ? `${(((ops.searchCount30d - ops.noResultCount30d) / ops.searchCount30d) * 100).toFixed(1)}%`
    : EMPTY_PLACEHOLDER;

  return (
    <div className="page-container zx-flat-panels">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <RefreshButton onClick={handleRefresh} loading={refreshing} />
      </div>

      <Spin spinning={overviewQuery.isPending}>
        <StatGrid>
          <StatCard title="知识空间" value={overview?.spaceCount ?? 0} icon={<BookOpen size={16} />} />
          <StatCard title="文档总数" value={overview?.docCount ?? 0} icon={<FileText size={16} />} />
          <StatCard title="已发布" value={overview?.publishedCount ?? 0} icon={<FileCheck2 size={16} />} />
          <StatCard title="待审核" value={overview?.pendingCount ?? 0} icon={<FileClock size={16} />} />
          <StatCard title="评论数" value={overview?.commentCount ?? 0} icon={<MessageSquare size={16} />} />
          <StatCard title="本周新增文档" value={overview?.weekNewDocs ?? 0} icon={<TrendingUp size={16} />} />
          <StatCard title="本周浏览量" value={overview?.weekViews ?? 0} icon={<Flame size={16} />} />
        </StatGrid>
      </Spin>

      <Spin spinning={opsQuery.isPending}>
        <StatGrid style={{ marginTop: 16 }}>
          <StatCard title="近 30 天搜索量" value={ops?.searchCount30d ?? 0} sub={`搜索成功率 ${searchRate}`} icon={<SearchX size={16} />} />
          <StatCard title="近 30 天审核" value={`${ops?.approvedCount30d ?? 0} / ${ops?.rejectedCount30d ?? 0}`} sub="通过 / 驳回" icon={<FileCheck2 size={16} />} />
          <StatCard
            title="审核积压"
            value={ops?.pendingBacklog ?? 0}
            icon={<FileClock size={16} />}
            accent={ops && ops.pendingBacklog > 0 ? 'var(--semi-color-warning)' : undefined}
          />
          <StatCard
            title="已过期文档"
            value={ops?.expiredCount ?? 0}
            icon={<CalendarClock size={16} />}
            accent={ops && ops.expiredCount > 0 ? 'var(--semi-color-danger)' : undefined}
          />
          <StatCard title="待复审" value={ops?.reviewDueCount ?? 0} icon={<CalendarClock size={16} />} />
          <StatCard title="无负责人" value={ops?.noOwnerCount ?? 0} icon={<UserX size={16} />} />
          <StatCard title="已归档" value={ops?.archivedCount ?? 0} icon={<Archive size={16} />} />
        </StatGrid>
      </Spin>

      <div className="chart-grid" style={{ marginTop: 16 }}>
        <Card title="近 30 天新建文档趋势">
          {isEmptyValues(ops?.createdTrend ?? []) ? <EmptyChart height={240} /> : (
            <AreaChart {...trendSpec} options={chartOptions} height={240} />
          )}
        </Card>
        <Card title="空间文档分布">
          {(ops?.spaceDistribution.length ?? 0) === 0 ? <EmptyChart height={240} /> : (
            <BarChart {...spaceSpec} options={chartOptions} height={240} />
          )}
        </Card>
      </div>

      <div className="chart-grid chart-grid--3" style={{ marginTop: 16 }}>
        <Card title="热门文档 Top 10">
          <List
            loading={hotDocsQuery.isFetching}
            dataSource={hotDocsQuery.data ?? []}
            emptyContent={<Empty description="暂无数据" />}
            renderItem={(item, idx) => (
              <List.Item
                main={(
                  <div style={{ minWidth: 0 }}>
                    <Text
                      link
                      ellipsis={{ showTooltip: true }}
                      style={{ width: '100%' }}
                      onClick={() => navigate(`/wiki/docs?docId=${item.id}`)}
                    >
                      {idx + 1}. {item.title}
                    </Text>
                    <div><Text type="tertiary" size="small">{item.spaceName}</Text></div>
                  </div>
                )}
                extra={<Text type="tertiary">{item.viewCount} 次浏览</Text>}
              />
            )}
          />
        </Card>

        <Card title="贡献榜 Top 10">
          <List
            loading={contributorsQuery.isFetching}
            dataSource={contributorsQuery.data ?? []}
            emptyContent={<Empty description="暂无数据" />}
            renderItem={(item, idx) => (
              <List.Item
                main={(
                  <Text>
                    {idx + 1}. <UserRound size={13} style={{ verticalAlign: -2 }} /> {item.nickname}
                  </Text>
                )}
                extra={<Text type="tertiary">{item.docCount} 篇</Text>}
              />
            )}
          />
        </Card>

        <Card title="沉睡文档（90 天未更新）">
          <List
            loading={staleDocsQuery.isFetching}
            dataSource={staleDocsQuery.data ?? []}
            emptyContent={<Empty description="没有沉睡文档，保持得很好" />}
            renderItem={(item) => (
              <List.Item
                main={(
                  <div style={{ minWidth: 0 }}>
                    <Text ellipsis={{ showTooltip: true }} style={{ width: '100%' }}>{item.title}</Text>
                    <div><Text type="tertiary" size="small">{item.spaceName}</Text></div>
                  </div>
                )}
                extra={<Text type="tertiary" size="small">{item.updatedAt}</Text>}
              />
            )}
          />
        </Card>
      </div>
    </div>
  );
}
