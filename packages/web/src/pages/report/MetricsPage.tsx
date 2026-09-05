import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banner, Button, Col, Empty, Form, Modal, Row, SideSheet, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { ReportMetric, ReportMetricType } from '@zenith/shared/report';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { flattenReportFolders, useReportFolderTree } from '@/hooks/queries/report-folders';
import {
  reportMetricKeys,
  useDeleteReportMetrics,
  useDeprecateReportMetric,
  useEvaluateReportMetric,
  usePublishReportMetric,
  useReportMetricDetail,
  useReportMetricList,
  useReportMetricRefs,
  useSaveReportMetric,
} from '@/hooks/queries/report-metrics';
import { useEnabledReportDatasets, useReportDatasetDetail } from '@/hooks/queries/report-datasets';
import { useAllUsers } from '@/hooks/queries/users';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { isRevisionConflict, metricLifecyclePayload, normalizeMetricFormValues } from './report-platform-utils';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';

interface MetricSearch {
  keyword: string;
  type?: ReportMetricType;
  status?: 'draft' | 'published' | 'deprecated';
  datasetId?: number;
  folderId?: number;
  ownerId?: number;
}

const defaultSearch: MetricSearch = { keyword: '', type: undefined, status: undefined };
const typeOptions = [
  { value: 'simple', label: '简单指标' },
  { value: 'ratio', label: '比率指标' },
  { value: 'composite', label: '复合指标' },
];
const statusOptions = [
  { value: 'draft', label: '草稿' },
  { value: 'published', label: '已发布' },
  { value: 'deprecated', label: '已废弃' },
];
const statusColor = { draft: 'grey', published: 'green', deprecated: 'red' } as const;

