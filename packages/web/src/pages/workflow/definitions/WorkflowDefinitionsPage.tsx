import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Modal, Select, Space, Tag, Typography, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Ban, CircleCheck, GitCompare, Layers, LayoutTemplate, Save, Trash2, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { importWorkflowDefinitionSchema, workflowDefinitionContract, WORKFLOW_FORM_TYPE_LABELS, type WorkflowDefinition, type WorkflowFormType, type WorkflowVersionDiff as WorkflowVersionDiffData } from '@zenith/shared/workflow';
import { api } from '@/lib/contract-query';
import { downloadBlob } from '@/utils/download';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import WorkflowVersionsSheet from '../components/WorkflowVersionsSheet';
import WorkflowTemplateFormModal, { type WorkflowTemplateFormValues } from '../components/WorkflowTemplateFormModal';
import CategorySidebar from './components/CategorySidebar';
import { TemplateGalleryModal } from './components/TemplateGalleryModal';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
import { useListSearch } from '@/hooks/useListSearch';
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
import { WORKFLOW_DIFF_KIND_META as DIFF_KIND_META } from '../constants';
import { PUBLISHABLE_STATUS_META as STATUS_MAP } from '@/lib/publishable-status';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput, StatusSelect } from '@/components/search-filters';

const STATUS_FILTER_OPTIONS = [{ value: 'draft', label: '草稿' }, { value: 'published', label: '已发布' }, { value: 'disabled', label: '已禁用' }];
import { confirmDelete, confirmDanger } from '@/utils/confirm';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const FORM_TYPE_COLOR: Record<WorkflowFormType, TagColor> = {
  designer: 'blue',
  custom: 'purple',
  external: 'orange',
};

interface SearchParams {
  keyword: string;
  status?: string;
  selectedCategoryId: number | null;
}

const defaultSearchParams: SearchParams = { keyword: '', status: undefined, selectedCategoryId: null };

const stringifyFlowData = (value: unknown) => JSON.stringify(value ?? null, null, 2);

