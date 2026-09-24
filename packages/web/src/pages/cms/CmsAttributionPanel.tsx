import dayjs from 'dayjs';
import { Banner, Card, Typography } from '@douyinfe/semi-ui';
import { CMS_ATTRIBUTION_EVENT_LABELS, cmsOperationsContract, type CmsAttribution } from '@zenith/shared/cms';
import { useCmsAttribution } from '@/hooks/queries/cms-operations';
import { useListSearch } from '@/hooks/useListSearch';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { contractKey } from '@/lib/contract-query';
import { ListSearchToolbar } from '@/components/list-page';
import { NumberFilter } from '@/components/search-filters';
import ConfigurableTable from '@/components/ConfigurableTable';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { formatDateTimeForApi } from '@/utils/date';

export default function CmsAttributionPanel({ siteId, days }: Readonly<{ siteId?: number; days: number }>) {
  const filters = useListSearch<{ contentId?: number; releaseId?: number; deploymentId?: number }>({ defaults: {}, listKey: contractKey(cmsOperationsContract.attribution), resetKey: `${siteId}:${days}` });
  const query = useFilterQuery({ siteId: siteId ?? 0, ...filters.submittedParams, startTime: formatDateTimeForApi(dayjs().subtract(days - 1, 'day').startOf('day').toDate()), endTime: formatDateTimeForApi(dayjs().endOf('day').toDate()) });
  const attribution = useCmsAttribution(query);
  return <>
    <ListSearchToolbar onSearch={filters.handleSearch} onReset={filters.handleReset} filters={<><NumberFilter {...filters.bind('contentId')} placeholder="内容 ID" /><NumberFilter {...filters.bind('releaseId')} placeholder="发布版本 ID" /><NumberFilter {...filters.bind('deploymentId')} placeholder="部署 ID" /></>} />
    {attribution.isError ? <Banner type="danger" description={attribution.error.message} /> : null}
    <Typography.Paragraph type="tertiary">按入口路径、来源、内容及发布版本统计近 {days} 天的事件。表单与投票完成以服务端成功提交为准，未接入统计或无事件时显示为空。</Typography.Paragraph>
    <StatGrid>{(attribution.data?.totals ?? []).map((item) => <StatCard key={item.event} title={CMS_ATTRIBUTION_EVENT_LABELS[item.event]} value={item.count} sub={`${item.visitors} 位访客`} />)}</StatGrid>
    <Card title="入口与内容转化（事件量前 100 组）" style={{ marginTop: 16 }}>
      <ConfigurableTable<CmsAttribution['journeys'][number] & { id: number }> columns={[
        { title: '入口路径', dataIndex: 'entryPath', minWidth: 200 }, { title: '来源', dataIndex: 'source', width: 120 },
        { title: '内容', width: 180, render: (_, row) => row.contentTitle ?? (row.contentId ? `内容 #${row.contentId}` : '站点页面') },
        { title: '发布 / 部署', width: 130, render: (_, row) => `${row.releaseId ?? '—'} / ${row.deploymentId ?? '—'}` },
        { title: '阅读', dataIndex: 'reads', width: 75 }, { title: '点击', dataIndex: 'clicks', width: 75 }, { title: '下载', dataIndex: 'downloads', width: 75 }, { title: '表单', dataIndex: 'formCompletions', width: 75 }, { title: '投票', dataIndex: 'voteCompletions', width: 75 },
      ]} dataSource={(attribution.data?.journeys ?? []).map((row, id) => ({ ...row, id }))} loading={attribution.isLoading} pagination={false} onRefresh={() => void attribution.refetch()} refreshLoading={attribution.isFetching} empty="暂无可归因的转化事件" />
    </Card>
  </>;
}
