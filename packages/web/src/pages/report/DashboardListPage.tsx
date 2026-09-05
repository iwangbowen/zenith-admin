import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, SideSheet, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { FolderTree, Star } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { ShareModal, VersionModal } from './components/DashboardOpsModals';
import { createdAtColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import type { ReportDashboard, ReportWidget } from '@zenith/shared/report';
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
import { flattenReportFolders, useReportFolderTree } from '@/hooks/queries/report-folders';
import { useAllUsers } from '@/hooks/queries/users';
import { useReportDeprecationList } from '@/hooks/queries/report-assets';
import { useListSearch } from '@/hooks/useListSearch';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';

interface SearchParams { keyword: string; status?: string; lifecycleStatus?: ReportDashboard['lifecycleStatus']; categoryId?: number; favorited: boolean; ownerId?: number; folderId?: number }
const defaultSearchParams: SearchParams = { keyword: '', status: undefined, lifecycleStatus: undefined, favorited: false, ownerId: undefined, folderId: undefined };

export default function DashboardListPage() {
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, applySearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: reportDashboardKeys.lists });

  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const [categorySheetVisible, setCategorySheetVisible] = useState(false);
  const [shareTarget, setShareTarget] = useState<number | null>(null);
  const [versionTarget, setVersionTarget] = useState<number | null>(null);

  const listQuery = useReportDashboardList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(USER_STATUSES, submittedParams.status),
    lifecycleStatus: submittedParams.lifecycleStatus || undefined,
    categoryId: submittedParams.categoryId,
    favorited: submittedParams.favorited || undefined,
    ownerId: submittedParams.ownerId,
    folderId: submittedParams.folderId,
  });
  const data = listQuery.data ?? null;
  const users = useAllUsers().data ?? [];
  const folders = flattenReportFolders(useReportFolderTree({ resourceType: 'dashboard' }).data ?? []);
  const deprecationQuery = useReportDeprecationList(
    { page: 1, pageSize: 200, resourceType: 'dashboard', published: true },
    hasPermission('report:deprecation:list'),
  );
  const deprecatedIds = new Set((deprecationQuery.data?.list ?? []).map((notice) => notice.resourceId));
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
  const favTogglingId = favoriteMutation.isPending ? favoriteMutation.variables?.params.id ?? null : null;

  const dashboardModal = useEditModal<ReportDashboard, Record<string, unknown>>({
    entityName: '仪表盘',
    save: saveMutation,
    defaults: { status: 'enabled' },
    labelWidth: 72,
    toValues: (record) => ({
      name: record.name,
      ownerId: record.ownerId ?? undefined,
      folderId: record.folderId ?? undefined,
      status: record.status,
      remark: record.remark ?? '',
      categoryId: record.categoryId ?? undefined,
    }),
    beforeSave: (values, { editing }) => {
      const payload: Record<string, unknown> = {
      name: String(values.name ?? ''),
      ownerId: values.ownerId ? Number(values.ownerId) : null,
      folderId: values.folderId ? Number(values.folderId) : null,
      status: values.status as ReportDashboard['status'],
      remark: values.remark ? String(values.remark) : undefined,
      categoryId: values.categoryId == null ? null : Number(values.categoryId),
      expectedRevision: editing?.revision,
      };
      return editing ? payload : { ...payload, layout: [], widgets: [] };
    },
    onSaved: (saved, { isEdit }) => {
      if (!isEdit) navigate(`/report/dashboards/${saved.id}/design`, { state: { tabTitle: `设计·${saved.name}` } });
    },
  });
  type DashboardCategory = (typeof categories)[number];
  const categoryModal = useEditModal<DashboardCategory, Record<string, unknown>>({
    entityName: '分类',
    save: saveCategoryMutation,
    defaults: { name: '', sort: 0, remark: '' },
    labelWidth: 72,
    toValues: (record) => ({ name: record.name ?? '', sort: record.sort ?? 0, remark: record.remark ?? '' }),
    beforeSave: (values) => ({
      name: String(values.name ?? '').trim(),
      sort: Number(values.sort ?? 0),
      remark: values.remark ? String(values.remark) : undefined,
    }),
    successMessage: ({ isEdit }) => isEdit ? '分类更新成功' : '分类创建成功',
  });

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync({ params: { id } });
    Toast.success('删除成功');
  }

  async function handleBatchStatus(status: 'enabled' | 'disabled') {
    if (selectedRowKeys.length === 0) return;
    await batchStatusMutation.mutateAsync({ body: { ids: selectedRowKeys, status } });
    setSelectedRowKeys([]);
    Toast.success(status === 'enabled' ? '批量启用成功' : '批量停用成功');
  }

  async function handleClone(record: ReportDashboard) {
    const cloned = await cloneMutation.mutateAsync({ params: { id: record.id }, body: {} });
    Toast.success(`已复制为「${cloned.name}」`);
  }

  async function handleCategoryDelete(record: (typeof categories)[number]) {
    confirmDelete({
      title: `确定删除分类「${record.name}」吗？`,
      content: record.dashboardCount
        ? `该分类已被 ${record.dashboardCount} 个仪表盘引用。删除后这些仪表盘的分类将自动置空。`
        : '删除后不可恢复。',
      onOk: async () => {
        await deleteCategoryMutation.mutateAsync({ params: { id: record.id } });
        Toast.success('分类删除成功');
      },
    });
  }

  async function toggleFavorite(record: ReportDashboard) {
    await favoriteMutation.mutateAsync({ params: { id: record.id } });
  }

  async function handlePublish(record: ReportDashboard) {
    await publishMutation.mutateAsync({ params: { id: record.id }, body: { expectedRevision: record.revision } });
    Toast.success('发布成功');
  }

  async function handleOffline(record: ReportDashboard) {
    await offlineMutation.mutateAsync({ params: { id: record.id }, body: { expectedRevision: record.revision } });
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
    {
      title: '名称', dataIndex: 'name', minWidth: 200,
      render: (v: string, record: ReportDashboard) => (
        <Typography.Text
          link
          ellipsis={{ showTooltip: true }}
          onClick={() => navigate(`/report/dashboards/${record.id}/view`, { state: { tabTitle: `预览·${record.name}` } })}
        >
          {v}
        </Typography.Text>
      ),
    },
    { title: '分类', dataIndex: 'categoryName', width: 120, render: (v: string) => v ? <Tag size="small" color="light-blue">{v}</Tag> : EMPTY_PLACEHOLDER },
    { title: '负责人', dataIndex: 'ownerName', width: 120, render: (v: string | null) => v || '—' },
    { title: '目录', dataIndex: 'folderName', width: 140, render: (v: string | null) => v || '—' },
    { title: '组件数', dataIndex: 'widgets', width: 80, render: (w: ReportWidget[]) => (w?.length ?? 0) },
    { title: '备注', dataIndex: 'remark', width: 180, render: renderEllipsis },
    createdAtColumn,
    { title: '治理提示', dataIndex: '__warnings', width: 90, render: (_: unknown, record) => deprecatedIds.has(record.id) ? <Tag color="red" size="small">已弃用</Tag> : '—' },
    { title: '生命周期', dataIndex: 'lifecycleStatus', width: 90, fixed: 'right', render: (value: ReportDashboard['lifecycleStatus']) => lifecycleTag(value) },
    { title: '状态', dataIndex: 'status', width: 80, fixed: 'right', render: (s: string) => s === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="grey" size="small">停用</Tag> },
    createOperationColumn<ReportDashboard>({
      width: 180,
      desktopInlineKeys: ['design', 'view'],
      actions: (record) => [
        ...(hasPermission('report:dashboard:update') ? [{ key: 'design', label: '设计', onClick: () => navigate(`/report/dashboards/${record.id}/design`, { state: { tabTitle: `设计·${record.name}` } }) }] : []),
        { key: 'view', label: '预览', onClick: () => navigate(`/report/dashboards/${record.id}/view`, { state: { tabTitle: `预览·${record.name}` } }) },
        ...(hasPermission('report:dashboard:update') && record.lifecycleStatus !== 'published' ? [{ key: 'publish', label: '发布', onClick: () => void handlePublish(record) }] : []),
        ...(hasPermission('report:dashboard:update') && record.lifecycleStatus === 'published' ? [{ key: 'offline', label: '下线', onClick: () => void handleOffline(record) }] : []),
        ...(hasPermission('report:dashboard:update') ? [{ key: 'share', label: '分享', onClick: () => setShareTarget(record.id) }] : []),
        ...(hasPermission('report:dashboard:update') ? [{ key: 'version', label: '版本', onClick: () => setVersionTarget(record.id) }] : []),
        ...(hasPermission('report:dashboard:update') ? [{ key: 'edit', label: '编辑', onClick: () => dashboardModal.openEdit(record) }] : []),
        { key: 'governance', label: '权限与转移', onClick: () => navigate(`/report/governance?resourceType=dashboard&resourceId=${record.id}`) },
        ...(hasPermission('report:dashboard:create') ? [{ key: 'clone', label: '复制', onClick: () => void handleClone(record) }] : []),
        ...(hasPermission('report:dashboard:delete') ? [{ key: 'delete', label: '删除', danger: true, onClick: () => { confirmDelete({ content: '删除后不可恢复', onOk: () => handleDelete(record.id) }); } }] : []),
      ],
    }),
  ];

  const renderKeyword = () => (
    <KeywordInput placeholder="搜索名称/备注..." value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
  );
  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );
  const renderLifecycleFilter = () => (
    <FilterSelect
      placeholder="全部生命周期"
      items={[
       { value: 'draft', label: '草稿' },
       { value: 'published', label: '已发布' },
       { value: 'offline', label: '已下线' },
     ]}
      value={draftParams.lifecycleStatus}
      onChange={(v) => setDraftParams((p) => ({ ...p, lifecycleStatus: v as SearchParams['lifecycleStatus'] | undefined }))}
      width={140}
    />
  );
  const renderOwnerFilter = () => (
    <FilterSelect
      placeholder="全部负责人"
      items={users.map((u) => ({ value: u.id, label: u.nickname || u.username }))}
      value={draftParams.ownerId}
      onChange={(v) => setDraftParams((p) => ({ ...p, ownerId: v as number | undefined }))}
      width={140}
      filter
    />
  );
  const renderFolderFilter = () => (
    <FilterSelect
      placeholder="全部目录"
      items={folders.map((f) => ({ value: f.id, label: f.name }))}
      value={draftParams.folderId}
      onChange={(v) => setDraftParams((p) => ({ ...p, folderId: v as number | undefined }))}
      width={140}
      filter
    />
  );
  const renderSearchBtn = () => <SearchButton onClick={handleSearch} />;
  const renderResetBtn = () => <ResetButton onClick={handleReset} />;
  const renderCreateBtn = () => hasPermission('report:dashboard:create')
    ? <CreateButton onClick={dashboardModal.openCreate} /> : null;
  const renderCategoryManageBtn = () => hasPermission('report:dashboard:update')
    ? <Button icon={<FolderTree size={14} />} onClick={() => setCategorySheetVisible(true)}>分类管理</Button> : null;
  const renderCategoryFilter = () => (
    <FilterSelect
      placeholder="全部分类"
      items={categories.map((c) => ({ value: c.id, label: c.name }))}
      value={draftParams.categoryId}
      onChange={(v) => setDraftParams((p) => ({ ...p, categoryId: v as number | undefined }))}
      width={140}
    />
  );
  const renderFavToggle = () => (
    <Button theme={draftParams.favorited ? 'solid' : 'light'} type={draftParams.favorited ? 'warning' : 'tertiary'} icon={<Star size={14} />}
      onClick={() => setDraftParams((p) => {
        const np = { ...p, favorited: !p.favorited };
        applySearch(np);
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
        primary={<>{renderKeyword()}{renderCategoryFilter()}{renderOwnerFilter()}{renderFolderFilter()}{renderStatusFilter()}{renderLifecycleFilter()}{renderFavToggle()}{renderSearchBtn()}{renderResetBtn()}</>}
        actions={<>{renderBatchEnableBtn()}{renderBatchDisableBtn()}{renderCategoryManageBtn()}{renderCreateBtn()}</>}
        mobilePrimary={<>{renderKeyword()}{renderSearchBtn()}{renderCreateBtn()}</>}
        mobileFilters={<>{renderCategoryFilter()}{renderOwnerFilter()}{renderFolderFilter()}{renderStatusFilter()}{renderLifecycleFilter()}{renderFavToggle()}</>}
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
        {...dashboardModal.modalProps}
        width={520}
      >
        <Form key={dashboardModal.formKey} {...dashboardModal.formProps}>
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={64} showClear />
          <Form.Select field="ownerId" label="负责人" filter showClear style={{ width: '100%' }}
            optionList={users.map((u) => ({ value: u.id, label: u.nickname || u.username }))} />
          <Form.Select field="folderId" label="资源目录" filter showClear style={{ width: '100%' }}
            optionList={folders.map((f) => ({ value: f.id, label: f.name }))} />
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
          {hasPermission('report:dashboard:update') ? <CreateButton onClick={categoryModal.openCreate}>新增分类</CreateButton> : null}
        </Space>
        <ConfigurableTable
          bordered
          rowKey="id"
          pagination={false}
          dataSource={categories}
          loading={categoriesQuery.isFetching}
          empty="暂无分类"
          columns={[
            { title: '名称', dataIndex: 'name', width: 180, render: renderEllipsis },
            { title: '排序', dataIndex: 'sort', width: 80 },
            { title: '引用仪表盘', dataIndex: 'dashboardCount', width: 100, align: 'right', render: (value: number) => value ?? 0 },
            { title: '备注', dataIndex: 'remark', render: renderEllipsis },
            createOperationColumn<(typeof categories)[number]>({
              width: 120,
              desktopInlineKeys: ['edit'],
              actions: (record) => [
                ...(hasPermission('report:dashboard:update') ? [{ key: 'edit', label: '编辑', onClick: () => categoryModal.openEdit(record) }] : []),
                ...(hasPermission('report:dashboard:update') ? [{ key: 'delete', label: '删除', danger: true, onClick: () => void handleCategoryDelete(record) }] : []),
              ],
            }),
          ]}
        />
      </SideSheet>

      <AppModal
        {...categoryModal.modalProps}
        width={520}
      >
        <Form key={categoryModal.formKey} {...categoryModal.formProps}>
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入分类名称' }]} maxLength={64} showClear />
          <Form.InputNumber field="sort" label="排序" min={0} max={9999} />
          <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 2, maxRows: 4 }} />
        </Form>
      </AppModal>
    </div>
  );
}