export default function WorkflowDefinitionsPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, applySearch, handleReset,
  } = useListSearch<SearchParams>({
    defaults: defaultSearchParams,
    listKey: workflowDefinitionKeys.lists,
    // 条件变化后原先勾选的行可能已不在结果集里，一并清空
    onSearch: () => setSelectedRowKeys([]),
    onReset: () => setSelectedRowKeys([]),
  });
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
  // 版本对比下拉：取最近 100 个版本（对比场景聚焦近期版本，避免全量拉取）
  const versionsQuery = useWorkflowDefinitionVersions(diffTarget?.id, { page: 1, pageSize: 100 }, !!diffTarget);
  const versions = useMemo(() => versionsQuery.data?.list ?? [], [versionsQuery.data]);
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
    applySearch({ ...draftParams, selectedCategoryId: id });
    setShowCategorySidebar(false);
  };

  const handlePublish = async (record: WorkflowDefinition) => {
    await publishMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('发布成功');
  };

  const handleDisable = async (record: WorkflowDefinition) => {
    await disableMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('已禁用');
  };

  const handleEnable = async (record: WorkflowDefinition) => {
    await enableMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('已启用');
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync({ params: { id } });
    Toast.success('删除成功');
  };

  const batchDisable = () => {
    if (selectedRowKeys.length === 0) return;
    confirmDanger({
      title: `确定禁用选中的 ${selectedRowKeys.length} 个流程？`,
      content: '仅「已发布」状态的流程会被禁用，禁用后不可发起新申请。',
      onOk: async () => {
        await batchDisableMutation.mutateAsync({ body: { ids: selectedRowKeys } });
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
        await batchEnableMutation.mutateAsync({ body: { ids: selectedRowKeys } });
        Toast.success('操作成功');
        setSelectedRowKeys([]);
      },
    });
  };

  const batchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    confirmDelete({
      title: `确定删除选中的 ${selectedRowKeys.length} 个流程？`,
      content: '仅「非已发布」且无发起实例的流程会被删除，删除后无法恢复。',
      onOk: async () => {
        await batchDeleteMutation.mutateAsync({ body: { ids: selectedRowKeys } });
        Toast.success('删除成功');
        setSelectedRowKeys([]);
      },
    });
  };

  const handleDuplicate = async (record: WorkflowDefinition) => {
    await duplicateMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('已复制为新草稿');
  };

  const handleExport = async (record: WorkflowDefinition) => {
    const exported = await api(workflowDefinitionContract.export, { params: { id: record.id } });
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json;charset=utf-8' });
    downloadBlob(blob, `${record.name}.workflow.json`);
    Toast.success('已导出');
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    try {
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        Toast.error('文件格式不正确');
        return;
      }
      // 导出文件即导入请求体：按共享校验 schema 解析，剔除 exportedAt 等只读字段
      const parsed = importWorkflowDefinitionSchema.safeParse(raw);
      if (!parsed.success) {
        Toast.error(parsed.error.issues[0]?.message ?? '文件格式不正确');
        return;
      }
      await importMutation.mutateAsync({ body: parsed.data });
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
      body: {
        definitionId: saveAsTarget.id,
        name: values.name ?? '',
        code: values.code,
        description: values.description,
        icon: values.icon,
        color: values.color,
      },
    });
    Toast.success('已保存为模板');
    setSaveAsTarget(null);
  };

  const columns: ColumnProps<WorkflowDefinition>[] = [
    {
      title: '流程名称',
      dataIndex: 'name',
      minWidth: 260,
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
          <Space spacing={6}>
            {color && <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />}
            <span>{record.categoryName}</span>
          </Space>
        );
      },
    },
    {
      title: '表单类型',
      dataIndex: 'formType',
      width: 140,
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
    dateTimeColumn('更新时间', 'updatedAt'),
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
      width: 180,
      desktopInlineKeys: ['design', 'publish', 'disable', 'enable'],
      actions: (record) => {
        const canPublish = record.status === 'draft' && hasPermission('workflow:definition:publish');
        return [
          { key: 'design', label: '设计', onClick: () => navigate(`/workflow/designer/${record.id}`) },
          {
            key: 'publish',
            label: '发布',
            type: 'primary',
            hidden: !canPublish,
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
              confirmDanger({
                title: '确定禁用此流程？',
                content: '禁用后该流程不可发起新申请，是否继续？',
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
              confirmDelete({
                title: '确定要删除该流程吗？',
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
    <KeywordInput placeholder="搜索流程名称" value={draftParams.keyword} onChange={(v) => setDraftParams((prev) => ({ ...prev, keyword: v }))} width={200} />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={STATUS_FILTER_OPTIONS}
      value={draftParams.status}
      onChange={(v) => setDraftParams((prev) => ({ ...prev, status: v }))}
    />
  );

  const renderSearchButton = () => (
    <SearchButton onClick={handleSearch} />
  );

  const renderResetButton = () => (
    <ResetButton onClick={handleReset} />
  );

  const renderCreateButton = () => hasPermission('workflow:definition:create') ? (
    <CreateButton onClick={() => {
      const qs = draftParams.selectedCategoryId === null ? '' : `?categoryId=${draftParams.selectedCategoryId}`;
      navigate(`/workflow/designer/new${qs}`);
    }}>新建流程</CreateButton>
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
      onMasterBack={() => setShowCategorySidebar(false)}
      masterBackLabel="返回流程列表"
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
            <WorkflowVersionsSheet
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
                  <div style={{ marginBottom: 16, maxHeight: 320, overflow: 'auto', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 12 }}>
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

              <div className="auto-grid" style={{ ['--auto-grid-min' as string]: '280px', ['--auto-grid-cols' as string]: 2 }}>
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
                        borderRadius: 'var(--semi-border-radius-medium)',
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