export default function MetricsPage() {
  const qc = useQueryClient();
  const { hasPermission } = usePermission();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draft, setDraft] = useState<MetricSearch>(defaultSearch);
  const [submitted, setSubmitted] = useState<MetricSearch>(defaultSearch);
  const [conflict, setConflict] = useState('');
  const [sheetMetric, setSheetMetric] = useState<ReportMetric | null>(null);
  const [sheetMode, setSheetMode] = useState<'preview' | 'refs'>('preview');

  const listQuery = useReportMetricList({
    page,
    pageSize,
    keyword: submitted.keyword || undefined,
    type: submitted.type || undefined,
    status: submitted.status || undefined,
    datasetId: submitted.datasetId,
    folderId: submitted.folderId,
    ownerId: submitted.ownerId,
  });
  const evaluateMutation = useEvaluateReportMetric();
  const refsQuery = useReportMetricRefs(sheetMetric?.id, !!sheetMetric && sheetMode === 'refs');
  const saveMutation = useSaveReportMetric();
  const deleteMutation = useDeleteReportMetrics();
  const publishMutation = usePublishReportMetric();
  const deprecateMutation = useDeprecateReportMetric();
  const datasetsQuery = useEnabledReportDatasets(undefined, true);
  const usersQuery = useAllUsers();
  const foldersQuery = useReportFolderTree({ resourceType: 'metric' });
  const folders = flattenReportFolders(foldersQuery.data ?? []);
  const users = usersQuery.data ?? [];
  const datasets = datasetsQuery.data ?? [];
  // 表单内选中的数据集：用其字段渲染 来源/维度/时间字段 下拉，避免手输字段名拼错
  const [formDatasetId, setFormDatasetId] = useState<number | undefined>();
  const formDatasetDetailQuery = useReportDatasetDetail(formDatasetId, !!formDatasetId);
  const formFieldOptions = (formDatasetDetailQuery.data?.fields ?? []).map((field) => ({
    value: field.name,
    label: field.label ? `${field.label}（${field.name}）` : field.name,
  }));

  const handleSearch = () => {
    setPage(1);
    setSubmitted(draft);
    void qc.invalidateQueries({ queryKey: reportMetricKeys.lists });
  };
  const handleReset = () => {
    setPage(1);
    setDraft(defaultSearch);
    setSubmitted(defaultSearch);
    void qc.invalidateQueries({ queryKey: reportMetricKeys.lists });
  };

  const metricSave = {
    ...saveMutation,
    mutateAsync: async (vars: { id?: number; values: ReturnType<typeof normalizeMetricFormValues> }) => {
      try {
        return await saveMutation.mutateAsync(vars);
      } catch (error) {
      if (isRevisionConflict(error)) {
        setConflict('指标已被其他人更新。请加载最新版本后重新编辑，当前输入不会自动覆盖。');
      } else {
        Toast.error(error instanceof Error ? error.message : '指标保存失败');
      }
      throw error;
      }
    },
  };
  const metricModal = useEditModal<ReportMetric, Record<string, unknown>, ReturnType<typeof normalizeMetricFormValues>>({
    entityName: '指标',
    save: metricSave,
    useDetail: useReportMetricDetail,
    defaults: { type: 'simple', aggregate: 'sum', dimensions: [] },
    labelWidth: 92,
    toValues: (record) => ({
      ...record,
      dimensions: record.dimensions,
    }),
    beforeSave: (values, { editing }) => normalizeMetricFormValues(values, editing),
    successMessage: ({ isEdit }) => isEdit ? '指标已更新' : '指标已创建',
  });
  const detailQuery = useReportMetricDetail(metricModal.editing?.id, metricModal.visible && metricModal.isEdit);
  const openCreate = () => {
    setConflict('');
    setFormDatasetId(undefined);
    metricModal.openCreate();
  };
  const openEdit = (record: ReportMetric) => {
    setConflict('');
    setFormDatasetId(record.datasetId ?? undefined);
    metricModal.openEdit(record);
  };

  const lifecycle = (record: ReportMetric, action: 'publish' | 'deprecate') => {
    Modal.confirm({
      title: action === 'publish' ? `发布指标「${record.name}」？` : `废弃指标「${record.name}」？`,
      content: action === 'deprecate' ? '废弃后引用方会看到生命周期警告，但不会阻断合法访问。' : '将以当前修订创建发布快照。',
      okButtonProps: action === 'deprecate' ? { type: 'danger', theme: 'solid' } : undefined,
      onOk: async () => {
        try {
          const mutation = action === 'publish' ? publishMutation : deprecateMutation;
          await mutation.mutateAsync({ params: { id: record.id }, body: metricLifecyclePayload(record.revision) });
          Toast.success(action === 'publish' ? '指标已发布' : '指标已废弃');
        } catch (error) {
          Toast.error(isRevisionConflict(error) ? '版本已变化，请刷新列表后重试' : (error instanceof Error ? error.message : '操作失败'));
        }
      },
    });
  };

  const openPreview = (record: ReportMetric) => {
    setSheetMetric(record);
    setSheetMode('preview');
    evaluateMutation.reset();
  };

  const columns: ColumnProps<ReportMetric>[] = [
    {
      title: '指标名称', dataIndex: 'name', minWidth: 180,
      render: (v: string, record: ReportMetric) => (
        <Typography.Text link ellipsis={{ showTooltip: true }} onClick={() => openPreview(record)}>{v}</Typography.Text>
      ),
    },
    { title: '编码', dataIndex: 'code', width: 150, render: renderEllipsis },
    { title: '数据集', dataIndex: 'datasetName', width: 160, render: renderEllipsis },
    { title: '来源/公式', width: 240, render: (_v, r) => renderEllipsis(r.type === 'simple' ? `${r.aggregate ?? 'sum'}(${r.sourceField ?? '—'})` : r.formula) },
    { title: '维度', dataIndex: 'dimensions', width: 180, render: (value: string[]) => renderEllipsis(value?.join(', ')) },
    { title: '负责人', dataIndex: 'ownerName', width: 120, render: (value) => value || '—' },
    { title: '目录', dataIndex: 'folderName', width: 140, render: (value) => value || '—' },
    { title: '修订', dataIndex: 'revision', width: 80 },
    dateTimeColumn('更新时间', 'updatedAt'),
    {
      title: '状态', dataIndex: 'lifecycleStatus', width: 100, fixed: 'right',
      render: (value: ReportMetric['lifecycleStatus']) => <Tag color={statusColor[value]}>{statusOptions.find((item) => item.value === value)?.label}</Tag>,
    },
    createOperationColumn<ReportMetric>({
      width: 180,
      desktopInlineKeys: ['preview', 'edit'],
      actions: (record) => [
        { key: 'preview', label: '预览', hidden: !hasPermission('report:metric:evaluate'), onClick: () => openPreview(record) },
        { key: 'edit', label: '编辑', hidden: !hasPermission('report:metric:update'), onClick: () => openEdit(record) },
        { key: 'refs', label: '引用关系', onClick: () => { setSheetMetric(record); setSheetMode('refs'); } },
        { key: 'publish', label: '发布', hidden: !hasPermission('report:metric:publish') || record.lifecycleStatus !== 'draft', onClick: () => lifecycle(record, 'publish') },
        { key: 'deprecate', label: '废弃', danger: true, hidden: !hasPermission('report:metric:publish') || record.lifecycleStatus !== 'published', onClick: () => lifecycle(record, 'deprecate') },
        {
          key: 'delete', label: '删除', danger: true, hidden: !hasPermission('report:metric:delete') || record.lifecycleStatus !== 'draft',
          onClick: () => confirmDelete({
            title: `删除指标「${record.name}」？`,
            content: '仅无引用的草稿指标可删除。',
            onOk: async () => {
              await deleteMutation.mutateAsync([record.id]);
              Toast.success('指标已删除');
            },
          }),
        },
      ],
    }),
  ];

  const keyword = (
    <KeywordInput placeholder="搜索指标名称/编码" value={draft.keyword} onChange={(value) => setDraft((prev) => ({ ...prev, keyword: value }))} onSearch={handleSearch} width={230} />
  );
  const filters = (
    <>
      <FilterSelect
        placeholder="全部指标类型"
        items={typeOptions}
        value={draft.type}
        onChange={(value) => setDraft((p) => ({ ...p, type: value as MetricSearch['type'] | undefined }))}
        width={140}
      />
      <FilterSelect
        placeholder="全部生命周期"
        items={statusOptions}
        value={draft.status}
        onChange={(value) => setDraft((p) => ({ ...p, status: value as MetricSearch['status'] | undefined }))}
        width={140}
      />
      <FilterSelect
        placeholder="全部数据集"
        items={datasets.map((item) => ({ value: item.id, label: item.name }))}
        value={draft.datasetId}
        onChange={(value) => setDraft((p) => ({ ...p, datasetId: value as number | undefined }))}
        width={160}
        filter
        remote
      />
      <FilterSelect
        placeholder="全部负责人"
        items={users.map((item) => ({ value: item.id, label: item.nickname || item.username }))}
        value={draft.ownerId}
        onChange={(value) => setDraft((p) => ({ ...p, ownerId: value as number | undefined }))}
        width={150}
        filter
      />
      <FilterSelect
        placeholder="全部指标目录"
        items={folders.map((item) => ({ value: item.id, label: item.name }))}
        value={draft.folderId}
        onChange={(value) => setDraft((p) => ({ ...p, folderId: value as number | undefined }))}
        width={150}
        filter
      />
    </>
  );
  const buttons = (
    <>
      <SearchButton onClick={handleSearch} />
      <ResetButton onClick={handleReset} />
      {hasPermission('report:metric:create') ? <CreateButton onClick={openCreate} /> : null}
    </>
  );

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{keyword}{buttons}</>}
        filters={filters}
        mobilePrimary={<>{keyword}<SearchButton onClick={handleSearch} />{hasPermission('report:metric:create') ? <CreateButton onClick={openCreate} /> : null}</>}
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />
      {listQuery.isError && <Banner type="danger" description={listQuery.error instanceof Error ? listQuery.error.message : '指标加载失败'} />}
      <ConfigurableTable
        bordered
        rowKey="id"
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        empty={<Empty title="暂无指标" description="创建指标以统一复用业务口径" />}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
      />

      <SideSheet
        title={metricModal.isEdit ? `编辑指标 · ${metricModal.editing?.name ?? ''}` : '新建指标'}
        visible={metricModal.visible}
        onCancel={metricModal.close}
        closeOnEsc
        placement="right"
        width={760}
        bodyStyle={{ padding: 16, overflow: 'auto' }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {conflict && (
            <Banner
              type="warning"
              description={conflict}
              closeIcon={null}
              style={{ marginBottom: 0 }}
            >
              <Button size="small" onClick={async () => { const result = await detailQuery.refetch(); if (result.data) metricModal.openEdit(result.data); setConflict(''); }}>
                加载最新版本
              </Button>
            </Banner>
          )}
          {detailQuery.isError && <Banner type="danger" description="指标详情加载失败，请关闭后重试" />}
          <Form key={metricModal.formKey} {...metricModal.formProps}
            onValueChange={(_values, changedValues) => {
              const changed = (changedValues ?? {}) as Record<string, unknown>;
              if ('datasetId' in changed) setFormDatasetId(changed.datasetId ? Number(changed.datasetId) : undefined);
            }}
          >
            <Row gutter={16}>
              <Col xs={24} md={12}><Form.Input field="name" label="指标名称" rules={[{ required: true, message: '请输入指标名称' }]} /></Col>
              <Col xs={24} md={12}><Form.Input field="code" label="指标编码" disabled={metricModal.isEdit} rules={[{ required: true, message: '请输入指标编码' }]} /></Col>
              <Col xs={24} md={12}><Form.Select field="type" label="指标类型" style={{ width: '100%' }} optionList={typeOptions} rules={[{ required: true }]} /></Col>
              <Col xs={24} md={12}><Form.Select field="datasetId" label="数据集" filter style={{ width: '100%' }} optionList={datasets.map((item) => ({ value: item.id, label: item.name }))} rules={[{ required: true, message: '请选择数据集' }]} /></Col>
              <Col xs={24} md={12}><Form.Select field="sourceField" label="来源字段" placeholder="简单指标必填" filter allowCreate showClear style={{ width: '100%' }} optionList={formFieldOptions} /></Col>
              <Col xs={24} md={12}><Form.Select field="aggregate" label="聚合方式" style={{ width: '100%' }} optionList={['sum', 'avg', 'max', 'min', 'count', 'distinct_count'].map((value) => ({ value, label: value }))} showClear /></Col>
              <Col xs={24} md={12}><Form.Select field="dimensions" label="维度字段" multiple filter allowCreate showClear style={{ width: '100%' }} optionList={formFieldOptions} /></Col>
              <Col xs={24} md={12}><Form.Select field="timeField" label="时间字段" filter allowCreate showClear style={{ width: '100%' }} optionList={formFieldOptions} /></Col>
              <Col xs={24} md={12}><Form.Input field="unit" label="单位" /></Col>
              <Col xs={24} md={12}><Form.Input field="format" label="显示格式" placeholder="如 0,0.00" /></Col>
              <Col xs={24} md={12}><Form.Select field="ownerId" label="负责人" filter showClear style={{ width: '100%' }} optionList={users.map((item) => ({ value: item.id, label: item.nickname || item.username }))} /></Col>
              <Col xs={24} md={12}><Form.Select field="folderId" label="指标目录" filter showClear style={{ width: '100%' }} optionList={folders.map((item) => ({ value: item.id, label: item.name }))} /></Col>
            </Row>
            <Form.TextArea field="formula" label="计算公式" placeholder="比率/复合指标必填；只允许后端安全公式语法" autosize rows={3} />
            <Form.TextArea field="caliber" label="统计口径" autosize rows={2} />
            <Form.TextArea field="description" label="说明" autosize rows={2} />
          </Form>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, paddingTop: 8, borderTop: '1px solid var(--semi-color-border)' }}>
            <Button onClick={metricModal.close}>取消</Button>
            <Button type="primary" loading={metricModal.modalProps.okButtonProps.loading} disabled={metricModal.modalProps.okButtonProps.disabled} onClick={() => void metricModal.modalProps.onOk()}>
              {metricModal.isEdit ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      </SideSheet>

      <SideSheet
        title={sheetMode === 'preview' ? `指标预览：${sheetMetric?.name ?? ''}` : `引用关系：${sheetMetric?.name ?? ''}`}
        visible={!!sheetMetric}
        width={520}
        onCancel={() => setSheetMetric(null)}
      >
        {sheetMode === 'preview' ? (
          <Space vertical align="start" style={{ width: '100%' }}>
            <Banner type="info" description="计算由服务端安全执行，仅返回聚合结果，不下发原始查询。" />
            <Button type="primary" loading={evaluateMutation.isPending} onClick={() => sheetMetric && evaluateMutation.mutate({ params: { id: sheetMetric.id }, body: {} })}>执行计算</Button>
            {evaluateMutation.isError && <Banner type="danger" description={evaluateMutation.error instanceof Error ? evaluateMutation.error.message : '计算失败'} />}
            {evaluateMutation.data && (
              <>
                <Typography.Title heading={2}>{evaluateMutation.data.formattedValue}</Typography.Title>
                <Typography.Text type="tertiary">耗时 {evaluateMutation.data.durationMs}ms · {evaluateMutation.data.cacheHit ? '命中缓存' : '实时计算'}</Typography.Text>
              </>
            )}
          </Space>
        ) : (
          <>
            {refsQuery.isError && <Banner type="danger" description="引用关系加载失败" />}
            {refsQuery.isFetching && <Typography.Text>正在加载引用关系…</Typography.Text>}
            {refsQuery.data && (
              <Space vertical align="start">
                <Typography.Title heading={6}>仪表盘（{refsQuery.data.dashboards.length}）</Typography.Title>
                {refsQuery.data.dashboards.map((item) => <Typography.Text key={item.id}>{item.name}（{item.widgets.join(', ')}）</Typography.Text>)}
                <Typography.Title heading={6}>预警（{refsQuery.data.alerts.length}）</Typography.Title>
                {refsQuery.data.alerts.map((item) => <Typography.Text key={item.id}>{item.name}</Typography.Text>)}
                <Typography.Title heading={6}>复合指标（{refsQuery.data.metrics.length}）</Typography.Title>
                {refsQuery.data.metrics.map((item) => <Typography.Text key={item.id}>{item.code} · {item.name}</Typography.Text>)}
                {!refsQuery.data.dashboards.length && !refsQuery.data.alerts.length && !refsQuery.data.metrics.length && <Empty title="暂无引用" />}
              </Space>
            )}
          </>
        )}
      </SideSheet>
    </div>
  );
}
