import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dropdown, Form, Input, Modal, Select, Space, Tag,
  Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Ban, CircleCheck, GitCompare, LayoutTemplate, MoreHorizontal, Plus, RotateCcw, Save, Search, Trash2, Upload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { WorkflowDefinition, WorkflowDefinitionVersion, PaginatedResponse, WorkflowFormType } from '@zenith/shared';
import { WORKFLOW_FORM_TYPE_LABELS } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import WorkflowVersionsModal from '../components/WorkflowVersionsModal';
import CategorySidebar from './components/CategorySidebar';
import { TemplateGalleryModal } from './components/TemplateGalleryModal';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { renderEllipsis } from '../../../utils/table-columns';
import { usePagination } from '@/hooks/usePagination';

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

interface WorkflowVersionDiffSide {
  version: number;
  name: string;
  label: string;
  flowData: unknown;
  publishedAt: string | null;
}

interface WorkflowVersionDiffData {
  left: WorkflowVersionDiffSide;
  right: WorkflowVersionDiffSide;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '', selectedCategoryId: null };

const stringifyFlowData = (value: unknown) => JSON.stringify(value ?? null, null, 2);

export default function WorkflowDefinitionsPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PaginatedResponse<WorkflowDefinition> | null>(null);
  const { page, setPage, pageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [openMoreId, setOpenMoreId] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const canBatchOperate = hasPermission('workflow:definition:publish') || hasPermission('workflow:definition:delete');
  const [historyTarget, setHistoryTarget] = useState<WorkflowDefinition | null>(null);
  const [templateGalleryVisible, setTemplateGalleryVisible] = useState(false);
  const [saveAsTarget, setSaveAsTarget] = useState<WorkflowDefinition | null>(null);
  const [saveAsLoading, setSaveAsLoading] = useState(false);
  const saveAsFormRef = useRef<FormApi | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);
  const [diffTarget, setDiffTarget] = useState<WorkflowDefinition | null>(null);
  const [versions, setVersions] = useState<WorkflowDefinitionVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [leftVersionId, setLeftVersionId] = useState(0);
  const [rightVersionId, setRightVersionId] = useState(0);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffData, setDiffData] = useState<WorkflowVersionDiffData | null>(null);
  const { categories, refetch: refetchCategories } = useWorkflowCategories();

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const { keyword: kw, status: st, selectedCategoryId: cid } = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(kw ? { keyword: kw } : {}),
        ...(st ? { status: st } : {}),
        ...(cid === null ? {} : { categoryId: String(cid) }),
      }).toString();
      const res = await request.get<PaginatedResponse<WorkflowDefinition>>(`/api/workflows/definitions?${query}`);
      if (res.code === 0) {
        setData(res.data);
        setPage(res.data.page);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
  }, [fetchList]);

  const handleSelectCategory = (id: number | null) => {
    setSelectedRowKeys([]);
    setSearchParams((prev) => ({ ...prev, selectedCategoryId: id }));
    setPage(1);
    void fetchList(1, pageSize, { ...searchParamsRef.current, selectedCategoryId: id });
  };

  const handleSearch = () => {
    setSelectedRowKeys([]);
    setPage(1);
    void fetchList(1, pageSize);
  };

  const handleReset = () => {
    setSelectedRowKeys([]);
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchList(1, pageSize, defaultSearchParams);
  };

  const handlePublish = async (record: WorkflowDefinition) => {
    const res = await request.post(`/api/workflows/definitions/${record.id}/publish`, {});
    if (res.code === 0) {
      Toast.success('发布成功');
      void fetchList();
    }
  };

  const handleDisable = async (record: WorkflowDefinition) => {
    const res = await request.post(`/api/workflows/definitions/${record.id}/disable`, {});
    if (res.code === 0) {
      Toast.success('已禁用');
      void fetchList();
    }
  };

  const handleEnable = async (record: WorkflowDefinition) => {
    const res = await request.post(`/api/workflows/definitions/${record.id}/enable`, {});
    if (res.code === 0) {
      Toast.success('已启用');
      void fetchList();
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/workflows/definitions/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchList();
    }
  };

  const batchDisable = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确定禁用选中的 ${selectedRowKeys.length} 个流程？`,
      content: '仅「已发布」状态的流程会被禁用，禁用后不可发起新申请。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.post('/api/workflows/definitions/batch-disable', { ids: selectedRowKeys });
        if (res.code === 0) {
          Toast.success(res.message || '操作成功');
          setSelectedRowKeys([]);
          void fetchList();
        }
      },
    });
  };

  const batchEnable = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: `确定启用选中的 ${selectedRowKeys.length} 个流程？`,
      content: '仅「已禁用」状态的流程会被启用，启用后恢复为已发布状态。',
      onOk: async () => {
        const res = await request.post('/api/workflows/definitions/batch-enable', { ids: selectedRowKeys });
        if (res.code === 0) {
          Toast.success(res.message || '操作成功');
          setSelectedRowKeys([]);
          void fetchList();
        }
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
        const res = await request.post('/api/workflows/definitions/batch-delete', { ids: selectedRowKeys });
        if (res.code === 0) {
          Toast.success(res.message || '删除成功');
          setSelectedRowKeys([]);
          void fetchList();
        }
      },
    });
  };

  const handleDuplicate = async (record: WorkflowDefinition) => {
    const res = await request.post<WorkflowDefinition>(`/api/workflows/definitions/${record.id}/duplicate`, {});
    if (res.code === 0) {
      Toast.success('已复制为新草稿');
      void fetchList();
    }
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
      const res = await request.post<WorkflowDefinition>('/api/workflows/definitions/import', payload);
      if (res.code === 0) {
        Toast.success('已导入为新草稿');
        void fetchList();
      }
    } finally {
      setImporting(false);
    }
  };

  const openDiffModal = async (record: WorkflowDefinition) => {
    setOpenMoreId(null);
    setDiffTarget(record);
    setVersions([]);
    setDiffData(null);
    setLeftVersionId(0);
    setRightVersionId(0);
    setVersionsLoading(true);
    try {
      const res = await request.get<WorkflowDefinitionVersion[]>(`/api/workflows/definitions/${record.id}/versions`);
      if (res.code === 0) {
        const list = res.data ?? [];
        setVersions(list);
        const latest = list.reduce<WorkflowDefinitionVersion | null>(
          (max, item) => (!max || item.version > max.version ? item : max),
          null,
        );
        setLeftVersionId(latest?.id ?? 0);
      }
    } finally {
      setVersionsLoading(false);
    }
  };

  const handleDiff = async () => {
    if (!diffTarget) return;
    setDiffLoading(true);
    try {
      const query = new URLSearchParams({
        left: String(leftVersionId),
        right: String(rightVersionId),
      }).toString();
      const res = await request.get<WorkflowVersionDiffData>(`/api/workflows/definitions/${diffTarget.id}/diff?${query}`);
      if (res.code === 0) setDiffData(res.data);
    } finally {
      setDiffLoading(false);
    }
  };

  const closeDiffModal = () => {
    setDiffTarget(null);
    setVersions([]);
    setDiffData(null);
  };

  const handleSaveAsTemplate = async (values: { name: string; code?: string; description?: string; icon?: string; color?: string }) => {
    if (!saveAsTarget) return;
    setSaveAsLoading(true);
    try {
      const res = await request.post('/api/workflows/templates/save-as', {
        definitionId: saveAsTarget.id,
        ...values,
      });
      if (res.code === 0) {
        Toast.success('已保存为模板');
        setSaveAsTarget(null);
      }
    } finally {
      setSaveAsLoading(false);
    }
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
    {
      title: '操作',
      key: 'action',
      width: 170,
      fixed: 'right',
      render: (_: unknown, record: WorkflowDefinition) => {
        const canPublish = record.status === 'draft' && hasPermission('workflow:definition:publish');
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '44px 44px 28px', alignItems: 'center', columnGap: 8 }}>
            <Button theme="borderless" size="small" onClick={() => navigate(`/workflow/designer/${record.id}`)}>
              设计
            </Button>
            <Button theme="borderless" size="small" type="primary" disabled={!canPublish} onClick={() => {
              if (!canPublish) return;
              Modal.confirm({
                title: '确定发布此流程？',
                content: '发布后不可删除，请确认流程配置正确。',
                onOk: () => handlePublish(record),
              });
            }}>发布</Button>
            <Dropdown
              trigger="custom"
              visible={openMoreId === record.id}
              onClickOutSide={() => setOpenMoreId(null)}
              position="bottomRight"
              render={
                <Dropdown.Menu>
                  {hasPermission('workflow:definition:create') && (
                    <Dropdown.Item onClick={() => { setOpenMoreId(null); void handleDuplicate(record); }}>复制</Dropdown.Item>
                  )}
                  <Dropdown.Item onClick={() => { setOpenMoreId(null); void handleExport(record); }}>导出</Dropdown.Item>
                  {record.status === 'published' && hasPermission('workflow:definition:publish') && (
                    <Dropdown.Item type="warning" onClick={() => {
                      setOpenMoreId(null);
                      Modal.confirm({
                        title: '确定禁用此流程？',
                        content: '禁用后该流程不可发起新申请，是否继续？',
                        okButtonProps: { type: 'danger', theme: 'solid' },
                        onOk: () => handleDisable(record),
                      });
                    }}>禁用</Dropdown.Item>
                  )}
                  {record.status === 'disabled' && hasPermission('workflow:definition:publish') && (
                    <Dropdown.Item onClick={() => {
                      setOpenMoreId(null);
                      Modal.confirm({
                        title: '确定启用此流程？',
                        content: '启用后该流程将恢复为已发布状态，可正常发起申请。',
                        onOk: () => handleEnable(record),
                      });
                    }}>启用</Dropdown.Item>
                  )}
                  <Dropdown.Item onClick={() => { setOpenMoreId(null); setHistoryTarget(record); }}>历史版本</Dropdown.Item>
                  <Dropdown.Item onClick={() => { void openDiffModal(record); }}>版本对比</Dropdown.Item>
                  {hasPermission('workflow:definition:create') && (
                    <Dropdown.Item onClick={() => { setOpenMoreId(null); setSaveAsTarget(record); }}>另存为模板</Dropdown.Item>
                  )}
                  {record.status !== 'published' && hasPermission('workflow:definition:delete') && (
                    <Dropdown.Item
                      type="danger"
                      onClick={() => {
                        setOpenMoreId(null);
                        Modal.confirm({
                          title: '确定要删除该流程吗？',
                          okButtonProps: { type: 'danger', theme: 'solid' },
                          onOk: () => handleDelete(record.id),
                        });
                      }}
                    >删除</Dropdown.Item>
                  )}
                </Dropdown.Menu>
              }
            >
              <Button
                theme="borderless"
                size="small"
                icon={<MoreHorizontal size={16} />}
                aria-label="更多操作"
                onClick={() => setOpenMoreId(openMoreId === record.id ? null : record.id)}
              />
            </Dropdown>
          </div>
        );
      },
    },
  ];

  return (
    <div className="page-container">
    <MasterDetailLayout
      defaultSize={220}
      minSize={180}
      maxSize={360}
      persistKey="workflow-definitions"
      master={
        <CategorySidebar
          categories={categories}
          selectedId={searchParams.selectedCategoryId}
          onSelect={handleSelectCategory}
          onChanged={() => { refetchCategories(); void fetchList(); }}
          canManage={hasPermission('workflow:definition:create')}
        />
      }
      detail={
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SearchToolbar>
            <input
              ref={importInputRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={(event) => { void handleImportFile(event); }}
            />
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索流程名称"
              value={searchParams.keyword}
              onChange={(v) => setSearchParams((prev) => ({ ...prev, keyword: v }))}
              showClear
              style={{ width: 200 }}
            />
            <Select
              placeholder="状态"
              value={searchParams.status || undefined}
              onChange={(v) => setSearchParams((prev) => ({ ...prev, status: typeof v === 'string' ? v : '' }))}
              showClear
              style={{ width: 120 }}
            >
              <Select.Option value="draft">草稿</Select.Option>
              <Select.Option value="published">已发布</Select.Option>
              <Select.Option value="disabled">已禁用</Select.Option>
            </Select>
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {hasPermission('workflow:definition:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={() => {
                const qs = searchParams.selectedCategoryId === null ? '' : `?categoryId=${searchParams.selectedCategoryId}`;
                navigate(`/workflow/designer/new${qs}`);
              }}>
                新建流程
              </Button>
            )}
            {hasPermission('workflow:definition:create') && (
              <Button
                type="primary"
                icon={<Upload size={14} />}
                loading={importing}
                onClick={() => importInputRef.current?.click()}
              >
                导入
              </Button>
            )}
            {hasPermission('workflow:definition:create') && (
              <Button type="tertiary" icon={<LayoutTemplate size={14} />} onClick={() => setTemplateGalleryVisible(true)}>
                从模板新建
              </Button>
            )}
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
          </SearchToolbar>
          <ConfigurableTable
            bordered
            columns={columns}
            dataSource={data?.list ?? []}
            rowKey="id"
            loading={loading}
            onRefresh={() => void fetchList()}
            refreshLoading={loading}
            pagination={buildPagination(data?.total ?? 0, fetchList)}
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
              onRestored={() => { void fetchList(); }}
            />
          )}
          <TemplateGalleryModal
            visible={templateGalleryVisible}
            onCancel={() => setTemplateGalleryVisible(false)}
            categoryId={searchParams.selectedCategoryId}
            onCreated={(id) => {
              setTemplateGalleryVisible(false);
              navigate(`/workflow/designer/${id}`);
            }}
          />
          <Modal
            title="另存为模板"
            visible={!!saveAsTarget}
            onCancel={() => setSaveAsTarget(null)}
            closeOnEsc
            okText="保存"
            okButtonProps={{ loading: saveAsLoading, icon: <Save size={14} /> }}
            onOk={() => {
              saveAsFormRef.current?.validate().then((values) => {
                void handleSaveAsTemplate(values as { name: string; code?: string; description?: string; icon?: string; color?: string });
              });
            }}
          >
            <Form
              labelPosition="left"
              labelWidth={70}
              getFormApi={(api) => { saveAsFormRef.current = api; }}
              initValues={{ name: saveAsTarget?.name ?? '' }}
            >
              <Form.Input
                field="name"
                label="模板名称"
                placeholder="请输入模板名称"
                rules={[{ required: true, message: '请输入模板名称' }]}
              />
              <Form.Input
                field="code"
                label="模板编码"
                placeholder="选填，唯一标识"
              />
              <Form.Input
                field="description"
                label="描述"
                placeholder="选填"
              />
              <Form.Input
                field="icon"
                label="图标"
                placeholder="选填，lucide 图标名"
              />
              <Form.Input
                field="color"
                label="颜色"
                placeholder="选填，如 #1677ff"
              />
            </Form>
          </Modal>
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
                loading={versionsLoading}
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
                loading={versionsLoading}
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
              <Button type="primary" icon={<GitCompare size={14} />} loading={diffLoading} onClick={() => { void handleDiff(); }}>
                对比
              </Button>
            </Space>
            {diffData ? (
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
                        minHeight: 360,
                        maxHeight: 560,
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
