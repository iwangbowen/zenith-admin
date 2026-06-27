import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Button, Form, Input, Modal, Select, Switch, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import type {
  CreateReportAlertInput,
  PaginatedResponse,
  ReportAlertAggregate,
  ReportAlertOp,
  ReportAlertRule,
  ReportDataset,
} from '@zenith/shared';

interface SearchParams {
  keyword: string;
  datasetId: string;
  enabled: string;
}

const defaultSearchParams: SearchParams = { keyword: '', datasetId: '', enabled: '' };

const aggregateOptions: Array<{ value: ReportAlertAggregate; label: string }> = [
  { value: 'sum', label: '求和 sum' },
  { value: 'avg', label: '平均 avg' },
  { value: 'max', label: '最大 max' },
  { value: 'min', label: '最小 min' },
  { value: 'count', label: '计数 count' },
  { value: 'first', label: '首值 first' },
];

const opOptions: Array<{ value: ReportAlertOp; label: string }> = [
  { value: 'gt', label: '> 大于' },
  { value: 'gte', label: '≥ 大于等于' },
  { value: 'lt', label: '< 小于' },
  { value: 'lte', label: '≤ 小于等于' },
  { value: 'eq', label: '= 等于' },
  { value: 'neq', label: '≠ 不等于' },
];

const opSymbolMap: Record<ReportAlertOp, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  neq: '≠',
};

const channelLabelMap: Record<'email' | 'inApp', string> = {
  email: '邮件',
  inApp: '站内信',
};

function formatRule(record: ReportAlertRule) {
  return `${record.aggregate}(${record.aggregate === 'count' ? '*' : record.field || '-'}) ${opSymbolMap[record.op]} ${record.threshold}`;
}

