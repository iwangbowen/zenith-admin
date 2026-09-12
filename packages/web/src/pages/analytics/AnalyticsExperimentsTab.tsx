
import { useEffect, useMemo, useState } from 'react';
import { compactParams } from '@/lib/query';
import { useListSearch } from '@/hooks/useListSearch';
import { Banner, Button, Col, Form, Input, InputNumber, Modal, Row, SideSheet, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, Trash2 } from 'lucide-react';
import type { AnalyticsExperiment, AnalyticsExperimentReportVariant, AnalyticsExperimentVariant, CreateAnalyticsExperimentInput } from '@zenith/shared/analytics';
import { DataBar } from '@/components/data-viz/DataBar';
import { ANALYTICS_EXPERIMENT_STATUS_LABELS, ANALYTICS_EXPERIMENT_STATUS_OPTIONS } from '@zenith/shared/analytics';
import { AppModal } from '@/components/AppModal';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { analyticsKeys, useAnalyticsEventMeta, useCreateExperiment, useDeleteExperiment, useExperimentAction, useExperimentReport, useExperiments, useUpdateExperiment } from '@/hooks/queries/analytics';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { useEditModal } from '@/hooks/useEditModal';
import { FormSliderInput } from '@/components/SliderInput';
import { dateTimeColumn } from '@/utils/table-columns';
import { confirmDelete } from '@/utils/confirm';
import { abortSubmit } from '@/lib/abort-submit';
import { trimToNull } from './analytics-format';
import { ListSearchToolbar } from '@/components/list-page';

const PAGE_SIZE = 20;
const defaultSearch = { name: '', status: undefined as AnalyticsExperiment['status'] | undefined };
const defaultVariants: AnalyticsExperimentVariant[] = [
  { key: 'control', name: '对照组', weight: 50 },
  { key: 'treatment', name: '实验组', weight: 50 },
];
const STATUS_COLOR: Record<AnalyticsExperiment['status'], 'grey' | 'green' | 'orange' | 'blue'> = {
  draft: 'grey', running: 'green', paused: 'orange', completed: 'blue',
};

/** 极小 p 值不展示为 0.0000——那会被误读为「精确等于 0」 */
function formatPValue(value: number): string {
  return value < 0.0001 ? '<0.0001' : value.toFixed(4);
}

/**
 * 显著性结论必须区分三种状态，不能只有「显著 / 不显著」二元：
 * 正态近似不成立时 p 值本身不可信，此时报「不显著」会误导使用者停止实验。
 */
function significanceTag(record: AnalyticsExperimentReportVariant) {
  if (record.isControl) return <Typography.Text type="tertiary">基准</Typography.Text>;
  if (record.pValue == null) return <Typography.Text type="tertiary">数据不足</Typography.Text>;
  if (!record.normalApproxValid) {
    return (
      <Space spacing={4}>
        <Tag size="small" color="orange">样本过少</Tag>
        <Typography.Text type="tertiary" size="small">p 值不可信</Typography.Text>
      </Space>
    );
  }
  return (
    <Space spacing={4}>
      <Tag size="small" color={record.significant ? 'green' : 'grey'}>{record.significant ? '显著' : '不显著'}</Tag>
      <Typography.Text type="tertiary" size="small">p={formatPValue(record.pValue)}</Typography.Text>
    </Space>
  );
}

type ExperimentFormValues = {
  expKey: string;
  name: string;
  description?: string | null;
  status?: AnalyticsExperiment['status'];
  trafficAllocation: number;
  metricEventName: string;
  /** DatePicker 产出 Date，编辑回填时是接口返回的字符串，提交前统一归一 */
  startAt?: Date | string | null;
  endAt?: Date | string | null;
};

/**
 * 表单时间值 → 接口的 `YYYY-MM-DD HH:mm:ss`；留空表示不限，需明确传 null。
 *
 * 导出供单测：漏掉 `instanceof Date` 分支不会报错，Date 会被 JSON 序列化成带 `Z` 的
 * ISO 串，后端按本地时区解析后产生数小时偏移——构建、类型检查、页面渲染全都正常。
 */
