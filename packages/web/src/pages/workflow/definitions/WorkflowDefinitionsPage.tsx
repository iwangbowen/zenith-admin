import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Space, Tag, Typography,
  Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Ban, CircleCheck, GitCompare, Layers, LayoutTemplate, Plus, RotateCcw, Save, Search, Trash2, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowDefinition, WorkflowFormType, WorkflowVersionDiff as WorkflowVersionDiffData } from '@zenith/shared';
import { WORKFLOW_FORM_TYPE_LABELS } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import WorkflowVersionsModal from '../components/WorkflowVersionsModal';
import WorkflowTemplateFormModal, { type WorkflowTemplateFormValues } from '../components/WorkflowTemplateFormModal';
import CategorySidebar from './components/CategorySidebar';
import { TemplateGalleryModal } from './components/TemplateGalleryModal';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import {
  useBatchDeleteWorkflowDefinitions,
  useBatchDisableWorkflowDefinitions,
  useBatchEnableWorkflowDefinitions,
  useDeleteWorkflowDefinition,
  useDisableWorkflowDefinition,
  useDuplicateWorkflowDefinition,
  useEnableWorkflowDefinition,
  useImportWorkflowDefinition,
  usePublishWorkflowDefinition,
  useSaveWorkflowDefinitionAsTemplate,
  useWorkflowDefinitionDiff,
  useWorkflowDefinitionList,
  useWorkflowDefinitionVersions,
  workflowDefinitionKeys,
} from '@/hooks/queries/workflow-definitions';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft: { text: '草稿', color: 'grey' },
  published: { text: '已发布', color: 'green' },
  disabled: { text: '已禁用', color: 'red' },
};

const FORM_TYPE_COLOR: Record<WorkflowFormType, TagColor> = {
  designer: 'blue',
  custom: 'purple',
  external: 'orange',
};

interface SearchParams {
  keyword: string;
  status: string;
  selectedCategoryId: number | null;
}

interface WorkflowDefinitionExportData {
  name: string;
  description?: string | null;
  categoryName?: string | null;
  flowData: unknown;
  form?: unknown;
  exportedAt?: string;
  schemaVersion?: number;
}

interface WorkflowDefinitionImportPayload {
  name: string;
  description?: string | null;
  categoryName?: string | null;
  flowData: unknown;
  form?: unknown;
}

const DIFF_KIND_META: Record<'added' | 'removed' | 'modified', { text: string; color: 'green' | 'red' | 'orange' }> = {
  added: { text: '新增', color: 'green' },
  removed: { text: '删除', color: 'red' },
  modified: { text: '修改', color: 'orange' },
};

const defaultSearchParams: SearchParams = { keyword: '', status: '', selectedCategoryId: null };

const stringifyFlowData = (value: unknown) => JSON.stringify(value ?? null, null, 2);

