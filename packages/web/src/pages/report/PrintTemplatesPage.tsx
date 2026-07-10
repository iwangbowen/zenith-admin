import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Select, Switch, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, RotateCcw, Search } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { useExportJobRunner } from '@/hooks/useExportJobRunner';
import ReportParamDialog from '@/components/ReportParamDialog';
import { buildReportParamInitialValues } from '@/components/report-param-utils';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useReportDesignerDatasets } from '@/hooks/queries/report-designer';
import {
  useBatchReportPrintTemplateStatus,
  useCloneReportPrintTemplate,
  reportPrintKeys,
  useDeleteReportPrintTemplate,
  useRenderReportPrintTemplate,
  useReportPrintTemplateList,
  useSaveReportPrintTemplate,
} from '@/hooks/queries/report-print';
import PrintReportView from './PrintReportView';
import type {
  CreateReportPrintTemplateInput,
  ExportJobFormat,
  ReportPrintRenderResult,
  ReportPrintTemplate,
  UpdateReportPrintTemplateInput,
} from '@zenith/shared';
import { useDictItems } from '@/hooks/useDictItems';

interface SearchParams { keyword: string; status: string }
const defaultSearchParams: SearchParams = { keyword: '', status: '' };

export default function PrintTemplatesPage() {
  const { items: statusItems } = useDictItems('common_status');
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const exportResolveRef = useRef<((value: Record<string, unknown> | null) => void) | null>(null);

  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportPrintTemplate | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewResult, setPreviewResult] = useState<ReportPrintRenderResult | null>(null);
  const [previewParams, setPreviewParams] = useState<Record<string, unknown>>({});
  const [paramDialogVisible, setParamDialogVisible] = useState(false);
  const [paramDialogContext, setParamDialogContext] = useState<{ record: ReportPrintTemplate; mode: 'preview' | 'export'; format?: ExportJobFormat } | null>(null);

  const listQuery = useReportPrintTemplateList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data ?? null;
  const datasetsQuery = useReportDesignerDatasets();
  const datasets = datasetsQuery.data ?? [];
  const saveMutation = useSaveReportPrintTemplate();
  const toggleStatusMutation = useSaveReportPrintTemplate();
  const batchStatusMutation = useBatchReportPrintTemplateStatus();
  const cloneMutation = useCloneReportPrintTemplate();
  const deleteMutation = useDeleteReportPrintTemplate();
  const renderMutation = useRenderReportPrintTemplate();
  const exportRunner = useExportJobRunner();
  const togglingId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  function handleSearch() {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: reportPrintKeys.lists });
  }
  function handleReset() {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: reportPrintKeys.lists });
  }

  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(record: ReportPrintTemplate) { setEditing(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const formInitValues = editing
    ? {
        name: editing.name,
        datasetId: editing.datasetId ?? undefined,
        status: editing.status,
        remark: editing.remark ?? '',
      }
    : { status: 'enabled' };

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try { values = await formApi.current?.validate() as Record<string, unknown>; }
    catch { throw new Error('validation'); }

    const basePayload = {
      name: String(values.name ?? '').trim(),
      datasetId: values.datasetId ? Number(values.datasetId) : null,
      status: values.status as ReportPrintTemplate['status'],
      remark: values.remark ? String(values.remark) : undefined,
    };
    const saved = await saveMutation.mutateAsync({ id: editing?.id, values: basePayload satisfies CreateReportPrintTemplateInput | UpdateReportPrintTemplateInput });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
    if (!editing) navigate(`/report/print/${saved.id}/design`);
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  async function handleClone(record: ReportPrintTemplate) {
    const cloned = await cloneMutation.mutateAsync({ id: record.id });
    Toast.success(`已复制为「${cloned.name}」`);
  }

  function handleBatchStatus(status: 'enabled' | 'disabled') {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确认批量${status === 'enabled' ? '启用' : '停用'}选中的 ${selectedRowKeys.length} 个打印模板？`,
      onOk: async () => {
        await batchStatusMutation.mutateAsync({ ids: selectedRowKeys, status });
        setSelectedRowKeys([]);
        Toast.success(status === 'enabled' ? '批量启用成功' : '批量停用成功');
      },
    });
  }

  function handleToggleStatus(record: ReportPrintTemplate, checked: boolean) {
    const doToggle = async () => {
      await toggleStatusMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } });
      Toast.success(checked ? '已启用' : '已停用');
    };
    if (checked) void doToggle();
    else Modal.confirm({ title: '确认停用', content: `停用后「${record.name}」将不可用于打印报表，确认停用？`, onOk: () => void doToggle() });
  }

  async function openPreview(record: ReportPrintTemplate) {
    setPreviewParams(buildReportParamInitialValues(record.params ?? []));
    setParamDialogContext({ record, mode: 'preview' });
    setParamDialogVisible(true);
  }

  async function resolveExportQuery(record: ReportPrintTemplate, format: ExportJobFormat) {
    return await new Promise<Record<string, unknown> | null>((resolve) => {
      setPreviewParams(buildReportParamInitialValues(record.params ?? []));
      setParamDialogContext({ record, mode: 'export', format });
      setParamDialogVisible(true);
      exportResolveRef.current = resolve;
    });
  }

  async function handleExport(record: ReportPrintTemplate, format: ExportJobFormat) {
    const query = await resolveExportQuery(record, format);
    if (!query) return;
    await exportRunner.runExport({
      entity: 'report.print',
      format,
      query,
      executionMode: 'auto',
    });
  }

  async function handleParamSubmit(values: Record<string, unknown>) {
    const context = paramDialogContext;
    setParamDialogVisible(false);
    setParamDialogContext(null);
    if (!context) return;
    if (context.mode === 'preview') {
      setPreviewVisible(true);
      setPreviewResult(null);
      setPreviewParams(values);
      const result = await renderMutation.mutateAsync({ id: context.record.id, params: values, limit: 300 });
      setPreviewResult(result);
      return;
    }
    exportResolveRef.current?.({
      templateId: context.record.id,
      params: values,
    });
    exportResolveRef.current = null;
  }

  function handleParamCancel() {
    setParamDialogVisible(false);
    if (paramDialogContext?.mode === 'export') {
      exportResolveRef.current?.(null);
      exportResolveRef.current = null;
    }
    setParamDialogContext(null);
  }

  const columns: ColumnProps<ReportPrintTemplate>[] = [
    { title: '名称', dataIndex: 'name', width: 200 },
    { title: '数据集', dataIndex: 'datasetName', width: 160, render: (v: string | null) => v || '-' },
    { title: '备注', dataIndex: 'remark', width: 200, render: renderEllipsis },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, record: ReportPrintTemplate) => (
        <Switch
          checked={record.status === 'enabled'}
          loading={togglingId === record.id}
          disabled={!hasPermission('report:print:update')}
          onChange={(checked) => handleToggleStatus(record, checked)}
          size="small"
        />
      ),
    },
    createOperationColumn<ReportPrintTemplate>({
      width: 220,
      desktopInlineKeys: ['design', 'preview', 'edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('report:print:update') ? [{ key: 'design', label: '设计', onClick: () => navigate(`/report/print/${record.id}/design`) }] : []),
        ...(hasPermission('report:print:list') ? [{ key: 'preview', label: '预览', onClick: () => void openPreview(record) }] : []),
        ...(hasPermission('report:print:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(record) }] : []),
        ...(hasPermission('report:print:create') ? [{ key: 'clone', label: '复制', onClick: () => void handleClone(record) }] : []),
        ...(hasPermission('report:print:list') ? [
          { key: 'exportXlsx', label: '导出 XLSX', dividerBefore: true, loading: exportRunner.isPending, onClick: () => handleExport(record, 'xlsx') },
          { key: 'exportPdf', label: '导出 PDF', loading: exportRunner.isPending, onClick: () => handleExport(record, 'pdf') },
        ] : []),
        ...(hasPermission('report:print:delete') ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => { Modal.confirm({ title: '确定要删除吗？', content: '删除后不可恢复', onOk: () => handleDelete(record.id) }); },
        }] : []),
      ],
    }),
  ];

  const renderKeyword = () => (
    <Input prefix={<Search size={14} />} placeholder="搜索名称/备注..." value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} showClear style={{ width: 220 }} onEnterPress={handleSearch} />
  );
  const renderStatusFilter = () => (
    <Select placeholder="全部状态" value={draftParams.status || undefined} onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear style={{ width: 120 }} optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
  );
  const renderSearchBtn = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetBtn = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateBtn = () => hasPermission('report:print:create')
    ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;
  const renderBatchEnableBtn = () => selectedRowKeys.length > 0 && hasPermission('report:print:update')
    ? <Button onClick={() => handleBatchStatus('enabled')}>批量启用</Button> : null;
  const renderBatchDisableBtn = () => selectedRowKeys.length > 0 && hasPermission('report:print:update')
    ? <Button type="danger" onClick={() => handleBatchStatus('disabled')}>批量停用</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}{renderStatusFilter()}{renderSearchBtn()}{renderResetBtn()}</>}
        actions={<>{renderBatchEnableBtn()}{renderBatchDisableBtn()}{renderCreateBtn()}</>}
        mobilePrimary={<>{renderKeyword()}{renderSearchBtn()}{renderCreateBtn()}</>}
        mobileFilters={renderStatusFilter()}
        mobileActions={<>{renderBatchEnableBtn()}{renderBatchDisableBtn()}</>}
        filterTitle="打印模板筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        rowSelection={hasPermission('report:print:update') ? {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        } : undefined}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal
        title={editing ? '编辑打印模板' : '新增打印模板'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={560}
      >
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInitValues} labelPosition="left" labelWidth={72}>
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={64} showClear placeholder="如：销售出库单" />
          <Form.Select
            field="datasetId"
            label="数据集"
            placeholder="可先不绑定，设计时再选择"
            optionList={datasets.map((d) => ({ value: d.id, label: d.name }))}
            style={{ width: '100%' }}
            showClear
          />
          <Form.Select field="status" label="状态" style={{ width: '100%' }}
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
          <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
        </Form>
      </AppModal>

      <ReportParamDialog
        visible={paramDialogVisible}
        title={paramDialogContext?.mode === 'preview' ? '预览参数' : '导出参数'}
        params={paramDialogContext?.record.params ?? []}
        initialValues={previewParams}
        loading={renderMutation.isPending}
        confirmText={paramDialogContext?.mode === 'preview' ? '生成预览' : '继续导出'}
        onCancel={handleParamCancel}
        onSubmit={(values) => void handleParamSubmit(values)}
      />

      <AppModal
        title="打印预览"
        visible={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width="92vw"
        style={{ maxWidth: 1180 }}
      >
        {renderMutation.isPending && <div style={{ padding: 32, textAlign: 'center' }}>正在生成预览...</div>}
        {!renderMutation.isPending && previewResult && <PrintReportView result={previewResult} params={previewParams} />}
        {!renderMutation.isPending && !previewResult && <div style={{ padding: 32, textAlign: 'center', color: 'var(--semi-color-text-2)' }}>暂无预览内容</div>}
      </AppModal>
    </div>
  );
}