export default function AlertsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<PaginatedResponse<ReportAlertRule> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  const [datasets, setDatasets] = useState<ReportDataset[]>([]);
  const datasetFieldMap = useMemo(() => {
    const map = new Map<number, ReportDataset['fields']>();
    datasets.forEach((dataset) => map.set(dataset.id, dataset.fields ?? []));
    return map;
  }, [datasets]);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportAlertRule | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());
  const [selectedDatasetId, setSelectedDatasetId] = useState<number | null>(null);
  const [selectedAggregate, setSelectedAggregate] = useState<ReportAlertAggregate>('sum');
  const [selectedChannels, setSelectedChannels] = useState<Array<'email' | 'inApp'>>(['inApp']);

  const selectedFields = selectedDatasetId ? datasetFieldMap.get(selectedDatasetId) ?? [] : [];

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const active = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const q: Record<string, string> = { page: String(p), pageSize: String(ps) };
      if (active.keyword) q.keyword = active.keyword;
      if (active.datasetId) q.datasetId = active.datasetId;
      if (active.enabled) q.enabled = String(active.enabled === 'enabled');
      const res = await request.get<PaginatedResponse<ReportAlertRule>>(`/api/report/alerts?${new URLSearchParams(q)}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
        setPageSize(res.data.pageSize);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
    request.get<PaginatedResponse<ReportDataset>>('/api/report/datasets?page=1&pageSize=200').then((res) => {
      if (res.code === 0) setDatasets(res.data.list.filter((dataset) => dataset.status === 'enabled'));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() {
    setPage(1);
    void fetchList(1, pageSize);
  }

  function handleReset() {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchList(1, pageSize, defaultSearchParams);
  }

  function openCreate() {
    setEditing(null);
    setSelectedDatasetId(null);
    setSelectedAggregate('sum');
    setSelectedChannels(['inApp']);
    setModalVisible(true);
  }

  function openEdit(record: ReportAlertRule) {
    setEditing(record);
    setSelectedDatasetId(record.datasetId);
    setSelectedAggregate(record.aggregate);
    setSelectedChannels(record.channels);
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditing(null);
  }

  const initValues = editing
    ? {
        name: editing.name,
        datasetId: editing.datasetId,
        aggregate: editing.aggregate,
        field: editing.field ?? undefined,
        op: editing.op,
        threshold: editing.threshold,
        cron: editing.cron ?? '',
        channels: editing.channels,
        recipients: editing.recipients ?? '',
        enabled: editing.enabled ? 'enabled' : 'disabled',
        remark: editing.remark ?? '',
      }
    : { aggregate: 'sum', op: 'gt', channels: ['inApp'], enabled: 'enabled' };

  function buildPayload(values: Record<string, unknown>): CreateReportAlertInput {
    const aggregate = values.aggregate as ReportAlertAggregate;
    const channels = (values.channels ?? []) as Array<'email' | 'inApp'>;
    return {
      name: String(values.name ?? ''),
      datasetId: Number(values.datasetId),
      field: aggregate === 'count' ? null : (values.field ? String(values.field) : null),
      aggregate,
      op: values.op as ReportAlertOp,
      threshold: Number(values.threshold),
      cron: values.cron ? String(values.cron) : null,
      channels,
      recipients: values.recipients ? String(values.recipients) : undefined,
      enabled: values.enabled === 'enabled',
      remark: values.remark ? String(values.remark) : undefined,
    };
  }

  async function handleOk() {
    let values: Record<string, unknown>;
    try { values = await formApi.current?.validate() as Record<string, unknown>; } catch { throw new Error('validation'); }
    const payload = buildPayload(values);
    setSubmitting(true);
    try {
      const res = editing
        ? await request.put<ReportAlertRule>(`/api/report/alerts/${editing.id}`, payload, { silent: true })
        : await request.post<ReportAlertRule>('/api/report/alerts', payload, { silent: true });
      if (res.code === 0) {
        Toast.success(editing ? '更新成功' : '创建成功');
        closeModal();
        void fetchList();
      } else {
        Toast.error(res.message || '保存失败');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleToggleEnabled(record: ReportAlertRule, checked: boolean) {
    const doToggle = async () => {
      setTogglingIds((prev) => new Set(prev).add(record.id));
      try {
        const res = await request.put<ReportAlertRule>(`/api/report/alerts/${record.id}`, { enabled: checked }, { silent: true });
        if (res.code === 0) {
          Toast.success(checked ? '已启用' : '已停用');
          void fetchList();
        } else {
          Toast.error(res.message || '状态更新失败');
        }
      } finally {
        setTogglingIds((prev) => { const next = new Set(prev); next.delete(record.id); return next; });
      }
    };
    if (checked) void doToggle();
    else Modal.confirm({ title: '确认停用', content: `停用后「${record.name}」将不再自动评估，确认停用？`, onOk: () => void doToggle() });
  }

  async function handleEvaluate(id: number) {
    const res = await request.post<{ value: number; triggered: boolean }>(`/api/report/alerts/${id}/evaluate`, undefined, { silent: true });
    if (res.code === 0) {
      Toast.success(`实际值 ${res.data.value}，${res.data.triggered ? '已触发' : '未触发'}`);
      void fetchList();
    } else {
      Toast.error(res.message || '评估失败');
    }
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/report/alerts/${id}`, undefined, { silent: true });
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchList();
    } else {
      Toast.error(res.message || '删除失败');
    }
  }

  const columns: ColumnProps<ReportAlertRule>[] = [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '数据集', dataIndex: 'datasetName', width: 160, render: (value: string) => value || '-' },
    { title: '规则', dataIndex: 'id', width: 180, render: (_: unknown, record: ReportAlertRule) => formatRule(record) },
    {
      title: '通道',
      dataIndex: 'channels',
      width: 140,
      render: (channels: Array<'email' | 'inApp'>) => (channels ?? []).map((channel) => (
        <Tag key={channel} size="small" color={channel === 'email' ? 'blue' : 'green'} style={{ marginRight: 4 }}>
          {channelLabelMap[channel]}
        </Tag>
      )),
    },
    {
      title: '最近触发',
      dataIndex: 'lastTriggered',
      width: 190,
      render: (_: unknown, record: ReportAlertRule) => (
        <Tooltip content={record.lastCheckedAt ? `最近评估：${formatDateTime(record.lastCheckedAt)}` : '尚未评估'}>
          <span>
            <Tag color={record.lastTriggered ? 'red' : 'grey'} size="small" style={{ marginRight: 6 }}>
              {record.lastTriggered ? '已触发' : '正常'}
            </Tag>
            <Typography.Text type="tertiary" size="small">
              {record.lastValue == null ? '—' : `值 ${record.lastValue}`}
            </Typography.Text>
          </span>
        </Tooltip>
      ),
    },
    { title: '备注', dataIndex: 'remark', width: 180, render: renderEllipsis },
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 80,
      fixed: 'right',
      render: (_: unknown, record: ReportAlertRule) => (
        <Switch
          checked={record.enabled}
          loading={togglingIds.has(record.id)}
          disabled={!hasPermission('report:alert:update')}
          onChange={(checked) => handleToggleEnabled(record, checked)}
          size="small"
        />
      ),
    },
    createOperationColumn<ReportAlertRule>({
      width: 170,
      desktopInlineKeys: ['evaluate', 'edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('report:alert:list') ? [{ key: 'evaluate', label: '评估', onClick: () => void handleEvaluate(record.id) }] : []),
        ...(hasPermission('report:alert:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(record) }] : []),
        ...(hasPermission('report:alert:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => { Modal.confirm({ title: '确定要删除吗？', content: '删除后不可恢复', onOk: () => handleDelete(record.id) }); },
        }] : []),
      ],
    }),
  ];

  const renderKeyword = () => (
    <Input prefix={<Search size={14} />} placeholder="搜索名称/备注" value={searchParams.keyword}
      onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: value }))} showClear style={{ width: 200 }} onEnterPress={handleSearch} />
  );
  const renderDatasetFilter = () => (
    <Select placeholder="全部数据集" value={searchParams.datasetId || undefined} onChange={(value) => setSearchParams((prev) => ({ ...prev, datasetId: value ? String(value) : '' }))}
      showClear filter style={{ width: 180 }} optionList={datasets.map((dataset) => ({ value: String(dataset.id), label: dataset.name }))} />
  );
  const renderStatusFilter = () => (
    <Select placeholder="全部状态" value={searchParams.enabled || undefined} onChange={(value) => setSearchParams((prev) => ({ ...prev, enabled: (value as string) ?? '' }))}
      showClear style={{ width: 120 }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
  );
  const renderSearchBtn = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetBtn = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateBtn = () => hasPermission('report:alert:create')
    ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}{renderDatasetFilter()}{renderStatusFilter()}{renderSearchBtn()}{renderResetBtn()}</>}
        actions={renderCreateBtn()}
        mobilePrimary={<>{renderKeyword()}{renderSearchBtn()}{renderCreateBtn()}</>}
        mobileFilters={<>{renderDatasetFilter()}{renderStatusFilter()}</>}
        filterTitle="预警筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无预警"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
      />

      <AppModal title={editing ? '编辑预警' : '新增预警'} visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: submitting }} width={560}>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={initValues} labelPosition="left" labelWidth={90}
          onValueChange={(values) => {
            const nextDatasetId = values.datasetId ? Number(values.datasetId) : null;
            if (nextDatasetId !== selectedDatasetId) {
              setSelectedDatasetId(nextDatasetId);
              formApi.current?.setValue('field', undefined);
            }
            const nextAggregate = (values.aggregate ?? 'sum') as ReportAlertAggregate;
            setSelectedAggregate(nextAggregate);
            if (nextAggregate === 'count') formApi.current?.setValue('field', undefined);
            setSelectedChannels(((values.channels ?? []) as Array<'email' | 'inApp'>));
          }}
        >
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={64} showClear />
          <Form.Select field="datasetId" label="数据集" style={{ width: '100%' }} rules={[{ required: true, message: '请选择数据集' }]} filter
            optionList={datasets.map((dataset) => ({ value: dataset.id, label: dataset.name }))} />
          <Form.Select field="aggregate" label="聚合方式" style={{ width: '100%' }} optionList={aggregateOptions} />
          <Form.Select field="field" label="监控字段" style={{ width: '100%' }} disabled={selectedAggregate === 'count'}
            placeholder={selectedAggregate === 'count' ? 'count 不需要选择字段' : '请选择监控字段'}
            rules={selectedAggregate === 'count' ? [] : [{ required: true, message: '请选择监控字段' }]}
            optionList={selectedFields.map((field) => ({ value: field.name, label: field.label ? `${field.label}（${field.name}）` : field.name }))} />
          <Form.Select field="op" label="运算符" style={{ width: '100%' }} optionList={opOptions} />
          <Form.InputNumber field="threshold" label="阈值" style={{ width: '100%' }} rules={[{ required: true, message: '请输入阈值' }]} />
          <Form.Input field="cron" label="评估Cron" placeholder="0 */5 * * * *" helpText="留空=仅手动" showClear />
          <Form.Select field="channels" label="通知通道" multiple style={{ width: '100%' }} rules={[{ required: true, message: '至少选择一个通道' }]}
            optionList={[{ value: 'email', label: '邮件' }, { value: 'inApp', label: '站内信' }]} />
          {selectedChannels.includes('email') && (
            <Form.Input field="recipients" label="收件人邮箱" placeholder="多个用逗号分隔" showClear />
          )}
          <Form.Select field="enabled" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
          <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
        </Form>
      </AppModal>
    </div>
  );
}
