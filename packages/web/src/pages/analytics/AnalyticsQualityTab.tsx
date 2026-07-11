/**
 * 行为中心阶段 1：数据质量看板 —— 埋点质量日聚合明细 + 租户级事件启停覆盖管理。
 */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Card, Form, Input, Select, Tag, Toast, Typography, Modal } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { AlertTriangle, Plus, RotateCcw, Search, ShieldAlert } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { formatDateTime } from '@/utils/date';
import { config } from '@/config';
import {
  analyticsKeys,
  useAnalyticsEventOverrides,
  useAnalyticsQuality,
  useDeleteAnalyticsEventOverride,
  useSaveAnalyticsEventOverride,
} from '@/hooks/queries/analytics';
import type { AnalyticsEventOverride, AnalyticsQualityDaily, AnalyticsQualityIssueType } from '@zenith/shared';
import { ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS, ANALYTICS_QUALITY_ISSUE_TYPE_LABELS, ANALYTICS_QUALITY_ISSUE_TYPE_OPTIONS } from '@zenith/shared';

const PAGE_SIZE = 20;
const DAY_OPTIONS = [7, 30, 90].map((value) => ({ value, label: `${value} 天` }));

const ISSUE_COLOR: Record<AnalyticsQualityIssueType, 'red' | 'orange' | 'amber' | 'grey'> = {
  missing_required: 'orange',
  type_mismatch: 'amber',
  invalid_enum: 'red',
  event_disabled: 'grey',
  origin_rejected: 'red',
  quota_exceeded: 'orange',
};

interface QualityFilter {
  days: number;
  eventName: string;
  issueType: AnalyticsQualityIssueType | '';
}
const defaultQualityFilter: QualityFilter = { days: 30, eventName: '', issueType: '' };