export function toApiDateTime(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return formatDateTimeForApi(value);
  return trimToNull(value);
}

function windowText(record: AnalyticsExperiment) {
  if (!record.startAt && !record.endAt) return '手动控制';
  return `${record.startAt ? formatDateTime(record.startAt) : '立即'} ~ ${record.endAt ? formatDateTime(record.endAt) : '不限'}`;
}

/** 新增 / 编辑共用载荷：运行中的实验只允许改名称 / 描述 / 结束时间，其余字段不随表单提交 */
type ExperimentPayload = Partial<CreateAnalyticsExperimentInput>;

function normalizePayload(values: ExperimentFormValues, variants: AnalyticsExperimentVariant[], editing: AnalyticsExperiment | null): ExperimentPayload {
  const payload: ExperimentPayload = {
    expKey: values.expKey?.trim(),
    name: values.name?.trim(),
    description: trimToNull(values.description),
    status: values.status ?? editing?.status ?? 'draft',
    trafficAllocation: values.trafficAllocation ?? 100,
    variants,
    metricEventName: values.metricEventName?.trim(),
    startAt: toApiDateTime(values.startAt),
    endAt: toApiDateTime(values.endAt),
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
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams: submitted,
    handleSearch, handleReset,
  } = useListSearch<typeof defaultSearch>({ defaults: defaultSearch, listKey: analyticsKeys.data.experimentsLists, pageSize: PAGE_SIZE });
  const [variants, setVariants] = useState<AnalyticsExperimentVariant[]>(defaultVariants);
  const [reporting, setReporting] = useState<AnalyticsExperiment | null>(null);

  // 已提交筛选 → 契约查询参数：只映射一次
  const params = useMemo(() => ({
    page,
    pageSize,
    ...compactParams({ name: submitted.name, status: submitted.status }),
  }), [page, pageSize, submitted]);
  const listQuery = useExperiments(params);
  const metaQuery = useAnalyticsEventMeta({ page: 1, pageSize: 100, status: 'active' });
  const createMutation = useCreateExperiment();
  const updateMutation = useUpdateExperiment();
  const deleteMutation = useDeleteExperiment();
  const startMutation = useExperimentAction('start');
  const pauseMutation = useExperimentAction('pause');
  const completeMutation = useExperimentAction('complete');
  const reportQuery = useExperimentReport(reporting?.id, {}, !!reporting);
  const experimentModal = useEditModal<AnalyticsExperiment, ExperimentFormValues, ExperimentPayload>({
    save: {
      mutateAsync: ({ id, values }) => (
        id ? updateMutation.mutateAsync({ params: { id }, body: values }) : createMutation.mutateAsync({ body: values as CreateAnalyticsExperimentInput })
      ),
      isPending: createMutation.isPending || updateMutation.isPending,
    },
    defaults: { status: 'draft', trafficAllocation: 100, metricEventName: 'order_submit' },
    toValues: (record) => ({
      expKey: record.expKey,
      name: record.name,
      description: record.description,
      status: record.status,
      trafficAllocation: record.trafficAllocation,
      metricEventName: record.metricEventName,
      startAt: record.startAt,
      endAt: record.endAt,
    }),
    beforeSave: (values, { editing }) => {
      if (variants.length < 2 || variants.length > 6) { Toast.error('变体数量必须为 2-6 个'); abortSubmit('invalid_variants_count'); }
      if (new Set(variants.map((item) => item.key)).size !== variants.length) { Toast.error('变体 key 不能重复'); abortSubmit('duplicate_variant_key'); }
      if (weightTotal !== 100) { Toast.error('变体权重总和必须等于 100'); abortSubmit('invalid_variant_weight'); }
      return normalizePayload(values, variants, editing);
    },
    labelWidth: 90,
  });

  const list = listQuery.data?.list ?? [];
  const weightTotal = variants.reduce((sum, item) => sum + Number(item.weight || 0), 0);
  const metricOptions = (metaQuery.data?.list ?? []).map((item) => ({ label: `${item.displayName || item.eventName} (${item.eventName})`, value: item.eventName }));

  useEffect(() => {
    if (!experimentModal.visible) return;
    setVariants(experimentModal.editing ? experimentModal.editing.variants.map((item) => ({ ...item })) : defaultVariants.map((item) => ({ ...item })));
  }, [experimentModal.editing, experimentModal.visible]);

  const updateVariant = (index: number, patch: Partial<AnalyticsExperimentVariant>) => {
    setVariants((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const columns: ColumnProps<AnalyticsExperiment>[] = [
    { title: '实验标识', dataIndex: 'expKey', width: 150, fixed: 'left', render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
    { title: '名称', dataIndex: 'name', minWidth: 180 },
    { title: '流量%', dataIndex: 'trafficAllocation', width: 90, render: (value: number) => `${value}%` },
    { title: '变体数', dataIndex: 'variants', width: 90, render: (items: AnalyticsExperimentVariant[]) => items.length },
    { title: '指标事件', dataIndex: 'metricEventName', width: 170, render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
    { title: '运行窗口', dataIndex: 'window', width: 280, render: (_: unknown, record) => windowText(record) },
    dateTimeColumn('更新时间', 'updatedAt'),
    // 固定列必须连续贴在两端：状态若夹在中间，会被抽到右侧固定层，原位留下空洞，表头表体错位
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (value: AnalyticsExperiment['status']) => <Tag color={STATUS_COLOR[value]} size="small">{ANALYTICS_EXPERIMENT_STATUS_LABELS[value]}</Tag> },
    createOperationColumn<AnalyticsExperiment>({
      width: 240,
      desktopInlineKeys: ['report', 'toggle', 'edit'],
      actions: (record) => [
        { key: 'report', label: '报告', onClick: () => setReporting(record) },
        ...(record.status === 'running'
          ? [{ key: 'toggle', label: '暂停', loading: pauseMutation.isPending, onClick: () => pauseMutation.mutate({ params: { id: record.id } }) }]
          : record.status === 'draft' || record.status === 'paused'
            ? [{ key: 'toggle', label: '启动', loading: startMutation.isPending, onClick: () => startMutation.mutate({ params: { id: record.id } }) }]
            : []),
        { key: 'edit', label: '编辑', disabled: record.status === 'completed', onClick: () => experimentModal.openEdit(record) },
        {
          key: 'complete', label: '完成', hidden: record.status === 'running' || record.status === 'completed',
          onClick: () => { Modal.confirm({ title: '确定完成该实验吗？', content: '完成后不可继续启动。', onOk: () => completeMutation.mutate({ params: { id: record.id } }) }); },
        },
        {
          key: 'delete', label: '删除', danger: true, disabled: record.status === 'running', disabledReason: '运行中的实验不能删除',
          onClick: () => { confirmDelete({ title: '确定要删除该实验吗？', content: '删除后不可恢复', onOk: () => deleteMutation.mutate({ params: { id: record.id } }) }); },
        },
      ],
    }),
  ];

  const reportRows = reportQuery.data?.variants ?? [];
  const maxRate = Math.max(...reportRows.map((item) => item.conversionRate), 1);
  const report = reportQuery.data ?? null;
  const controlRow = reportRows.find((row) => row.isControl) ?? null;
  // 曝光量未达估算样本量时，「不显著」只说明样本不够，不能解读为「没有效果」
  const underPowered = report?.requiredSamplePerVariant != null
    && reportRows.some((row) => row.exposures < report.requiredSamplePerVariant!);

  return (
    <>
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="实验名称" {...bindKeyword('name')} />}
        filters={<StatusSelect items={ANALYTICS_EXPERIMENT_STATUS_OPTIONS} {...bind('status')} />}
        onSearch={handleSearch}
        onReset={handleReset}
        create={<CreateButton onClick={experimentModal.openCreate} />}
      />

      <ConfigurableTable
        bordered rowKey="id" loading={listQuery.isFetching} columns={columns} dataSource={list}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} empty="暂无实验"
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />

      <AppModal {...experimentModal.modalProps} title={experimentModal.isEdit ? '编辑 A/B 实验' : '新增 A/B 实验'} width={660}>
        <Form key={experimentModal.formKey} {...experimentModal.formProps}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="expKey" label="实验标识" disabled={experimentModal.isEdit} placeholder="如 homepage_banner" style={{ width: '100%' }} rules={[{ required: !experimentModal.isEdit, message: '请输入实验标识' }, { pattern: /^[a-z][a-z0-9_-]*$/, message: '以小写字母开头，仅允许小写字母、数字、下划线和中划线' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="name" label="名称" placeholder="实验名称" style={{ width: '100%' }} rules={[{ required: true, message: '请输入名称' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="status" label="状态" optionList={ANALYTICS_EXPERIMENT_STATUS_OPTIONS} style={{ width: '100%' }} />
            </Col>
          </Row>
          <FormSliderInput
            field="trafficAllocation"
            label="参与流量"
            suffix="%"
            min={0}
            max={100}
            step={1}
            disabled={experimentModal.editing?.status === 'running'}
            showBoundary
            aria-label="实验参与流量"
            getAriaValueText={(value) => `${value}%`}
          />
          {/* 事件名可能很长（如 member.points.expired），并排会被截断，故独占整行 */}
          <Form.Select field="metricEventName" label="转化事件" optionList={metricOptions} filter allowCreate disabled={experimentModal.editing?.status === 'running'} placeholder="选择或输入事件名" style={{ width: '100%' }} />
          <Row gutter={16}>
            <Col span={12}>
              <Form.DatePicker field="startAt" label="开始时间" type="dateTime" disabled={experimentModal.editing?.status === 'running'} placeholder="留空手动启动" style={{ width: '100%' }} />
            </Col>
            <Col span={12}>
              <Form.DatePicker field="endAt" label="结束时间" type="dateTime" placeholder="留空不限" style={{ width: '100%' }} />
            </Col>
          </Row>
          <Form.TextArea field="description" label="描述" maxCount={500} autosize={{ minRows: 2, maxRows: 3 }} />
        </Form>
        <div style={{ marginTop: 12, marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography.Text strong>变体配置</Typography.Text>
          <Space>
            <Tag color={weightTotal === 100 ? 'green' : 'red'}>权重合计 {weightTotal}%</Tag>
            <Button size="small" icon={<Plus size={14} />} disabled={experimentModal.editing?.status === 'running' || variants.length >= 6} onClick={() => setVariants((prev) => [...prev, { key: `variant${prev.length + 1}`, name: `变体 ${prev.length + 1}`, weight: 0 }])}>添加变体</Button>
          </Space>
        </div>
        {/* 变体最多 6 个：超过 4 个时区域内部滚动，锁住弹窗高度上限，避免确定按钮被顶出视口 */}
        <div style={{ display: 'grid', gap: 8, ...(variants.length > 4 ? { maxHeight: 200, overflowY: 'auto', paddingRight: 4 } : null) }}>
          {variants.map((variant, index) => (
            <div key={`${variant.key}-${index}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr) 96px 32px', gap: 8, alignItems: 'center' }}>
              <Input value={variant.key} disabled={experimentModal.editing?.status === 'running'} placeholder="key" onChange={(key) => updateVariant(index, { key })} />
              <Input value={variant.name} disabled={experimentModal.editing?.status === 'running'} placeholder="名称" onChange={(name) => updateVariant(index, { name })} />
              <InputNumber value={variant.weight} suffix="%" disabled={experimentModal.editing?.status === 'running'} min={0} max={100} onChange={(weight) => updateVariant(index, { weight: Number(weight) || 0 })} style={{ width: '100%' }} />
              <Button
                theme="borderless"
                type="danger"
                icon={<Trash2 size={14} />}
                aria-label={`删除变体 ${variant.name || variant.key}`}
                disabled={experimentModal.editing?.status === 'running' || variants.length <= 2}
                onClick={() => setVariants((prev) => prev.filter((_, i) => i !== index))}
              />
            </div>
          ))}
        </div>
      </AppModal>

      <SideSheet title={reporting ? `实验报告：${reporting.name}` : '实验报告'} visible={!!reporting} onCancel={() => setReporting(null)} width={860}>
        {report?.srm?.mismatch && (
          <Banner
            type="danger"
            closeIcon={null}
            title="分流异常（SRM）"
            description={`实际曝光分布与配置权重显著不符（χ²=${report.srm.chiSquare}，p=${formatPValue(report.srm.pValue)}）。请先排查分流逻辑，本次转化率对比结果不可信。`}
            style={{ marginBottom: 12 }}
          />
        )}
        {underPowered && (
          <Banner
            type="warning"
            closeIcon={null}
            title="样本量不足"
            description={`按对照组当前转化率估算，检测 10% 相对提升需每组约 ${report!.requiredSamplePerVariant!.toLocaleString()} 次曝光。当前未达该量级时，"不显著"只代表证据不足，不代表没有效果。`}
            style={{ marginBottom: 12 }}
          />
        )}
        <ConfigurableTable
          bordered rowKey="variantKey" loading={reportQuery.isFetching} dataSource={reportRows}
          columns={[
            { title: '变体', dataIndex: 'variantKey', width: 150, render: (value: string, record) => (
              <Space spacing={4}>
                <Typography.Text code>{value}</Typography.Text>
                {record.isControl && <Tag size="small" color="grey">对照组</Tag>}
              </Space>
            ) },
            { title: '曝光用户', dataIndex: 'exposures', width: 100, align: 'right', render: (value: number) => value.toLocaleString() },
            { title: '转化用户', dataIndex: 'conversions', width: 100, align: 'right', render: (value: number) => value.toLocaleString() },
            { title: '转化率', dataIndex: 'conversionRate', width: 220, align: 'right', render: (value: number) => <Space style={{ width: '100%' }}><Typography.Text style={{ width: 56 }}>{value.toFixed(1)}%</Typography.Text><DataBar value={value} max={maxRate} style={{ width: 140 }} /></Space> },
            { title: '相对提升', dataIndex: 'relativeUplift', width: 110, align: 'right', render: (value: number | null, record) => (
              record.isControl ? <Typography.Text type="tertiary">基准</Typography.Text>
                : value == null ? '–'
                  : <Typography.Text type={value > 0 ? 'success' : value < 0 ? 'danger' : undefined}>{value > 0 ? '+' : ''}{value.toFixed(1)}%</Typography.Text>
            ) },
            { title: '95% 置信区间', dataIndex: 'confidenceLow', width: 190, align: 'right', render: (_: unknown, record) => (
              record.isControl || record.confidenceLow == null || record.confidenceHigh == null
                ? <Typography.Text type="tertiary">–</Typography.Text>
                : <Typography.Text size="small">{`[${record.confidenceLow.toFixed(2)}, ${record.confidenceHigh.toFixed(2)}] pp`}</Typography.Text>
            ) },
            { title: '显著性', dataIndex: 'pValue', width: 210, render: (_: unknown, record) => significanceTag(record) },
          ]}
          onRefresh={() => void reportQuery.refetch()} refreshLoading={reportQuery.isFetching} empty="暂无报告数据"
        />
        {controlRow && (
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 10 }}>
            对照组为变体列表首项（{controlRow.variantKey}）。显著性基于双比例 Z 检验（双尾，α=0.05）；
            置信区间为与对照组转化率差值的区间，单位为百分点（pp），跨 0 表示差异不显著。
          </Typography.Text>
        )}
      </SideSheet>
    </>
  );
}
