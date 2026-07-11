
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, InputNumber, Modal, Popconfirm, Progress, Select, SideSheet, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { AnalyticsExperiment, AnalyticsExperimentVariant } from '@zenith/shared';
import { ANALYTICS_EXPERIMENT_STATUS_LABELS, ANALYTICS_EXPERIMENT_STATUS_OPTIONS } from '@zenith/shared';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { analyticsKeys, useAnalyticsEventMeta, useCreateExperiment, useDeleteExperiment, useExperimentAction, useExperimentReport, useExperiments, useUpdateExperiment } from '@/hooks/queries/analytics';
import { formatDateTime } from '@/utils/date';

const PAGE_SIZE = 20;
const defaultSearch = { name: '', status: '' as '' | AnalyticsExperiment['status'] };
const defaultVariants: AnalyticsExperimentVariant[] = [
  { key: 'control', name: '对照组', weight: 50 },
  { key: 'treatment', name: '实验组', weight: 50 },
];
const STATUS_COLOR: Record<AnalyticsExperiment['status'], 'grey' | 'green' | 'orange' | 'blue'> = {
  draft: 'grey', running: 'green', paused: 'orange', completed: 'blue',
};

type ExperimentFormValues = {
  expKey: string;
  name: string;
  description?: string | null;
  status?: AnalyticsExperiment['status'];
  trafficAllocation: number;
  metricEventName: string;
  startAt?: string | null;
  endAt?: string | null;
};

