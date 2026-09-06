/**
 * 行为中心阶段 1：数据质量看板 —— 埋点质量日聚合明细 + 租户级事件启停覆盖管理。
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Form, Select, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { AlertTriangle, ShieldAlert } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { config } from '@/config';
import {
  analyticsKeys,
  useAnalyticsEventOverrides,
  useAnalyticsQuality,
  useDeleteAnalyticsEventOverride,
  useSaveAnalyticsEventOverride,
} from '@/hooks/queries/analytics';
import type { AnalyticsEventOverride, AnalyticsQualityDaily, AnalyticsQualityIssueType } from '@zenith/shared/analytics';
import { ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS, ANALYTICS_QUALITY_ISSUE_TYPE_LABELS, ANALYTICS_QUALITY_ISSUE_TYPE_OPTIONS } from '@zenith/shared/analytics';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';
import { dateColumn, dateTimeColumn } from '@/utils/table-columns';
import { ANALYTICS_ISSUE_TAG_COLOR } from './analytics-tag-colors';

const PAGE_SIZE = 20;
const DAY_OPTIONS = [7, 30, 90].map((value) => ({ value, label: `${value} 天` }));

interface QualityFilter {
  days: number;
  eventName: string;
  issueType?: AnalyticsQualityIssueType;
}
const defaultQualityFilter: QualityFilter = { days: 30, eventName: '', issueType: undefined };

interface OverrideFilter {
  eventName: string;
  status?: AnalyticsEventOverride['status'];
}
const defaultOverrideFilter: OverrideFilter = { eventName: '', status: undefined };

type OverrideFormValues = { eventName: string; status: AnalyticsEventOverride['status']; reason: string | null };

export default function AnalyticsQualityTab() {
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<QualityFilter>(defaultQualityFilter);
  const [submittedFilter, setSubmittedFilter] = useState<QualityFilter>(defaultQualityFilter);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);

  const [overrideFilter, setOverrideFilter] = useState<OverrideFilter>(defaultOverrideFilter);
  const [submittedOverrideFilter, setSubmittedOverrideFilter] = useState<OverrideFilter>(defaultOverrideFilter);
  const [overridePage, setOverridePage] = useState(1);
  const [overridePageSize, setOverridePageSize] = useState(PAGE_SIZE);

  const qualityQuery = useAnalyticsQuality({
    days: submittedFilter.days,
    eventName: submittedFilter.eventName || undefined,
    issueType: submittedFilter.issueType || undefined,
    page,
    pageSize,
  });
  const qualityItems = qualityQuery.data?.items ?? [];
  const qualityTotal = qualityQuery.data?.totalCount ?? 0;
  const totals = qualityQuery.data?.totals ?? [];
  const totalsByType = new Map(totals.map((t) => [t.issueType, t.count]));

  const overrideQuery = useAnalyticsEventOverrides({
    page: overridePage,
    pageSize: overridePageSize,
    eventName: submittedOverrideFilter.eventName || undefined,
    status: submittedOverrideFilter.status || undefined,
  }, config.multiTenantMode);
  const overrideList = overrideQuery.data?.list ?? [];
  const overrideTotal = overrideQuery.data?.total ?? 0;

  const saveOverrideMutation = useSaveAnalyticsEventOverride();
  const deleteOverrideMutation = useDeleteAnalyticsEventOverride();
  const overrideModal = useEditModal<AnalyticsEventOverride, OverrideFormValues, { eventName: string; status: AnalyticsEventOverride['status']; reason: string | null }>({
    entityName: '事件覆盖',
    save: saveOverrideMutation,
    defaults: { eventName: '', status: 'disabled', reason: null },
    toValues: (record) => ({ eventName: record.eventName, status: record.status, reason: record.reason }),
    beforeSave: (values) => ({ eventName: values.eventName.trim(), status: values.status, reason: values.reason?.trim() || null }),
  });

  const handleSearch = () => {
    setPage(1);
    setSubmittedFilter(filter);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.quality });
  };
  const handleReset = () => {
    setFilter(defaultQualityFilter);
    setSubmittedFilter(defaultQualityFilter);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.quality });
  };

  const handleOverrideSearch = () => {
    setOverridePage(1);
    setSubmittedOverrideFilter(overrideFilter);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.overridesLists });
  };
  const handleOverrideReset = () => {
    setOverrideFilter(defaultOverrideFilter);
    setSubmittedOverrideFilter(defaultOverrideFilter);
    setOverridePage(1);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.overridesLists });
  };

  const handleOverrideDelete = async (record: AnalyticsEventOverride) => {
    await deleteOverrideMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('删除成功');
  };

  const qualityColumns: ColumnProps<AnalyticsQualityDaily>[] = [
    dateColumn('日期', 'statDate'),
    { title: '事件名', dataIndex: 'eventName', width: 180, render: (value: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{value}</Typography.Text> },
    {
      title: '问题类型',
      dataIndex: 'issueType',
      width: 140,
      render: (value: AnalyticsQualityIssueType) => <Tag color={ANALYTICS_ISSUE_TAG_COLOR[value]} size="small">{ANALYTICS_QUALITY_ISSUE_TYPE_LABELS[value]}</Tag>,
    },
    { title: '次数', dataIndex: 'count', width: 90, align: 'right' },
    {
      title: '样例（脱敏）',
      dataIndex: 'sample',
      render: (value: Record<string, unknown> | null) => (
        <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 320, display: 'block' }}>
          {value ? JSON.stringify(value) : '–'}
        </Typography.Text>
      ),
    },
    dateTimeColumn('最近发生', 'lastSeenAt'),
  ];

  const overrideColumns: ColumnProps<AnalyticsEventOverride>[] = [
    { title: '事件名', dataIndex: 'eventName', width: 200 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: AnalyticsEventOverride['status']) => (
        <Tag color={value === 'enabled' ? 'green' : 'red'} size="small">
          {ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS.find((o) => o.value === value)?.label ?? value}
        </Tag>
      ),
    },
    { title: '原因', dataIndex: 'reason', render: (value: string | null) => value || '–' },
    dateTimeColumn('更新时间', 'updatedAt'),
    createOperationColumn<AnalyticsEventOverride>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        { key: 'edit', label: '编辑', onClick: () => overrideModal.openEdit(record) },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            confirmDelete({
              title: `确定删除事件「${record.eventName}」的覆盖规则吗？`,
              onOk: () => handleOverrideDelete(record),
            });
          },
        },
      ],
    }),
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <StatGrid minItemWidth={180}>
        {ANALYTICS_QUALITY_ISSUE_TYPE_OPTIONS.map((option) => (
          <StatCard
            key={option.value}
            title={option.label}
            value={totalsByType.get(option.value) ?? 0}
            icon={<AlertTriangle size={16} />}
            accent="var(--semi-color-warning)"
          />
        ))}
      </StatGrid>

      <div>
        <Typography.Title heading={6} style={{ marginBottom: 12 }}>质量明细（按日 / 事件 / 问题类型）</Typography.Title>
        <SearchToolbar>
          <Select value={filter.days} onChange={(value) => setFilter((prev) => ({ ...prev, days: Number(value) }))} optionList={DAY_OPTIONS} style={{ width: 110 }} />
          <KeywordInput placeholder="事件名" value={filter.eventName} onChange={(value) => setFilter((prev) => ({ ...prev, eventName: value }))} onSearch={handleSearch} width={160} />
          <FilterSelect
            placeholder="全部问题类型"
            items={ANALYTICS_QUALITY_ISSUE_TYPE_OPTIONS}
            value={filter.issueType}
            onChange={(value) => setFilter((prev) => ({ ...prev, issueType: value as AnalyticsQualityIssueType | undefined }))}
            width={160}
          />
          <SearchButton onClick={handleSearch} />
          <ResetButton onClick={handleReset} />
        </SearchToolbar>
        <ConfigurableTable
          bordered
          rowKey="id"
          loading={qualityQuery.isFetching}
          columns={qualityColumns}
          dataSource={qualityItems}
          onRefresh={() => void qualityQuery.refetch()}
          refreshLoading={qualityQuery.isFetching}
          pagination={{
            currentPage: page,
            pageSize,
            total: qualityTotal,
            onPageChange: (p) => setPage(p),
            onPageSizeChange: (ps) => { setPage(1); setPageSize(ps); },
          }}
          empty="暂无质量问题"
        />
      </div>

      <div>
        <Typography.Title heading={6} style={{ marginBottom: 12 }}>
          <Space spacing={6}><ShieldAlert size={16} />租户事件启停覆盖</Space>
        </Typography.Title>
        {!config.multiTenantMode ? (
          // 未启用多租户时覆盖规则不生效，只保留说明，不渲染整套无法使用的查询/新增操作面
          <Typography.Text type="tertiary">当前未启用多租户模式，请直接在事件字典中管理全局状态。</Typography.Text>
        ) : (
          <>
            <SearchToolbar>
              <KeywordInput placeholder="事件名" value={overrideFilter.eventName} onChange={(value) => setOverrideFilter((prev) => ({ ...prev, eventName: value }))} onSearch={handleOverrideSearch} width={160} />
              <StatusSelect
                items={ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS}
                value={overrideFilter.status}
                onChange={(value) => setOverrideFilter((prev) => ({ ...prev, status: value as AnalyticsEventOverride['status'] | undefined }))}
              />
              <SearchButton onClick={handleOverrideSearch} />
              <ResetButton onClick={handleOverrideReset} />
              <CreateButton onClick={overrideModal.openCreate}>新增覆盖</CreateButton>
            </SearchToolbar>
            <ConfigurableTable
              bordered
              rowKey="id"
              loading={overrideQuery.isFetching}
              columns={overrideColumns}
              dataSource={overrideList}
              onRefresh={() => void overrideQuery.refetch()}
              refreshLoading={overrideQuery.isFetching}
              pagination={{
                currentPage: overridePage,
                pageSize: overridePageSize,
                total: overrideTotal,
                onPageChange: (p) => setOverridePage(p),
                onPageSizeChange: (ps) => { setOverridePage(1); setOverridePageSize(ps); },
              }}
              empty="当前租户暂无覆盖规则"
            />
          </>
        )}
      </div>

      <AppModal
        {...overrideModal.modalProps}
        width={480}
      >
        <Form key={overrideModal.formKey} {...overrideModal.formProps}>
          <Form.Input field="eventName" label="事件名" placeholder="如 order_submit" disabled={overrideModal.isEdit} rules={[{ required: true, message: '请输入事件名' }]} />
          <Form.Select field="status" label="状态" optionList={ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS} style={{ width: '100%' }} />
          <Form.TextArea field="reason" label="原因" placeholder="启停原因（可选，便于审计追溯）" maxCount={256} />
        </Form>
      </AppModal>
    </div>
  );
}
