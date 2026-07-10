import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Input, Select, SideSheet, Space, Tag, Toast, Modal, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { FolderTree, Search, RotateCcw, Plus, Star } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { ShareModal, VersionModal } from './components/DashboardOpsModals';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import type { ReportDashboard, ReportWidget } from '@zenith/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  reportDashboardKeys,
  useDeleteReportDashboard,
  useDeleteReportDashboardCategory,
  useBatchReportDashboardStatus,
  useCloneReportDashboard,
  useOfflineReportDashboard,
  usePublishReportDashboard,
  useReportDashboardCategories,
  useReportDashboardList,
  useSaveReportDashboardCategory,
  useSaveReportDashboard,
  useToggleReportDashboardFavorite,
} from '@/hooks/queries/report-dashboards';
import { useDictItems } from '@/hooks/useDictItems';

interface SearchParams { keyword: string; status: string; lifecycleStatus: '' | ReportDashboard['lifecycleStatus']; categoryId?: number; favorited: boolean }
const defaultSearchParams: SearchParams = { keyword: '', status: '', lifecycleStatus: '', favorited: false };

export default function DashboardListPage() {
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();

  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportDashboard | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [categorySheetVisible, setCategorySheetVisible] = useState(false);
  const [categoryModalVisible, setCategoryModalVisible] = useState(false);
  const [editingCategory, setEditingCategory] = useState<(typeof categories)[number] | null>(null);
  const categoryFormApi = useRef<FormApi | null>(null);
  const [shareTarget, setShareTarget] = useState<number | null>(null);
  const [versionTarget, setVersionTarget] = useState<number | null>(null);

  const listQuery = useReportDashboardList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    lifecycleStatus: submittedParams.lifecycleStatus || undefined,
    categoryId: submittedParams.categoryId,
    favorited: submittedParams.favorited || undefined,
  });
  const data = listQuery.data ?? null;
  const categoriesQuery = useReportDashboardCategories();
  const categories = categoriesQuery.data ?? [];
  const saveMutation = useSaveReportDashboard();
  const deleteMutation = useDeleteReportDashboard();
  const batchStatusMutation = useBatchReportDashboardStatus();
  const cloneMutation = useCloneReportDashboard();
  const saveCategoryMutation = useSaveReportDashboardCategory();
  const deleteCategoryMutation = useDeleteReportDashboardCategory();
  const favoriteMutation = useToggleReportDashboardFavorite();
  const publishMutation = usePublishReportDashboard();
  const offlineMutation = useOfflineReportDashboard();
  const favTogglingId = favoriteMutation.isPending ? favoriteMutation.variables ?? null : null;

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: reportDashboardKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearchParams); setSubmittedParams(defaultSearchParams); setPage(1); void queryClient.invalidateQueries({ queryKey: reportDashboardKeys.lists }); }

  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(record: ReportDashboard) { setEditing(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }
  function openCategoryCreate() { setEditingCategory(null); setCategoryModalVisible(true); }
  function openCategoryEdit(record: (typeof categories)[number]) { setEditingCategory(record); setCategoryModalVisible(true); }
  function closeCategoryModal() { setCategoryModalVisible(false); setEditingCategory(null); }

  const formInitValues = editing
    ? { name: editing.name, status: editing.status, remark: editing.remark ?? '', categoryId: editing.categoryId ?? undefined }
    : { status: 'enabled' };

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try { values = await formApi.current?.validate() as Record<string, unknown>; }
    catch { throw new Error('validation'); }
    const payload: Record<string, unknown> = {
      name: String(values.name ?? ''),
      status: values.status as ReportDashboard['status'],
      remark: values.remark ? String(values.remark) : undefined,
      categoryId: values.categoryId == null ? null : Number(values.categoryId),
      expectedRevision: editing?.revision,
    };
    const saved = await saveMutation.mutateAsync({
      id: editing?.id,
      values: editing ? payload : { ...payload, layout: [], widgets: [] },
    });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
    if (!editing) navigate(`/report/dashboards/${saved.id}/design`);
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  async function handleBatchStatus(status: 'enabled' | 'disabled') {
    if (selectedRowKeys.length === 0) return;
    await batchStatusMutation.mutateAsync({ ids: selectedRowKeys, status });
    setSelectedRowKeys([]);
    Toast.success(status === 'enabled' ? '批量启用成功' : '批量停用成功');
  }

  async function handleClone(record: ReportDashboard) {
    const cloned = await cloneMutation.mutateAsync({ id: record.id });
    Toast.success(`已复制为「${cloned.name}」`);
  }

  async function handleCategorySave() {
    let values: Record<string, unknown>;
    try { values = await categoryFormApi.current?.validate() as Record<string, unknown>; }
    catch { throw new Error('validation'); }
    await saveCategoryMutation.mutateAsync({
      id: editingCategory?.id,
      values: {
        name: String(values.name ?? '').trim(),
        sort: Number(values.sort ?? 0),
        remark: values.remark ? String(values.remark) : undefined,
      },
    });
    Toast.success(editingCategory ? '分类更新成功' : '分类创建成功');
    closeCategoryModal();
  }

  async function handleCategoryDelete(record: (typeof categories)[number]) {
    Modal.confirm({
      title: `确定删除分类「${record.name}」吗？`,
      content: record.dashboardCount
        ? `该分类已被 ${record.dashboardCount} 个仪表盘引用。删除后这些仪表盘的分类将自动置空。`
        : '删除后不可恢复。',
      onOk: async () => {
        await deleteCategoryMutation.mutateAsync(record.id);
        Toast.success('分类删除成功');
      },
    });
  }

  async function toggleFavorite(record: ReportDashboard) {
    await favoriteMutation.mutateAsync(record.id);
  }

  async function handlePublish(record: ReportDashboard) {
    await publishMutation.mutateAsync({ dashboardId: record.id, expectedRevision: record.revision });
    Toast.success('发布成功');
  }

  async function handleOffline(record: ReportDashboard) {
    await offlineMutation.mutateAsync({ dashboardId: record.id, expectedRevision: record.revision });
    Toast.success('下线成功');
  }

  function lifecycleTag(status: ReportDashboard['lifecycleStatus']) {
    if (status === 'published') return <Tag color="green" size="small">已发布</Tag>;
    if (status === 'offline') return <Tag color="orange" size="small">已下线</Tag>;
    return <Tag color="grey" size="small">草稿</Tag>;
  }

  const columns: ColumnProps<ReportDashboard>[] = [
    {
      title: '', dataIndex: '__fav', width: 44, align: 'center',
      render: (_: unknown, r: ReportDashboard) => (
        <Star size={15} style={{ cursor: 'pointer', color: r.favorited ? 'var(--semi-color-warning)' : 'var(--semi-color-text-3)', fill: r.favorited ? 'var(--semi-color-warning)' : 'none', opacity: favTogglingId === r.id ? 0.4 : 1 }} onClick={() => void toggleFavorite(r)} />
      ),
    },
    { title: '名称', dataIndex: 'name', width: 200 },
    { title: '分类', dataIndex: 'categoryName', width: 120, render: (v: string) => v ? <Tag size="small" color="light-blue">{v}</Tag> : '-' },
    { title: '组件数', dataIndex: 'widgets', width: 80, render: (w: ReportWidget[]) => (w?.length ?? 0) },
    { title: '备注', dataIndex: 'remark', width: 180, render: renderEllipsis },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    { title: '生命周期', dataIndex: 'lifecycleStatus', width: 90, fixed: 'right', render: (value: ReportDashboard['lifecycleStatus']) => lifecycleTag(value) },
    { title: '状态', dataIndex: 'status', width: 70, fixed: 'right', render: (s: string) => s === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="grey" size="small">停用</Tag> },
    createOperationColumn<ReportDashboard>({
      width: 300,
      desktopInlineKeys: ['design', 'view'],
      actions: (record) => [
        ...(hasPermission('report:dashboard:update') ? [{ key: 'design', label: '设计', onClick: () => navigate(`/report/dashboards/${record.id}/design`) }] : []),
        { key: 'view', label: '预览', onClick: () => navigate(`/report/dashboards/${record.id}/view`) },
        ...(hasPermission('report:dashboard:update') && record.lifecycleStatus !== 'published' ? [{ key: 'publish', label: '发布', onClick: () => void handlePublish(record) }] : []),
        ...(hasPermission('report:dashboard:update') && record.lifecycleStatus === 'published' ? [{ key: 'offline', label: '下线', onClick: () => void handleOffline(record) }] : []),
        ...(hasPermission('report:dashboard:update') ? [{ key: 'share', label: '分享', onClick: () => setShareTarget(record.id) }] : []),
        ...(hasPermission('report:dashboard:update') ? [{ key: 'version', label: '版本', onClick: () => setVersionTarget(record.id) }] : []),
        ...(hasPermission('report:dashboard:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(record) }] : []),
        ...(hasPermission('report:dashboard:create') ? [{ key: 'clone', label: '复制', onClick: () => void handleClone(record) }] : []),
        ...(hasPermission('report:dashboard:delete') ? [{ key: 'delete', label: '删除', danger: true, onClick: () => { Modal.confirm({ title: '确定要删除吗？', content: '删除后不可恢复', onOk: () => handleDelete(record.id) }); } }] : []),
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
  const renderLifecycleFilter = () => (
    <Select
     placeholder="全部生命周期"
     value={draftParams.lifecycleStatus || undefined}
     onChange={(v) => setDraftParams((p) => ({ ...p, lifecycleStatus: (v as SearchParams['lifecycleStatus']) ?? '' }))}
     showClear
     style={{ width: 140 }}
     optionList={[
       { value: 'draft', label: '草稿' },
       { value: 'published', label: '已发布' },
       { value: 'offline', label: '已下线' },
     ]}
    />
  );
  const renderSearchBtn = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetBtn = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateBtn = () => hasPermission('report:dashboard:create')
    ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;
  const renderCategoryManageBtn = () => hasPermission('report:dashboard:update')
    ? <Button icon={<FolderTree size={14} />} onClick={() => setCategorySheetVisible(true)}>分类管理</Button> : null;
  const renderCategoryFilter = () => (
    <Select placeholder="全部分类" value={draftParams.categoryId} onChange={(v) => setDraftParams((p) => ({ ...p, categoryId: v as number | undefined }))}
      showClear style={{ width: 140 }} optionList={categories.map((c) => ({ value: c.id, label: c.name }))} />
  );
  const renderFavToggle = () => (
    <Button theme={draftParams.favorited ? 'solid' : 'light'} type={draftParams.favorited ? 'warning' : 'tertiary'} icon={<Star size={14} />}
      onClick={() => setDraftParams((p) => {
        const np = { ...p, favorited: !p.favorited };
        setSubmittedParams(np);
        setPage(1);
        void queryClient.invalidateQueries({ queryKey: reportDashboardKeys.lists });
        return np;
      })}>收藏</Button>
  );
  const renderBatchEnableBtn = () => selectedRowKeys.length > 0 && hasPermission('report:dashboard:update')
    ? <Button onClick={() => void handleBatchStatus('enabled')}>批量启用</Button> : null;
  const renderBatchDisableBtn = () => selectedRowKeys.length > 0 && hasPermission('report:dashboard:update')
    ? <Button type="danger" onClick={() => void handleBatchStatus('disabled')}>批量停用</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}{renderCategoryFilter()}{renderStatusFilter()}{renderLifecycleFilter()}{renderFavToggle()}{renderSearchBtn()}{renderResetBtn()}</>}
        actions={<>{renderBatchEnableBtn()}{renderBatchDisableBtn()}{renderCategoryManageBtn()}{renderCreateBtn()}</>}
        mobilePrimary={<>{renderKeyword()}{renderSearchBtn()}{renderCreateBtn()}</>}
        mobileFilters={<>{renderCategoryFilter()}{renderStatusFilter()}{renderLifecycleFilter()}{renderFavToggle()}</>}
        mobileActions={<>{renderBatchEnableBtn()}{renderBatchDisableBtn()}{renderCategoryManageBtn()}</>}
        filterTitle="仪表盘筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        rowSelection={hasPermission('report:dashboard:update') ? {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        } : undefined}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal
        title={editing ? '编辑仪表盘' : '新增仪表盘'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={520}
      >
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInitValues} labelPosition="left" labelWidth={72}>
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={64} showClear />
          <Form.Select field="status" label="状态" style={{ width: '100%' }}
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
          <Form.Select field="categoryId" label="分类" style={{ width: '100%' }} showClear placeholder="未分类"
            optionList={categories.map((c) => ({ value: c.id, label: c.name }))} />
          <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
        </Form>
      </AppModal>

      <ShareModal visible={shareTarget !== null} dashboardId={shareTarget} onClose={() => setShareTarget(null)} />
      <VersionModal visible={versionTarget !== null} dashboardId={versionTarget} onClose={() => setVersionTarget(null)} onRestored={() => void queryClient.invalidateQueries({ queryKey: reportDashboardKeys.lists })} />

      <SideSheet
        title="分类管理"
        visible={categorySheetVisible}
        width={760}
        placement="right"
        onCancel={() => setCategorySheetVisible(false)}
        closeOnEsc
      >
        <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 12 }}>
          <Typography.Text type="tertiary">删除已引用分类时，相关仪表盘分类会自动置空。</Typography.Text>
          {hasPermission('report:dashboard:update') ? <Button type="primary" icon={<Plus size={14} />} onClick={openCategoryCreate}>新增分类</Button> : null}
        </Space>
        <ConfigurableTable
          bordered
          rowKey="id"
          pagination={false}
          dataSource={categories}
          loading={categoriesQuery.isFetching}
          empty="暂无分类"
          columns={[
            { title: '名称', dataIndex: 'name', width: 180 },
            { title: '排序', dataIndex: 'sort', width: 80 },
            { title: '引用仪表盘', dataIndex: 'dashboardCount', width: 100, render: (value: number) => value ?? 0 },
            { title: '备注', dataIndex: 'remark', render: renderEllipsis },
            createOperationColumn<(typeof categories)[number]>({
              width: 160,
              desktopInlineKeys: ['edit'],
              actions: (record) => [
                ...(hasPermission('report:dashboard:update') ? [{ key: 'edit', label: '编辑', onClick: () => openCategoryEdit(record) }] : []),
                ...(hasPermission('report:dashboard:update') ? [{ key: 'delete', label: '删除', danger: true, onClick: () => void handleCategoryDelete(record) }] : []),
              ],
            }),
          ]}
        />
      </SideSheet>

      <AppModal
        title={editingCategory ? '编辑分类' : '新增分类'}
        visible={categoryModalVisible}
        onOk={handleCategorySave}
        onCancel={closeCategoryModal}
        okButtonProps={{ loading: saveCategoryMutation.isPending }}
        width={520}
      >
        <Form
          key={editingCategory?.id ?? 'category-new'}
          getFormApi={(api) => { categoryFormApi.current = api; }}
          initValues={{ name: editingCategory?.name ?? '', sort: editingCategory?.sort ?? 0, remark: editingCategory?.remark ?? '' }}
          labelPosition="left"
          labelWidth={72}
        >
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入分类名称' }]} maxLength={64} showClear />
          <Form.InputNumber field="sort" label="排序" min={0} max={9999} />
          <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 2, maxRows: 4 }} />
        </Form>
      </AppModal>
    </div>
  );
}