function trimToNull(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function windowText(record: AnalyticsExperiment) {
  if (!record.startAt && !record.endAt) return '手动控制';
  return `${record.startAt ? formatDateTime(record.startAt) : '立即'} ~ ${record.endAt ? formatDateTime(record.endAt) : '不限'}`;
}

function normalizePayload(values: ExperimentFormValues, variants: AnalyticsExperimentVariant[], editing: AnalyticsExperiment | null) {
  const payload: Record<string, unknown> = {
    expKey: values.expKey?.trim(),
    name: values.name?.trim(),
    description: trimToNull(values.description),
    status: values.status ?? editing?.status ?? 'draft',
    trafficAllocation: values.trafficAllocation ?? 100,
    variants,
    metricEventName: values.metricEventName?.trim(),
    startAt: trimToNull(values.startAt),
    endAt: trimToNull(values.endAt),
  };
  if (editing?.status === 'running') {
    delete payload.expKey;
    delete payload.trafficAllocation;
    delete payload.variants;
    delete payload.metricEventName;
    delete payload.startAt;
  }
  return payload;
}

export default function AnalyticsExperimentsTab() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [draft, setDraft] = useState(defaultSearch);
  const [submitted, setSubmitted] = useState(defaultSearch);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<AnalyticsExperiment | null>(null);
  const [variants, setVariants] = useState<AnalyticsExperimentVariant[]>(defaultVariants);
  const [reporting, setReporting] = useState<AnalyticsExperiment | null>(null);
  const formApi = useRef<FormApi | null>(null);

  const params = useMemo(() => ({ page, pageSize, name: submitted.name || undefined, status: submitted.status || undefined }), [page, pageSize, submitted]);
  const listQuery = useExperiments(params);
  const metaQuery = useAnalyticsEventMeta({ page: 1, pageSize: 100, status: 'active' });
  const createMutation = useCreateExperiment();
  const updateMutation = useUpdateExperiment();
  const deleteMutation = useDeleteExperiment();
  const startMutation = useExperimentAction('start');
  const pauseMutation = useExperimentAction('pause');
  const completeMutation = useExperimentAction('complete');
  const reportQuery = useExperimentReport(reporting?.id, {}, !!reporting);

  const list = listQuery.data?.list ?? [];
  const weightTotal = variants.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const metricOptions = (metaQuery.data?.list ?? []).map((item) => ({ label: `${item.displayName || item.eventName} (${item.eventName})`, value: item.eventName }));

  useEffect(() => {
    if (!modalVisible) return;
    setVariants(editing ? editing.variants.map((item) => ({ ...item })) : defaultVariants.map((item) => ({ ...item })));
  }, [editing, modalVisible]);

  const handleSearch = () => {
    setPage(1);
    setSubmitted(draft);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.experimentsLists });
  };
  const handleReset = () => {
    setDraft(defaultSearch);
    setSubmitted(defaultSearch);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: analyticsKeys.data.experimentsLists });
  };

  const openCreate = () => { setEditing(null); setModalVisible(true); };
  const openEdit = (record: AnalyticsExperiment) => { setEditing(record); setModalVisible(true); };

  const formInit: Partial<ExperimentFormValues> = editing ? {
    expKey: editing.expKey,
    name: editing.name,
    description: editing.description,
    status: editing.status,
    trafficAllocation: editing.trafficAllocation,
    metricEventName: editing.metricEventName,
    startAt: editing.startAt,
    endAt: editing.endAt,
  } : { status: 'draft', trafficAllocation: 100, metricEventName: 'order_submit' };

  const updateVariant = (index: number, patch: Partial<AnalyticsExperimentVariant>) => {
    setVariants((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const handleSubmit = async () => {
    const values = await formApi.current?.validate() as ExperimentFormValues | undefined;
    if (!values) return;
    if (variants.length < 2 || variants.length > 6) { Toast.error('变体数量必须为 2-6 个'); return; }
    if (new Set(variants.map((item) => item.key)).size !== variants.length) { Toast.error('变体 key 不能重复'); return; }
    if (weightTotal !== 100) { Toast.error('变体权重总和必须等于 100'); return; }
    const payload = normalizePayload(values, variants, editing);
    if (editing) await updateMutation.mutateAsync({ id: editing.id, values: payload });
    else await createMutation.mutateAsync(payload);
    Toast.success(editing ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditing(null);
  };

  const actionButton = (record: AnalyticsExperiment) => {
    if (record.status === 'running') {
      return <Button theme="borderless" size="small" loading={pauseMutation.isPending} onClick={() => pauseMutation.mutate(record.id)}>暂停</Button>;
    }
    if (record.status === 'draft' || record.status === 'paused') {
      return <Button theme="borderless" size="small" loading={startMutation.isPending} onClick={() => startMutation.mutate(record.id)}>启动</Button>;
    }
    return <Button theme="borderless" size="small" disabled>已完成</Button>;
  };

  const columns: ColumnProps<AnalyticsExperiment>[] = [
    { title: '实验标识', dataIndex: 'expKey', width: 150, fixed: 'left', render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (value: AnalyticsExperiment['status']) => <Tag color={STATUS_COLOR[value]} size="small">{ANALYTICS_EXPERIMENT_STATUS_LABELS[value]}</Tag> },
    { title: '流量%', dataIndex: 'trafficAllocation', width: 90, render: (value: number) => `${value}%` },
    { title: '变体数', dataIndex: 'variants', width: 90, render: (items: AnalyticsExperimentVariant[]) => items.length },
    { title: '指标事件', dataIndex: 'metricEventName', width: 170, render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
    { title: '运行窗口', dataIndex: 'window', width: 280, render: (_: unknown, record) => windowText(record) },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170, render: (value: string) => formatDateTime(value) },
    { title: '操作', dataIndex: 'operation', width: 260, fixed: 'right', render: (_: unknown, record) => (
      <Space>
        <Button theme="borderless" size="small" onClick={() => setReporting(record)}>报告</Button>
        {actionButton(record)}
        <Button theme="borderless" size="small" disabled={record.status === 'completed'} onClick={() => openEdit(record)}>编辑</Button>
        {record.status === 'running' || record.status === 'completed' ? null : (
          <Popconfirm title="确定完成该实验吗？完成后不可继续启动。" onConfirm={() => completeMutation.mutate(record.id)}>
            <Button theme="borderless" size="small" loading={completeMutation.isPending}>完成</Button>
          </Popconfirm>
        )}
        <Popconfirm title="确定要删除该实验吗？" onConfirm={() => deleteMutation.mutate(record.id)}>
          <Button theme="borderless" type="danger" size="small" disabled={record.status === 'running'} loading={deleteMutation.isPending}>删除</Button>
        </Popconfirm>
      </Space>
    ) },
  ];

  const reportRows = reportQuery.data?.variants ?? [];
  const maxRate = Math.max(...reportRows.map((item) => item.conversionRate), 1);

  return (
    <>
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="实验名称" value={draft.name} onChange={(name) => setDraft((prev) => ({ ...prev, name }))} showClear style={{ width: 220 }} />
        <Select placeholder="状态" value={draft.status || undefined} optionList={ANALYTICS_EXPERIMENT_STATUS_OPTIONS} onChange={(status) => setDraft((prev) => ({ ...prev, status: (status as AnalyticsExperiment['status']) ?? '' }))} showClear style={{ width: 130 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
      </SearchToolbar>

      <ConfigurableTable
        bordered rowKey="id" loading={listQuery.isFetching} columns={columns} dataSource={list}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} scroll={{ x: 1580 }} empty="暂无实验"
        pagination={{ currentPage: page, pageSize, total: listQuery.data?.total ?? 0, onPageChange: setPage, onPageSizeChange: (next) => { setPage(1); setPageSize(next); } }}
      />

      <Modal title={editing ? '编辑 A/B 实验' : '新增 A/B 实验'} visible={modalVisible} onCancel={() => { setModalVisible(false); setEditing(null); }} onOk={() => void handleSubmit()} okButtonProps={{ loading: createMutation.isPending || updateMutation.isPending }} width={760} closeOnEsc>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInit} labelPosition="left" labelWidth={120} allowEmpty>
          <Form.Input field="expKey" label="实验标识" disabled={!!editing} placeholder="如 homepage_banner" rules={[{ required: !editing, message: '请输入实验标识' }, { pattern: /^[a-z][a-z0-9_-]*$/, message: '以小写字母开头，仅允许小写字母、数字、下划线和中划线' }]} />
          <Form.Input field="name" label="名称" placeholder="实验名称" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.TextArea field="description" label="描述" maxCount={500} autosize={{ minRows: 2, maxRows: 4 }} />
          <Form.Select field="status" label="状态" optionList={ANALYTICS_EXPERIMENT_STATUS_OPTIONS} style={{ width: '100%' }} />
          <Form.InputNumber field="trafficAllocation" label="参与流量%" min={0} max={100} disabled={editing?.status === 'running'} style={{ width: '100%' }} />
          <Form.Select field="metricEventName" label="转化事件" optionList={metricOptions} filter disabled={editing?.status === 'running'} placeholder="选择或输入事件名" style={{ width: '100%' }} />
          <Form.Input field="startAt" label="开始时间" disabled={editing?.status === 'running'} placeholder="YYYY-MM-DD HH:mm:ss，留空手动启动" />
          <Form.Input field="endAt" label="结束时间" placeholder="YYYY-MM-DD HH:mm:ss，留空不限" />
        </Form>
        <div style={{ marginTop: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography.Text strong>变体配置</Typography.Text>
          <Space>
            <Tag color={weightTotal === 100 ? 'green' : 'red'}>权重合计 {weightTotal}%</Tag>
            <Button size="small" icon={<Plus size={14} />} disabled={editing?.status === 'running' || variants.length >= 6} onClick={() => setVariants((prev) => [...prev, { key: `variant${prev.length + 1}`, name: `变体 ${prev.length + 1}`, weight: 0 }])}>添加变体</Button>
          </Space>
        </div>
        <Space vertical align="start" style={{ width: '100%' }}>
          {variants.map((variant, index) => (
            <Space key={`${variant.key}-${index}`} wrap>
              <Input value={variant.key} disabled={editing?.status === 'running'} placeholder="key" onChange={(key) => updateVariant(index, { key })} style={{ width: 150 }} />
              <Input value={variant.name} disabled={editing?.status === 'running'} placeholder="名称" onChange={(name) => updateVariant(index, { name })} style={{ width: 180 }} />
              <InputNumber value={variant.weight} disabled={editing?.status === 'running'} min={0} max={100} onChange={(weight) => updateVariant(index, { weight: Number(weight) || 0 })} style={{ width: 120 }} />
              <Button theme="borderless" type="danger" icon={<Trash2 size={14} />} disabled={editing?.status === 'running' || variants.length <= 2} onClick={() => setVariants((prev) => prev.filter((_, i) => i !== index))}>删除</Button>
            </Space>
          ))}
        </Space>
      </Modal>

      <SideSheet title={reporting ? `实验报告：${reporting.name}` : '实验报告'} visible={!!reporting} onCancel={() => setReporting(null)} width={720}>
        <ConfigurableTable
          bordered rowKey="variantKey" loading={reportQuery.isFetching} dataSource={reportRows}
          columns={[
            { title: '变体', dataIndex: 'variantKey', render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
            { title: '曝光用户', dataIndex: 'exposures' },
            { title: '转化用户', dataIndex: 'conversions' },
            { title: '转化率', dataIndex: 'conversionRate', render: (value: number) => <Space style={{ width: '100%' }}><Typography.Text style={{ width: 56 }}>{value.toFixed(1)}%</Typography.Text><Progress percent={Math.round((value / maxRate) * 100)} showInfo={false} style={{ width: 160 }} /></Space> },
          ]}
          onRefresh={() => void reportQuery.refetch()} refreshLoading={reportQuery.isFetching} empty="暂无报告数据"
        />
      </SideSheet>
    </>
  );
}
