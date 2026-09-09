import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Modal, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import AppModal from '@/components/AppModal';
import { useExportJobRunner } from '@/hooks/useExportJobRunner';
import ReportParamDialog from '@/components/ReportParamDialog';
import { buildReportParamInitialValues } from '@/components/report-param-utils';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useReportDesignerDatasets } from '@/hooks/queries/report-designer';
import {
  useBatchReportPrintTemplateStatus,
  useCloneReportPrintTemplate,
  reportPrintKeys,
  useDeleteReportPrintTemplates,
  useRenderReportPrintTemplate,
  useReportPrintTemplateList,
  useSaveReportPrintTemplate,
} from '@/hooks/queries/report-print';
import PrintReportView from './PrintReportView';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import type { CreateReportPrintTemplateInput, ReportPrintRenderResult, ReportPrintTemplate, UpdateReportPrintTemplateInput } from '@zenith/shared/report';
import type { ExportJobFormat } from '@zenith/shared/tasks';
import { useDictItems } from '@/hooks/useDictItems';
import { ReportFolderFilter, ReportOwnerFilter, useReportOwnerFolderOptions } from './report-filters';
import { useListSearch } from '@/hooks/useListSearch';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';

interface SearchParams { keyword: string; status?: string; ownerId?: number; folderId?: number }
const defaultSearchParams: SearchParams = { keyword: '', status: undefined, ownerId: undefined, folderId: undefined };

