import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, DatePicker, Input, Select, SideSheet, TabPane, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RotateCcw, Search } from 'lucide-react';
import {
  CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS,
  type CmsMemberSubscription,
  type CmsSubscriptionAggregate,
  type CmsSubscriptionSubjectType,
} from '@zenith/shared';
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
import { formatDateTimeForApi } from '@/utils/date';
import { CmsSiteSelect } from './CmsSiteSelect';

interface SearchState {
  subjectType?: CmsSubscriptionSubjectType;
  subjectKeyword: string;
  timeRange?: [Date, Date];
}

const initialSearch: SearchState = { subjectKeyword: '' };

export default function SubscriptionsPage() {
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
    startTime: submitted.timeRange ? formatDateTimeForApi(submitted.timeRange[0]) : undefined,
    endTime: submitted.timeRange ? formatDateTimeForApi(submitted.timeRange[1]) : undefined,
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
      <Select
        placeholder="全部对象类型"
        value={draft.subjectType}
        showClear
        style={{ width: 150 }}
        optionList={Object.entries(CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
        onChange={(value) => setDraft((current) => ({ ...current, subjectType: value as CmsSubscriptionSubjectType | undefined }))}
      />
      <DatePicker
        type="dateTimeRange"
        value={draft.timeRange}
        onChange={(value) => setDraft((current) => ({ ...current, timeRange: value as [Date, Date] | undefined }))}
        placeholder={['开始时间', '结束时间']}
        style={{ width: 330 }}
      />
    </>
  );

  const primary = (
    <>
      <CmsSiteSelect value={siteId} onChange={(value) => { setSiteId(value); setPage(1); }} />
      <Input
        prefix={<Search size={14} />}
        value={draft.subjectKeyword}
        onChange={(value) => setDraft((current) => ({ ...current, subjectKeyword: value }))}
        onEnterPress={handleSearch}
        placeholder="订阅对象"
        showClear
        style={{ width: 200 }}
      />
      {filters}
      <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
      <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
    </>
  );

  const detailColumns: ColumnProps<CmsMemberSubscription>[] = [
    { title: '会员', dataIndex: 'memberDisplay', width: 140 },
    { title: '站点', dataIndex: 'siteName', width: 160 },
    {
      title: '类型', dataIndex: 'subjectType', width: 90,
      render: (value: CmsSubscriptionSubjectType) => <Tag size="small">{CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS[value]}</Tag>,
    },
    { title: '订阅对象', dataIndex: 'subjectLabel', width: 220 },
    {
      title: '通知', dataIndex: 'notificationEnabled', width: 80,
      render: (value: boolean) => value ? '开启' : '关闭',
    },
    { title: '订阅时间', dataIndex: 'createdAt', width: 180 },
    createOperationColumn<CmsMemberSubscription>({
      width: 90,
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
      <Tabs type="line" lazyRender keepDOM={false}>
        <TabPane tab="订阅聚合" itemKey="aggregate">
          <SearchToolbar
            primary={primary}
            actions={siteId && hasPermission('cms:subscription:export') ? <ExportButton entity="cms.subscriptions" query={exportQuery} label="导出订阅明细" /> : null}
            mobilePrimary={(
              <>
                <CmsSiteSelect value={siteId} onChange={setSiteId} />
                <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
              </>
            )}
            mobileFilters={filters}
            mobileActions={siteId && hasPermission('cms:subscription:export') ? <ExportButton entity="cms.subscriptions" query={exportQuery} variant="flat" /> : null}
            filterTitle="订阅筛选"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
          />
          <ConfigurableTable
            bordered
            columns={aggregateColumns}
            dataSource={aggregateQuery.data ?? []}
            loading={aggregateQuery.isFetching}
            rowKey="subjectKey"
            empty={siteId ? '暂无订阅聚合' : '请先选择站点'}
            onRefresh={() => void aggregateQuery.refetch()}
            refreshLoading={aggregateQuery.isFetching}
            pagination={false}
          />
        </TabPane>
        <TabPane tab="订阅明细" itemKey="detail">
          <SearchToolbar
            primary={primary}
            actions={siteId && hasPermission('cms:subscription:export') ? <ExportButton entity="cms.subscriptions" query={exportQuery} /> : null}
            mobilePrimary={(
              <>
                <CmsSiteSelect value={siteId} onChange={setSiteId} />
                <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
              </>
            )}
            mobileFilters={filters}
            mobileActions={siteId && hasPermission('cms:subscription:export') ? <ExportButton entity="cms.subscriptions" query={exportQuery} variant="flat" /> : null}
            filterTitle="订阅筛选"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
          />
          <ConfigurableTable
            bordered
            columns={detailColumns}
            dataSource={listQuery.data?.list ?? []}
            loading={listQuery.isFetching}
            rowKey="id"
            empty={siteId ? '暂无订阅明细' : '请先选择站点'}
            scroll={{ x: 960 }}
            onRefresh={() => void listQuery.refetch()}
            refreshLoading={listQuery.isFetching}
            pagination={buildPagination(listQuery.data?.total ?? 0)}
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