interface OverrideFilter {
  eventName: string;
  status: AnalyticsEventOverride['status'] | '';
}
const defaultOverrideFilter: OverrideFilter = { eventName: '', status: '' };

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
  const [overrideModalVisible, setOverrideModalVisible] = useState(false);
  const [editingOverride, setEditingOverride] = useState<AnalyticsEventOverride | null>(null);
  const overrideFormApi = useRef<FormApi | null>(null);

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

  const handleSearch = () => {
    setPage(1);
    setSubmittedFilter(filter);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.all });
  };
  const handleReset = () => {
    setFilter(defaultQualityFilter);
    setSubmittedFilter(defaultQualityFilter);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.all });
  };

  const handleOverrideSearch = () => {
    setOverridePage(1);
    setSubmittedOverrideFilter(overrideFilter);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.all });
  };
  const handleOverrideReset = () => {
    setOverrideFilter(defaultOverrideFilter);
    setSubmittedOverrideFilter(defaultOverrideFilter);
    setOverridePage(1);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.all });
  };

  const openCreateOverride = () => { setEditingOverride(null); setOverrideModalVisible(true); };
  const openEditOverride = (record: AnalyticsEventOverride) => { setEditingOverride(record); setOverrideModalVisible(true); };

  const handleOverrideSubmit = async () => {
    const api = overrideFormApi.current;
    if (!api) return;
    const values = await api.validate() as OverrideFormValues;
    const payload = { eventName: values.eventName.trim(), status: values.status, reason: values.reason?.trim() || null };
    await saveOverrideMutation.mutateAsync({ id: editingOverride?.id, values: payload });
    Toast.success(editingOverride ? '更新成功' : '创建成功');
    setOverrideModalVisible(false);
    setEditingOverride(null);
  };

  const handleOverrideDelete = async (record: AnalyticsEventOverride) => {
    await deleteOverrideMutation.mutateAsync(record.id);
    Toast.success('删除成功');
  };

  const qualityColumns: ColumnProps<AnalyticsQualityDaily>[] = [
    { title: '日期', dataIndex: 'statDate', width: 120 },
    { title: '事件名', dataIndex: 'eventName', width: 180, render: (value: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{value}</Typography.Text> },
    {
      title: '问题类型',
      dataIndex: 'issueType',
      width: 140,
      render: (value: AnalyticsQualityIssueType) => <Tag color={ISSUE_COLOR[value]} size="small">{ANALYTICS_QUALITY_ISSUE_TYPE_LABELS[value]}</Tag>,
    },
    { title: '次数', dataIndex: 'count', width: 90 },
    {
      title: '样例（脱敏）',
      dataIndex: 'sample',
      render: (value: Record<string, unknown> | null) => (
        <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 320, display: 'block' }}>
          {value ? JSON.stringify(value) : '–'}
        </Typography.Text>
      ),
    },
    { title: '最近发生', dataIndex: 'lastSeenAt', width: 180, render: (value: string | null) => (value ? formatDateTime(value) : '–') },
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
    { title: '更新时间', dataIndex: 'updatedAt', width: 180, render: (value: string) => formatDateTime(value) },
    createOperationColumn<AnalyticsEventOverride>({
      width: 130,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        { key: 'edit', label: '编辑', onClick: () => openEditOverride(record) },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: `确定删除事件「${record.eventName}」的覆盖规则吗？`,
              okButtonProps: { type: 'danger' },
              onOk: () => handleOverrideDelete(record),
            });
          },
        },
      ],
    }),
  ];

  const overrideFormInit: OverrideFormValues = editingOverride
    ? { eventName: editingOverride.eventName, status: editingOverride.status, reason: editingOverride.reason }
    : { eventName: '', status: 'disabled', reason: null };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
        {ANALYTICS_QUALITY_ISSUE_TYPE_OPTIONS.map((option) => (
          <Card key={option.value} bodyStyle={{ padding: 16 }} style={{ borderRadius: 'var(--semi-border-radius-large)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <AlertTriangle size={16} color="var(--semi-color-warning)" />
              <Typography.Text type="tertiary" size="small">{option.label}</Typography.Text>
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6 }}>{totalsByType.get(option.value) ?? 0}</div>
          </Card>
        ))}
      </div>

      <div>
        <Typography.Title heading={6} style={{ marginBottom: 12 }}>质量明细（按日 / 事件 / 问题类型）</Typography.Title>
        <SearchToolbar>
          <Select value={filter.days} onChange={(value) => setFilter((prev) => ({ ...prev, days: Number(value) }))} optionList={DAY_OPTIONS} style={{ width: 110 }} />
          <Input
            prefix={<Search size={14} />}
            placeholder="事件名"
            value={filter.eventName}
            onChange={(value) => setFilter((prev) => ({ ...prev, eventName: value }))}
            onEnterPress={handleSearch}
            showClear
            style={{ width: 160 }}
          />
          <Select
            placeholder="问题类型"
            value={filter.issueType || undefined}
            onChange={(value) => setFilter((prev) => ({ ...prev, issueType: (value as AnalyticsQualityIssueType) ?? '' }))}
            optionList={ANALYTICS_QUALITY_ISSUE_TYPE_OPTIONS}
            showClear
            style={{ width: 160 }}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
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
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><ShieldAlert size={16} />租户事件启停覆盖</span>
        </Typography.Title>
        {!config.multiTenantMode && (
          <Typography.Text type="tertiary">当前未启用多租户模式，请直接在事件字典中管理全局状态。</Typography.Text>
        )}
        <SearchToolbar>
          <Input
            prefix={<Search size={14} />}
            placeholder="事件名"
            value={overrideFilter.eventName}
            onChange={(value) => setOverrideFilter((prev) => ({ ...prev, eventName: value }))}
            onEnterPress={handleOverrideSearch}
            showClear
            style={{ width: 160 }}
          />
          <Select
            placeholder="状态"
            value={overrideFilter.status || undefined}
            onChange={(value) => setOverrideFilter((prev) => ({ ...prev, status: (value as AnalyticsEventOverride['status']) ?? '' }))}
            optionList={ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS}
            showClear
            style={{ width: 130 }}
          />
          <Button disabled={!config.multiTenantMode} type="primary" icon={<Search size={14} />} onClick={handleOverrideSearch}>查询</Button>
          <Button disabled={!config.multiTenantMode} type="tertiary" icon={<RotateCcw size={14} />} onClick={handleOverrideReset}>重置</Button>
          <Button disabled={!config.multiTenantMode} type="primary" icon={<Plus size={14} />} onClick={openCreateOverride}>新增覆盖</Button>
        </SearchToolbar>
        <ConfigurableTable
          bordered
          rowKey="id"
          loading={overrideQuery.isFetching}
          columns={overrideColumns}
          dataSource={overrideList}
          onRefresh={() => void overrideQuery.refetch()}
          refreshLoading={overrideQuery.isFetching}
          scroll={{ x: 900 }}
          pagination={{
            currentPage: overridePage,
            pageSize: overridePageSize,
            total: overrideTotal,
            onPageChange: (p) => setOverridePage(p),
            onPageSizeChange: (ps) => { setOverridePage(1); setOverridePageSize(ps); },
          }}
          empty="当前租户暂无覆盖规则"
        />
      </div>

      <AppModal
        title={editingOverride ? '编辑事件覆盖' : '新增事件覆盖'}
        visible={overrideModalVisible}
        onCancel={() => { setOverrideModalVisible(false); setEditingOverride(null); }}
        onOk={handleOverrideSubmit}
        okButtonProps={{ loading: saveOverrideMutation.isPending }}
        width={480}
        closeOnEsc
      >
        <Form
          key={editingOverride?.id ?? 'new'}
          getFormApi={(api) => { overrideFormApi.current = api; }}
          allowEmpty
          initValues={overrideFormInit}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="eventName" label="事件名" placeholder="如 order_submit" disabled={!!editingOverride} rules={[{ required: true, message: '请输入事件名' }]} />
          <Form.Select field="status" label="状态" optionList={ANALYTICS_EVENT_OVERRIDE_STATUS_OPTIONS} style={{ width: '100%' }} />
          <Form.TextArea field="reason" label="原因" placeholder="启停原因（可选，便于审计追溯）" maxCount={256} />
        </Form>
      </AppModal>
    </div>
  );
}