export default function WorkflowDefinitionsPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { page, setPage, pageSize, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const canBatchOperate = hasPermission('workflow:definition:publish') || hasPermission('workflow:definition:delete');
  const [historyTarget, setHistoryTarget] = useState<WorkflowDefinition | null>(null);
  const [templateGalleryVisible, setTemplateGalleryVisible] = useState(false);
  const [saveAsTarget, setSaveAsTarget] = useState<WorkflowDefinition | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [diffTarget, setDiffTarget] = useState<WorkflowDefinition | null>(null);
  const [leftVersionId, setLeftVersionId] = useState(0);
  const [rightVersionId, setRightVersionId] = useState(0);
  const [diffData, setDiffData] = useState<WorkflowVersionDiffData | null>(null);
  const { categories, refetch: refetchCategories } = useWorkflowCategories();
  // 窄屏（单栏）响应式：默认展示列表，点「分类」按钮切到分类侧栏，选中后自动返回
  const [isLayoutNarrow, setIsLayoutNarrow] = useState(false);
  const [showCategorySidebar, setShowCategorySidebar] = useState(false);

  const listQuery = useWorkflowDefinitionList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    categoryId: submittedParams.selectedCategoryId ?? undefined,
  });
  const data = listQuery.data;
  const publishMutation = usePublishWorkflowDefinition();
  const disableMutation = useDisableWorkflowDefinition();
  const enableMutation = useEnableWorkflowDefinition();
  const deleteMutation = useDeleteWorkflowDefinition();
  const batchDisableMutation = useBatchDisableWorkflowDefinitions();
  const batchEnableMutation = useBatchEnableWorkflowDefinitions();
  const batchDeleteMutation = useBatchDeleteWorkflowDefinitions();
  const duplicateMutation = useDuplicateWorkflowDefinition();
  const importMutation = useImportWorkflowDefinition();
  const saveAsMutation = useSaveWorkflowDefinitionAsTemplate();
  const versionsQuery = useWorkflowDefinitionVersions(diffTarget?.id, !!diffTarget);
  const versions = useMemo(() => versionsQuery.data ?? [], [versionsQuery.data]);
  const diffQuery = useWorkflowDefinitionDiff({ definitionId: diffTarget?.id, left: leftVersionId, right: rightVersionId }, false);

  useEffect(() => {
    if (!diffTarget || versions.length === 0) return;
    const latest = versions.reduce(
      (max, item) => (!max || item.version > max.version ? item : max),
      versions[0],
    );
    setLeftVersionId(latest?.id ?? 0);
  }, [diffTarget, versions]);

  const handleSelectCategory = (id: number | null) => {
    setSelectedRowKeys([]);
    const next = { ...draftParams, selectedCategoryId: id };
    setDraftParams(next);
    setSubmittedParams(next);
    setPage(1);
    setShowCategorySidebar(false);
    void queryClient.invalidateQueries({ queryKey: workflowDefinitionKeys.lists });
  };

  const handleSearch = () => {
    setSelectedRowKeys([]);
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: workflowDefinitionKeys.lists });
  };

  const handleReset = () => {
    setSelectedRowKeys([]);
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: workflowDefinitionKeys.lists });
  };

  const handlePublish = async (record: WorkflowDefinition) => {
    await publishMutation.mutateAsync(record.id);
    Toast.success('发布成功');
  };

  const handleDisable = async (record: WorkflowDefinition) => {
    await disableMutation.mutateAsync(record.id);
    Toast.success('已禁用');
  };

  const handleEnable = async (record: WorkflowDefinition) => {
    await enableMutation.mutateAsync(record.id);
    Toast.success('已启用');
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  };

  const batchDisable = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确定禁用选中的 ${selectedRowKeys.length} 个流程？`,
      content: '仅「已发布」状态的流程会被禁用，禁用后不可发起新申请。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await batchDisableMutation.mutateAsync(selectedRowKeys);
        Toast.success('操作成功');
        setSelectedRowKeys([]);
      },
    });
  };

  const batchEnable = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确定启用选中的 ${selectedRowKeys.length} 个流程？`,
      content: '仅「已禁用」状态的流程会被启用，启用后恢复为已发布状态。',
      onOk: async () => {
        await batchEnableMutation.mutateAsync(selectedRowKeys);
        Toast.success('操作成功');
        setSelectedRowKeys([]);
      },
    });
  };

  const batchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确定删除选中的 ${selectedRowKeys.length} 个流程？`,
      content: '仅「非已发布」且无发起实例的流程会被删除，删除后无法恢复。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await batchDeleteMutation.mutateAsync(selectedRowKeys);
        Toast.success('删除成功');
        setSelectedRowKeys([]);
      },
    });
  };

  const handleDuplicate = async (record: WorkflowDefinition) => {
    await duplicateMutation.mutateAsync(record.id);
    Toast.success('已复制为新草稿');
  };

  const handleExport = async (record: WorkflowDefinition) => {
    const res = await request.get<WorkflowDefinitionExportData>(`/api/workflows/definitions/${record.id}/export`);
    if (res.code !== 0) return;

    const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${record.name}.workflow.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    Toast.success('已导出');
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      let parsed: Partial<WorkflowDefinitionExportData>;
      try {
        const raw = JSON.parse(await file.text()) as unknown;
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
          Toast.error('文件格式不正确');
          return;
        }
        parsed = raw;
      } catch {
        Toast.error('文件格式不正确');
        return;
      }

      const payload: WorkflowDefinitionImportPayload = {
        name: parsed.name ?? '',
        description: parsed.description,
        categoryName: parsed.categoryName,
        flowData: parsed.flowData,
        form: parsed.form,
      };
      await importMutation.mutateAsync(payload);
      Toast.success('已导入为新草稿');
    } finally {
      setImporting(false);
    }
  };

  const openDiffModal = (record: WorkflowDefinition) => {
    setDiffTarget(record);
    setDiffData(null);
    setLeftVersionId(0);
    setRightVersionId(0);
  };

  const handleDiff = async () => {
    if (!diffTarget) return;
    const res = await diffQuery.refetch();
    if (res.data) setDiffData(res.data);
  };

  const closeDiffModal = () => {
    setDiffTarget(null);
    setDiffData(null);
  };

  const handleSaveAsTemplate = async (values: WorkflowTemplateFormValues) => {
    if (!saveAsTarget) return;
    await saveAsMutation.mutateAsync({
      definitionId: saveAsTarget.id,
      ...values,
    });
    Toast.success('已保存为模板');
    setSaveAsTarget(null);
  };

  const columns: ColumnProps<WorkflowDefinition>[] = [
    {
      title: '流程名称',
      dataIndex: 'name',
      width: 260,
      render: renderEllipsis,
    },
    {
      title: '分类',
      dataIndex: 'categoryName',
      width: 110,
      render: (_v: unknown, record: WorkflowDefinition) => {
        if (!record.categoryName) return <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>;
        const color = record.categoryColor ?? undefined;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />}
            <span>{record.categoryName}</span>
          </span>
        );
      },
    },
    {
      title: '表单类型',
      dataIndex: 'formType',
      width: 130,
      render: (v: WorkflowFormType) => (
        <Tag color={FORM_TYPE_COLOR[v] ?? 'grey'}>{WORKFLOW_FORM_TYPE_LABELS[v] ?? v}</Tag>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      width: 200,
      render: renderEllipsis,
    },
    {
      title: '版本',
      dataIndex: 'version',
      width: 70,
      render: (v: number) => `v${v}`,
    },
    {
      title: '创建人',
      dataIndex: 'createdByName',
      width: 90,
      render: renderEllipsis,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (v: string) => {
        const s = STATUS_MAP[v];
        return <Tag color={s?.color ?? 'grey'}>{s?.text ?? v}</Tag>;
      },
    },
    createOperationColumn<WorkflowDefinition>({
      width: 170,
      desktopInlineKeys: ['design', 'publish'],
      actions: (record) => {
        const canPublish = record.status === 'draft' && hasPermission('workflow:definition:publish');
        return [
          { key: 'design', label: '设计', onClick: () => navigate(`/workflow/designer/${record.id}`) },
          {
            key: 'publish',
            label: '发布',
            type: 'primary',
            disabled: !canPublish,
            onClick: () => {
              Modal.confirm({
                title: '确定发布此流程？',
                content: '发布后不可删除，请确认流程配置正确。',
                onOk: () => handlePublish(record),
              });
            },
          },
          {
            key: 'duplicate',
            label: '复制',
            hidden: !hasPermission('workflow:definition:create'),
            onClick: () => void handleDuplicate(record),
          },
          { key: 'export', label: '导出', onClick: () => void handleExport(record) },
          {
            key: 'disable',
            label: '禁用',
            hidden: record.status !== 'published' || !hasPermission('workflow:definition:publish'),
            dividerBefore: true,
            danger: true,
            onClick: () => {
              Modal.confirm({
                title: '确定禁用此流程？',
                content: '禁用后该流程不可发起新申请，是否继续？',
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: () => handleDisable(record),
              });
            },
          },
          {
            key: 'enable',
            label: '启用',
            hidden: record.status !== 'disabled' || !hasPermission('workflow:definition:publish'),
            dividerBefore: true,
            onClick: () => {
              Modal.confirm({
                title: '确定启用此流程？',
                content: '启用后该流程将恢复为已发布状态，可正常发起申请。',
                onOk: () => handleEnable(record),
              });
            },
          },
          { key: 'versions', label: '历史版本', onClick: () => setHistoryTarget(record) },
          { key: 'diff', label: '版本对比', onClick: () => void openDiffModal(record) },
          {
            key: 'save-template',
            label: '另存为模板',
            hidden: !hasPermission('workflow:definition:create'),
            onClick: () => setSaveAsTarget(record),
          },
          {
            key: 'delete',
            label: '删除',
            danger: true,
            hidden: record.status === 'published' || !hasPermission('workflow:definition:delete'),
            dividerBefore: true,
            onClick: () => {
              Modal.confirm({
                title: '确定要删除该流程吗？',
                okButtonProps: { type: 'danger', theme: 'solid' },
                onOk: () => handleDelete(record.id),
              });
            },
          },
        ];
      },
    }),
  ];

  const renderCategoryButton = () => (
    <Button
      theme="borderless"
      icon={<Layers size={14} />}
      onClick={() => setShowCategorySidebar(true)}
      style={{ display: isLayoutNarrow ? undefined : 'none' }}
    >分类</Button>
  );

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="搜索流程名称"
      value={draftParams.keyword}
      onChange={(v) => setDraftParams((prev) => ({ ...prev, keyword: v }))}
      showClear
      style={{ width: 200 }}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams((prev) => ({ ...prev, status: typeof v === 'string' ? v : '' }))}
      showClear
      style={{ width: 120 }}
    >
      <Select.Option value="draft">草稿</Select.Option>
      <Select.Option value="published">已发布</Select.Option>
      <Select.Option value="disabled">已禁用</Select.Option>
    </Select>
  );

  const renderSearchButton = () => (
    <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
  );

  const renderResetButton = () => (
    <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
  );

  const renderCreateButton = () => hasPermission('workflow:definition:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={() => {
      const qs = draftParams.selectedCategoryId === null ? '' : `?categoryId=${draftParams.selectedCategoryId}`;
      navigate(`/workflow/designer/new${qs}`);
    }}>
      新建流程
    </Button>
  ) : null;

  const renderImportButton = () => hasPermission('workflow:definition:create') ? (
    <Button
      type="primary"
      icon={<Upload size={14} />}
      loading={importing}
      onClick={() => importInputRef.current?.click()}
    >
      导入
    </Button>
  ) : null;

  const renderTemplateButton = () => hasPermission('workflow:definition:create') ? (
    <Button type="tertiary" icon={<LayoutTemplate size={14} />} onClick={() => setTemplateGalleryVisible(true)}>
      从模板新建
    </Button>
  ) : null;

  const renderBatchButtons = () => (
    <>
      {selectedRowKeys.length > 0 && hasPermission('workflow:definition:publish') && (
        <Button type="warning" icon={<Ban size={14} />} onClick={batchDisable}>
          批量禁用 ({selectedRowKeys.length})
        </Button>
      )}
      {selectedRowKeys.length > 0 && hasPermission('workflow:definition:publish') && (
        <Button type="tertiary" icon={<CircleCheck size={14} />} onClick={batchEnable}>
          批量启用 ({selectedRowKeys.length})
        </Button>
      )}
      {selectedRowKeys.length > 0 && hasPermission('workflow:definition:delete') && (
        <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={batchDelete}>
          批量删除 ({selectedRowKeys.length})
        </Button>
      )}
    </>
  );

  return (
    <div className="page-container">
    <MasterDetailLayout
      defaultSize={220}
      minSize={180}
      maxSize={360}
      persistKey="workflow-definitions"
      showDetail={!showCategorySidebar}
      onResponsiveChange={setIsLayoutNarrow}
      master={
        <CategorySidebar
          categories={categories}
          selectedId={draftParams.selectedCategoryId}
          onSelect={handleSelectCategory}
          onChanged={() => { refetchCategories(); void queryClient.invalidateQueries({ queryKey: workflowDefinitionKeys.lists }); }}
          canManage={hasPermission('workflow:definition:create')}
        />
      }
      detail={
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={(event) => { void handleImportFile(event); }}
          />
          <SearchToolbar
            primary={(
              <>
                {renderCategoryButton()}
                {renderKeywordSearch()}
                {renderStatusFilter()}
                {renderSearchButton()}
                {renderResetButton()}
                {renderCreateButton()}
                {renderImportButton()}
                {renderTemplateButton()}
                {renderBatchButtons()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderKeywordSearch()}
                {renderSearchButton()}
                {renderCreateButton()}
              </>
            )}
            mobileFilters={renderStatusFilter()}
            mobileActions={(
              <>
                {renderCategoryButton()}
                {renderResetButton()}
                {renderImportButton()}
                {renderTemplateButton()}
                {renderBatchButtons()}
              </>
            )}
            filterTitle="流程定义筛选"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
          />
          <ConfigurableTable
            bordered
            columns={columns}
            dataSource={data?.list ?? []}
            rowKey="id"
            loading={listQuery.isFetching}
            onRefresh={() => void listQuery.refetch()}
            refreshLoading={listQuery.isFetching}
            pagination={buildPagination(data?.total ?? 0)}
            rowSelection={canBatchOperate ? {
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys((keys ?? []) as number[]),
            } : undefined}
          />
          {historyTarget && (
            <WorkflowVersionsModal
              visible={!!historyTarget}
              definitionId={historyTarget.id}
              currentVersion={historyTarget.version}
              currentStatus={historyTarget.status}
              onCancel={() => setHistoryTarget(null)}
              onRestored={() => { void queryClient.invalidateQueries({ queryKey: workflowDefinitionKeys.all }); }}
            />
          )}
          <TemplateGalleryModal
            visible={templateGalleryVisible}
            onCancel={() => setTemplateGalleryVisible(false)}
            categoryId={draftParams.selectedCategoryId}
            onCreated={(id) => {
              setTemplateGalleryVisible(false);
              navigate(`/workflow/designer/${id}`);
            }}
          />
          <WorkflowTemplateFormModal
            title="另存为模板"
            visible={!!saveAsTarget}
            formKey={saveAsTarget?.id ?? 'save-as'}
            okIcon={<Save size={14} />}
            confirmLoading={saveAsMutation.isPending}
            onCancel={() => setSaveAsTarget(null)}
            onSubmit={handleSaveAsTemplate}
            initValues={{ name: saveAsTarget?.name ?? '' }}
          />
          <Modal
            title={diffTarget ? `版本对比 - ${diffTarget.name}` : '版本对比'}
            visible={!!diffTarget}
            onCancel={closeDiffModal}
            closeOnEsc
            footer={null}
            width={1040}
          >
            <Space wrap style={{ marginBottom: 16 }}>
              <Select
                placeholder="左侧版本"
                value={leftVersionId}
                loading={versionsQuery.isFetching}
                onChange={(v) => setLeftVersionId(Number(v ?? 0))}
                style={{ width: 240 }}
              >
                <Select.Option value={0}>当前草稿</Select.Option>
                {versions.map((version) => (
                  <Select.Option key={version.id} value={version.id}>
                    v{version.version} {version.name}
                  </Select.Option>
                ))}
              </Select>
              <Select
                placeholder="右侧版本"
                value={rightVersionId}
                loading={versionsQuery.isFetching}
                onChange={(v) => setRightVersionId(Number(v ?? 0))}
                style={{ width: 240 }}
              >
                <Select.Option value={0}>当前草稿</Select.Option>
                {versions.map((version) => (
                  <Select.Option key={version.id} value={version.id}>
                    v{version.version} {version.name}
                  </Select.Option>
                ))}
              </Select>
              <Button type="primary" icon={<GitCompare size={14} />} loading={diffQuery.isFetching} onClick={() => { void handleDiff(); }}>
                对比
              </Button>
            </Space>
            {diffData ? (
              <>
                {/* 变更摘要 */}
                <Space wrap style={{ marginBottom: 12 }}>
                  <Tag size="large" color="green">节点 +{diffData.summary.nodesAdded}</Tag>
                  <Tag size="large" color="red">节点 -{diffData.summary.nodesRemoved}</Tag>
                  <Tag size="large" color="orange">节点 ~{diffData.summary.nodesModified}</Tag>
                  <Tag size="large" color="green">连线 +{diffData.summary.edgesAdded}</Tag>
                  <Tag size="large" color="red">连线 -{diffData.summary.edgesRemoved}</Tag>
                  <Tag size="large" color="orange">连线 ~{diffData.summary.edgesModified}</Tag>
                </Space>

                {/* 结构化变更列表 */}
                {(diffData.nodeChanges.length > 0 || diffData.edgeChanges.length > 0) ? (
                  <div style={{ marginBottom: 16, maxHeight: 320, overflow: 'auto', border: '1px solid var(--semi-color-border)', borderRadius: 6, padding: 12 }}>
                    {diffData.nodeChanges.map((c) => (
                      <div key={`n-${c.nodeKey}`} style={{ padding: '6px 0', borderBottom: '1px dashed var(--semi-color-border)' }}>
                        <Space spacing={8} align="start">
                          <Tag size="small" color={DIFF_KIND_META[c.kind].color}>{DIFF_KIND_META[c.kind].text}</Tag>
                          <div>
                            <Typography.Text strong size="small">{c.nodeName}</Typography.Text>
                            <Typography.Text size="small" type="tertiary"> · {c.nodeType}</Typography.Text>
                            {c.fields.map((f) => (
                              <div key={f.field} style={{ fontSize: 12, marginTop: 2 }}>
                                <Typography.Text size="small" type="tertiary">{f.field}：</Typography.Text>
                                <Typography.Text size="small" delete type="danger">{f.before}</Typography.Text>
                                <Typography.Text size="small" type="tertiary"> → </Typography.Text>
                                <Typography.Text size="small" type="success">{f.after}</Typography.Text>
                              </div>
                            ))}
                          </div>
                        </Space>
                      </div>
                    ))}
                    {diffData.edgeChanges.map((c, i) => (
                      <div key={`e-${i}`} style={{ padding: '6px 0', borderBottom: '1px dashed var(--semi-color-border)' }}>
                        <Space spacing={8} align="start">
                          <Tag size="small" color={DIFF_KIND_META[c.kind].color}>{DIFF_KIND_META[c.kind].text}连线</Tag>
                          <div style={{ fontSize: 12 }}>
                            <Typography.Text size="small">{c.from} → {c.to}</Typography.Text>
                            {c.kind === 'modified' && (
                              <div style={{ marginTop: 2 }}>
                                <Typography.Text size="small" delete type="danger">{c.before}</Typography.Text>
                                <Typography.Text size="small" type="tertiary"> → </Typography.Text>
                                <Typography.Text size="small" type="success">{c.after}</Typography.Text>
                              </div>
                            )}
                            {c.kind !== 'modified' && (c.after ?? c.before) && (
                              <Typography.Text size="small" type="tertiary"> · {c.after ?? c.before}</Typography.Text>
                            )}
                          </div>
                        </Space>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ marginBottom: 16, color: 'var(--semi-color-success)' }}>两个版本的流程结构一致，未检测到节点/连线变化。</div>
                )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {[
                  { key: 'left', side: diffData.left },
                  { key: 'right', side: diffData.right },
                ].map(({ key, side }) => (
                  <div key={key}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>{side.label}</div>
                    <div style={{ color: 'var(--semi-color-text-2)', marginBottom: 8 }}>
                      {side.publishedAt ? formatDateTime(side.publishedAt) : '未发布'}
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: 12,
                        minHeight: 240,
                        maxHeight: 420,
                        overflow: 'auto',
                        border: '1px solid var(--semi-color-border)',
                        borderRadius: 6,
                        background: 'var(--semi-color-fill-0)',
                        fontSize: 12,
                        lineHeight: 1.6,
                      }}
                    >
                      {stringifyFlowData(side.flowData)}
                    </pre>
                  </div>
                ))}
              </div>
              </>
            ) : (
              <div style={{ color: 'var(--semi-color-text-2)' }}>请选择两个版本并点击「对比」。</div>
            )}
          </Modal>
        </div>
      }
    />
    </div>
  );
}
