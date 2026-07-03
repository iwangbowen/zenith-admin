import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Input, Select, Tag, Toast, Modal } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus, Star } from 'lucide-react';
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
  useReportDashboardCategories,
  useReportDashboardList,
  useSaveReportDashboard,
  useToggleReportDashboardFavorite,
} from '@/hooks/queries/report-dashboards';

interface SearchParams { keyword: string; status: string; categoryId?: number; favorited: boolean }
const defaultSearchParams: SearchParams = { keyword: '', status: '', favorited: false };

export default function DashboardListPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();

  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportDashboard | null>(null);
  const [shareTarget, setShareTarget] = useState<number | null>(null);
  const [versionTarget, setVersionTarget] = useState<number | null>(null);

  const listQuery = useReportDashboardList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    categoryId: submittedParams.categoryId,
    favorited: submittedParams.favorited || undefined,
  });
  const data = listQuery.data ?? null;
  const categoriesQuery = useReportDashboardCategories();
  const categories = categoriesQuery.data ?? [];
  const saveMutation = useSaveReportDashboard();
  const deleteMutation = useDeleteReportDashboard();
  const favoriteMutation = useToggleReportDashboardFavorite();
  const favTogglingId = favoriteMutation.isPending ? favoriteMutation.variables ?? null : null;

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: reportDashboardKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearchParams); setSubmittedParams(defaultSearchParams); setPage(1); void queryClient.invalidateQueries({ queryKey: reportDashboardKeys.lists }); }

  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(record: ReportDashboard) { setEditing(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const formInitValues = editing
    ? { name: editing.name, status: editing.status, remark: editing.remark ?? '', categoryId: editing.categoryId ?? undefined }
    : { status: 'enabled' };

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try { values = await formApi.current?.validate() as Record<string, unknown>; }
    catch { throw new Error('validation'); }
    const payload: Partial<ReportDashboard> = {
      name: String(values.name ?? ''),
      status: values.status as ReportDashboard['status'],
      remark: values.remark ? String(values.remark) : undefined,
      categoryId: values.categoryId == null ? null : Number(values.categoryId),
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

  async function toggleFavorite(record: ReportDashboard) {
    await favoriteMutation.mutateAsync(record.id);
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
    { title: '状态', dataIndex: 'status', width: 70, fixed: 'right', render: (s: string) => s === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="grey" size="small">停用</Tag> },
    createOperationColumn<ReportDashboard>({
      width: 230,
      desktopInlineKeys: ['design', 'view'],
      actions: (record) => [
        ...(hasPermission('report:dashboard:update') ? [{ key: 'design', label: '设计', onClick: () => navigate(`/report/dashboards/${record.id}/design`) }] : []),
        { key: 'view', label: '预览', onClick: () => navigate(`/report/dashboards/${record.id}/view`) },
        ...(hasPermission('report:dashboard:update') ? [{ key: 'share', label: '分享', onClick: () => setShareTarget(record.id) }] : []),
        ...(hasPermission('report:dashboard:update') ? [{ key: 'version', label: '版本', onClick: () => setVersionTarget(record.id) }] : []),
        ...(hasPermission('report:dashboard:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(record) }] : []),
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
      showClear style={{ width: 120 }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
  );
  const renderSearchBtn = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetBtn = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateBtn = () => hasPermission('report:dashboard:create')
    ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;
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

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}{renderCategoryFilter()}{renderStatusFilter()}{renderFavToggle()}{renderSearchBtn()}{renderResetBtn()}</>}
        actions={renderCreateBtn()}
        mobilePrimary={<>{renderKeyword()}{renderSearchBtn()}{renderCreateBtn()}</>}
        mobileFilters={<>{renderCategoryFilter()}{renderStatusFilter()}{renderFavToggle()}</>}
        filterTitle="仪表盘筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
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
            optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
          <Form.Select field="categoryId" label="分类" style={{ width: '100%' }} showClear placeholder="未分类"
            optionList={categories.map((c) => ({ value: c.id, label: c.name }))} />
          <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
        </Form>
      </AppModal>

      <ShareModal visible={shareTarget !== null} dashboardId={shareTarget} onClose={() => setShareTarget(null)} />
      <VersionModal visible={versionTarget !== null} dashboardId={versionTarget} onClose={() => setVersionTarget(null)} onRestored={() => void queryClient.invalidateQueries({ queryKey: reportDashboardKeys.lists })} />
    </div>
  );
}
