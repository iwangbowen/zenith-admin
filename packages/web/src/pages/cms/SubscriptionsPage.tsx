import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { SideSheet, TabPane, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS, CMS_SUBSCRIPTION_SUBJECT_TYPE_OPTIONS } from '@zenith/shared/cms';
import type { CmsMemberSubscription, CmsSubscriptionAggregate, CmsSubscriptionSubjectType } from '@zenith/shared/cms';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  cmsSubscriptionKeys,
  useCmsSubscriptionAggregates,
  useCmsSubscriptionList,
} from '@/hooks/queries/cms';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { CmsSiteSelect } from './CmsSiteSelect';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import { dateTimeColumn } from '@/utils/table-columns';

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { listTableProps } from '@/components/list-page';
interface SearchState {
  subjectType?: CmsSubscriptionSubjectType;
  subjectKeyword: string;
  timeRange?: [Date, Date];
}

const initialSearch: SearchState = { subjectKeyword: '' };

export default function SubscriptionsPage() {
  const [activeTab, setActiveTab] = useUrlTabState(['aggregate', 'detail'] as const, 'aggregate');
  const queryClient = useQueryClient();
  const { hasPermission } = usePermission();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [siteId, setSiteId] = useState<number | undefined>();
  const [draft, setDraft] = useState<SearchState>(initialSearch);
  const [submitted, setSubmitted] = useState<SearchState>(initialSearch);
  const [detail, setDetail] = useState<CmsMemberSubscription | null>(null);
  const query = {
    siteId: siteId ?? 0,
    subjectType: submitted.subjectType,
    subjectKeyword: submitted.subjectKeyword || undefined,
    ...formatDateTimeRangeForApi(submitted.timeRange),
  };
  const listQuery = useCmsSubscriptionList({ ...query, page, pageSize }, !!siteId);
  const aggregateQuery = useCmsSubscriptionAggregates(query, !!siteId);

  const handleSearch = () => {
    setPage(1);
    setSubmitted(draft);
    void queryClient.invalidateQueries({ queryKey: cmsSubscriptionKeys.lists });
  };

  const handleReset = () => {
    setPage(1);
    setDraft(initialSearch);
    setSubmitted(initialSearch);
    void queryClient.invalidateQueries({ queryKey: cmsSubscriptionKeys.lists });
  };

  const filters = (
    <>
      <FilterSelect
        placeholder="全部对象类型"
        items={CMS_SUBSCRIPTION_SUBJECT_TYPE_OPTIONS}
        value={draft.subjectType}
        onChange={(value) => setDraft((current) => ({ ...current, subjectType: value as CmsSubscriptionSubjectType | undefined }))}
        width={150}
      />
      <DateRangeFilter value={draft.timeRange} onChange={(value) => setDraft((current) => ({ ...current, timeRange: value as [Date, Date] | undefined }))} width={330} />
    </>
  );

  const primary = (
    <>
      <CmsSiteSelect value={siteId} onChange={(value) => { setSiteId(value); setPage(1); }} />
      <KeywordInput placeholder="订阅对象" value={draft.subjectKeyword} onChange={(value) => setDraft((current) => ({ ...current, subjectKeyword: value }))} onSearch={handleSearch} width={200} />
      {filters}
      <SearchButton onClick={handleSearch} />
      <ResetButton onClick={handleReset} />
    </>
  );

  const detailColumns: ColumnProps<CmsMemberSubscription>[] = [
    { title: '会员', dataIndex: 'memberDisplay', width: 140 },
    { title: '站点', dataIndex: 'siteName', minWidth: 160 },
    {
      title: '类型', dataIndex: 'subjectType', width: 90,
      render: (value: CmsSubscriptionSubjectType) => <Tag size="small">{CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS[value]}</Tag>,
    },
    { title: '订阅对象', dataIndex: 'subjectLabel', width: 220 },
    {
      title: '通知', dataIndex: 'notificationEnabled', width: 80,
      render: (value: boolean) => value ? '开启' : '关闭',
    },
    dateTimeColumn('订阅时间', 'createdAt'),
    createOperationColumn<CmsMemberSubscription>({
      width: 100,
      desktopInlineKeys: ['view'],
      actions: (record) => [{ key: 'view', label: '查看', onClick: () => setDetail(record) }],
    }),
  ];

  const aggregateColumns: ColumnProps<CmsSubscriptionAggregate>[] = [
    {
      title: '类型', dataIndex: 'subjectType', width: 100,
      render: (value: CmsSubscriptionSubjectType) => <Tag size="small">{CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS[value]}</Tag>,
    },
    { title: '订阅对象', dataIndex: 'subjectLabel', width: 260 },
    { title: '订阅人数', dataIndex: 'subscriberCount', width: 120, align: 'right' },
    { title: '开启通知', dataIndex: 'notificationEnabledCount', width: 120, align: 'right' },
  ];

  const exportQuery = query as Record<string, unknown>;

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" type="line" lazyRender keepDOM={false} activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
        <TabPane tab="订阅聚合" itemKey="aggregate">
          <SearchToolbar
            primary={primary}
            actions={siteId && hasPermission('cms:subscription:export') ? <ExportButton entity="cms.subscriptions" permission="cms:subscription:export" query={exportQuery} label="导出订阅明细" /> : null}
            mobilePrimary={(
              <>
                <CmsSiteSelect value={siteId} onChange={setSiteId} />
                <SearchButton onClick={handleSearch} />
              </>
            )}
            mobileFilters={filters}
            mobileActions={siteId && hasPermission('cms:subscription:export') ? <ExportButton entity="cms.subscriptions" permission="cms:subscription:export" query={exportQuery} variant="flat" /> : null}
            filterTitle="订阅筛选"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
          />
          <ConfigurableTable<CmsSubscriptionAggregate>
            columns={aggregateColumns}
            {...listTableProps(aggregateQuery, {
              rowKey: (record) => `${record?.subjectType}:${record?.subjectKey}`,
              empty: siteId ? '暂无订阅聚合' : '请先选择站点',
            })}
          />
        </TabPane>
        <TabPane tab="订阅明细" itemKey="detail">
          <SearchToolbar
            primary={primary}
            actions={siteId && hasPermission('cms:subscription:export') ? <ExportButton entity="cms.subscriptions" permission="cms:subscription:export" query={exportQuery} /> : null}
            mobilePrimary={(
              <>
                <CmsSiteSelect value={siteId} onChange={setSiteId} />
                <SearchButton onClick={handleSearch} />
              </>
            )}
            mobileFilters={filters}
            mobileActions={siteId && hasPermission('cms:subscription:export') ? <ExportButton entity="cms.subscriptions" permission="cms:subscription:export" query={exportQuery} variant="flat" /> : null}
            filterTitle="订阅筛选"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
          />
          <ConfigurableTable<CmsMemberSubscription>
            columns={detailColumns}
            {...listTableProps(listQuery, { pagination: buildPagination, empty: siteId ? '暂无订阅明细' : '请先选择站点' })}
          />
        </TabPane>
      </Tabs>

      <SideSheet title="订阅详情" visible={!!detail} onCancel={() => setDetail(null)} width={420}>
        {detail ? (
          <dl style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 12, margin: 0 }}>
            <dt>会员</dt><dd>{detail.memberDisplay}</dd>
            <dt>站点</dt><dd>{detail.siteName}</dd>
            <dt>对象类型</dt><dd>{CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS[detail.subjectType]}</dd>
            <dt>订阅对象</dt><dd>{detail.subjectLabel}</dd>
            <dt>通知状态</dt><dd>{detail.notificationEnabled ? '开启' : '关闭'}</dd>
            <dt>订阅时间</dt><dd>{detail.createdAt}</dd>
            <dt>标准化键</dt><dd><Typography.Text code>{detail.subjectKey}</Typography.Text></dd>
          </dl>
        ) : null}
      </SideSheet>
    </div>
  );
}