export default function PrintTemplatesPage() {
  const { items: statusItems } = useDictItems('common_status');
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const exportResolveRef = useRef<((value: Record<string, unknown> | null) => void) | null>(null);

  const {
    page, pageSize, buildPagination,
    draftParams, setField, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: reportPrintKeys.lists });

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
    status: enumValueOf(USER_STATUSES, submittedParams.status),
    ownerId: submittedParams.ownerId,
    folderId: submittedParams.folderId,
  });
  const { userOptions, folderOptions } = useReportOwnerFolderOptions('print_template');
  const datasetsQuery = useReportDesignerDatasets();
  const datasets = datasetsQuery.data ?? [];
  const saveMutation = useSaveReportPrintTemplate();
  const toggleStatusMutation = useSaveReportPrintTemplate();
  const batchStatusMutation = useBatchReportPrintTemplateStatus();
  const cloneMutation = useCloneReportPrintTemplate();
  const deleteMutation = useDeleteReportPrintTemplates();
  const renderMutation = useRenderReportPrintTemplate();
  const exportRunner = useExportJobRunner();
  const statusToggle = useStatusToggle<ReportPrintTemplate>({
    toggle: (record, checked) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({ title: '确认停用', content: `停用后「${record.name}」将不可用于打印报表，确认停用？` }),
    disabled: !hasPermission('report:print:update'),
  });

  const printModal = useEditModal<ReportPrintTemplate, Record<string, unknown>, CreateReportPrintTemplateInput | UpdateReportPrintTemplateInput>({
    entityName: '打印模板',
    save: saveMutation,
    defaults: { status: 'enabled' },
    labelWidth: 72,
    toValues: (record) => ({
      name: record.name,
      ownerId: record.ownerId ?? undefined,
      folderId: record.folderId ?? undefined,
      datasetId: record.datasetId ?? undefined,
      status: record.status,
      remark: record.remark ?? '',
    }),
    beforeSave: (values) => ({
      name: String(values.name ?? '').trim(),
      ownerId: values.ownerId ? Number(values.ownerId) : null,
      folderId: values.folderId ? Number(values.folderId) : null,
      datasetId: values.datasetId ? Number(values.datasetId) : null,
      status: values.status as ReportPrintTemplate['status'],
      remark: values.remark ? String(values.remark) : undefined,
    }),
    onSaved: (saved, { isEdit }) => {
      if (!isEdit) navigate(`/report/print/${saved.id}/design`, { state: { tabTitle: `设计·${saved.name}` } });
    },
  });

  async function handleClone(record: ReportPrintTemplate) {
    const cloned = await cloneMutation.mutateAsync({ params: { id: record.id }, body: {} });
    Toast.success(`已复制为「${cloned.name}」`);
  }

  function handleBatchStatus(status: 'enabled' | 'disabled') {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确认批量${status === 'enabled' ? '启用' : '停用'}选中的 ${selectedRowKeys.length} 个打印模板？`,
      onOk: async () => {
        await batchStatusMutation.mutateAsync({ body: { ids: selectedRowKeys, status } });
        setSelectedRowKeys([]);
        Toast.success(status === 'enabled' ? '批量启用成功' : '批量停用成功');
      },
    });
  }

  async function runPreview(record: ReportPrintTemplate, values: Record<string, unknown>) {
    setPreviewVisible(true);
    setPreviewResult(null);
    setPreviewParams(values);
    const result = await renderMutation.mutateAsync({ params: { id: record.id }, body: { params: values, limit: 300 } });
    setPreviewResult(result);
  }

  async function openPreview(record: ReportPrintTemplate) {
    // 无参数模板直接生成预览，跳过参数弹窗
    if ((record.params ?? []).length === 0) {
      await runPreview(record, {});
      return;
    }
    setPreviewParams(buildReportParamInitialValues(record.params ?? []));
    setParamDialogContext({ record, mode: 'preview' });
    setParamDialogVisible(true);
  }

  async function resolveExportQuery(record: ReportPrintTemplate, format: ExportJobFormat) {
    if ((record.params ?? []).length === 0) {
      return { templateId: record.id, params: {} };
    }
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
      await runPreview(context.record, values);
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
    {
      title: '名称', dataIndex: 'name', minWidth: 200,
      render: (v: string, record: ReportPrintTemplate) => hasPermission('report:print:list') ? (
        <Typography.Text link ellipsis={{ showTooltip: true }} onClick={() => void openPreview(record)}>{v}</Typography.Text>
      ) : v,
    },
    { title: '数据集', dataIndex: 'datasetName', width: 160, render: renderEllipsis },
    { title: '负责人', dataIndex: 'ownerName', width: 120, render: (v: string | null) => v || '—' },
    { title: '目录', dataIndex: 'folderName', width: 140, render: (v: string | null) => v || '—' },
    { title: '备注', dataIndex: 'remark', width: 200, render: renderEllipsis },
    createdAtColumn,
    statusToggle.column(),
    createOperationColumn<ReportPrintTemplate>({
      width: 240,
      desktopInlineKeys: ['design', 'preview', 'edit'],
      actions: (record) => [
        ...(hasPermission('report:print:update') ? [{ key: 'design', label: '设计', onClick: () => navigate(`/report/print/${record.id}/design`, { state: { tabTitle: `设计·${record.name}` } }) }] : []),
        ...(hasPermission('report:print:list') ? [{ key: 'preview', label: '预览', onClick: () => void openPreview(record) }] : []),
        ...(hasPermission('report:print:update') ? [{ key: 'edit', label: '编辑', onClick: () => printModal.openEdit(record) }] : []),
        { key: 'governance', label: '权限与转移', onClick: () => navigate(`/report/governance?resourceType=print_template&resourceId=${record.id}`) },
        ...(hasPermission('report:print:create') ? [{ key: 'clone', label: '复制', onClick: () => void handleClone(record) }] : []),
        ...(hasPermission('report:print:list') ? [
          { key: 'exportXlsx', label: '导出 XLSX', dividerBefore: true, loading: exportRunner.isPending, onClick: () => handleExport(record, 'xlsx') },
          { key: 'exportPdf', label: '导出 PDF', loading: exportRunner.isPending, onClick: () => handleExport(record, 'pdf') },
          { key: 'exportDocx', label: '导出 Word', loading: exportRunner.isPending, onClick: () => handleExport(record, 'docx') },
        ] : []),
        {
          ...deleteAction({
            hidden: !hasPermission('report:print:delete'),
            title: '确定要删除吗？',
            content: '删除后不可恢复',
            run: () => deleteMutation.mutateAsync([record.id]),
          }),
          dividerBefore: true,
        },
      ],
    }),
  ];

  const renderKeyword = () => (
    <KeywordInput placeholder="搜索名称/备注..." value={draftParams.keyword} onChange={setField('keyword')} onSearch={handleSearch} />
  );
  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.status}
      onChange={setField('status')}
    />
  );
  const renderOwnerFilter = () => (
    <ReportOwnerFilter items={userOptions} value={draftParams.ownerId} onChange={setField('ownerId')} />
  );
  const renderFolderFilter = () => (
    <ReportFolderFilter items={folderOptions} value={draftParams.folderId} onChange={setField('folderId')} />
  );
  const renderCreateBtn = () => hasPermission('report:print:create')
    ? <CreateButton onClick={printModal.openCreate} /> : null;
  const renderBatchEnableBtn = () => selectedRowKeys.length > 0 && hasPermission('report:print:update')
    ? <Button onClick={() => handleBatchStatus('enabled')}>批量启用</Button> : null;
  const renderBatchDisableBtn = () => selectedRowKeys.length > 0 && hasPermission('report:print:update')
    ? <Button type="danger" onClick={() => handleBatchStatus('disabled')}>批量停用</Button> : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={renderKeyword()}
        filters={<>{renderOwnerFilter()}{renderFolderFilter()}{renderStatusFilter()}</>}
        onSearch={handleSearch}
        onReset={handleReset}
        create={renderCreateBtn()}
        actions={<>{renderBatchEnableBtn()}{renderBatchDisableBtn()}</>}
        mobileActions={<>{renderBatchEnableBtn()}{renderBatchDisableBtn()}</>}
        filterTitle="打印模板筛选"
      />

      <ConfigurableTable<ReportPrintTemplate>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          empty: '暂无数据',
          rowSelection: hasPermission('report:print:update') ? {
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys((keys ?? []) as number[]),
          } : undefined,
        })}
      />

      <AppModal
        {...printModal.modalProps}
        width={560}
      >
        <Form key={printModal.formKey} {...printModal.formProps}>
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={64} showClear placeholder="如：销售出库单" />
          <Form.Select field="ownerId" label="负责人" filter showClear style={{ width: '100%' }}
            optionList={userOptions} />
          <Form.Select field="folderId" label="资源目录" filter showClear style={{ width: '100%' }}
            optionList={folderOptions} />
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
