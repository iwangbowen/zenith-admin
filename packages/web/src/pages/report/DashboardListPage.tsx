import { useState, useEffect, useCallback, useRef } from 'react';
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
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import type { ReportDashboard, ReportWidget, ReportDashboardCategory, PaginatedResponse } from '@zenith/shared';

interface SearchParams { keyword: string; status: string; categoryId?: number; favorited: boolean }
const defaultSearchParams: SearchParams = { keyword: '', status: '', favorited: false };

export default function DashboardListPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const formApi = useRef<FormApi | null>(null);

  const [data, setData] = useState<PaginatedResponse<ReportDashboard> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportDashboard | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [categories, setCategories] = useState<ReportDashboardCategory[]>([]);
  const [shareTarget, setShareTarget] = useState<number | null>(null);
  const [versionTarget, setVersionTarget] = useState<number | null>(null);
  const [favTogglingIds, setFavTogglingIds] = useState<Set<number>>(new Set());

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const active = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const q: Record<string, string> = { page: String(p), pageSize: String(ps) };
      if (active.keyword) q.keyword = active.keyword;
      if (active.status) q.status = active.status;
      if (active.categoryId) q.categoryId = String(active.categoryId);
      if (active.favorited) q.favorited = 'true';
      const res = await request.get<PaginatedResponse<ReportDashboard>>(`/api/report/dashboards?${new URLSearchParams(q)}`);
      if (res.code === 0) { setData(res.data); setPage(res.data.page); setPageSize(res.data.pageSize); }
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
    request.get<ReportDashboardCategory[]>('/api/report/categories').then((res) => { if (res.code === 0) setCategories(res.data); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() { setPage(1); void fetchList(1, pageSize); }
  function handleReset() { setSearchParams(defaultSearchParams); setPage(1); void fetchList(1, pageSize, defaultSearchParams); }

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
    const payload = { name: values.name, status: values.status, remark: values.remark || undefined, categoryId: values.categoryId ?? null };
    setSubmitting(true);
    try {
      if (editing) {
        const res = await request.put<ReportDashboard>(`/api/report/dashboards/${editing.id}`, payload);
        if (res.code === 0) { Toast.success('更新成功'); closeModal(); void fetchList(); }
        else throw new Error(res.message);
      } else {
        // 新建后直接进入设计器
        const res = await request.post<ReportDashboard>('/api/report/dashboards', { ...payload, layout: [], widgets: [] });
        if (res.code === 0) { Toast.success('创建成功'); closeModal(); navigate(`/report/dashboards/${res.data.id}/design`); }
        else throw new Error(res.message);
      }
    } finally { setSubmitting(false); }
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/report/dashboards/${id}`);
    if (res.code === 0) { Toast.success('删除成功'); void fetchList(); }
  }

  async function toggleFavorite(record: ReportDashboard) {
    setFavTogglingIds((p) => new Set(p).add(record.id));
    try { const res = await request.post(`/api/report/dashboards/${record.id}/favorite`); if (res.code === 0) void fetchList(); }
    finally { setFavTogglingIds((p) => { const s = new Set(p); s.delete(record.id); return s; }); }
  }

  const columns: ColumnProps<ReportDashboard>[] = [
    {
      title: '', dataIndex: '__fav', width: 44, align: 'center',
      render: (_: unknown, r: ReportDashboard) => (
        <Star size={15} style={{ cursor: 'pointer', color: r.favorited ? 'var(--semi-color-warning)' : 'var(--semi-color-text-3)', fill: r.favorited ? 'var(--semi-color-warning)' : 'none', opacity: favTogglingIds.has(r.id) ? 0.4 : 1 }} onClick={() => toggleFavorite(r)} />
      ),
    },
    { title: '名称', dataIndex: 'name', width: 200 },
    { title: '分类', dataIndex: 'categoryName', width: 120, render: (v: string) => v ? <Tag size="small" color="light-blue">{v}</Tag> : '-' },
    { title: '组件数', dataIndex: 'widgets', width: 80, render: (w: ReportWidget[]) => (w?.length ?? 0) },
    { title: '备注', dataIndex: 'remark', width: 180, render: (v: string) => v || '-' },
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
    <Input prefix={<Search size={14} />} placeholder="搜索名称/备注..." value={searchParams.keyword}
      onChange={(v) => setSearchParams((p) => ({ ...p, keyword: v }))} showClear style={{ width: 220 }} onEnterPress={handleSearch} />
  );
  const renderStatusFilter = () => (
    <Select placeholder="全部状态" value={searchParams.status || undefined} onChange={(v) => setSearchParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear style={{ width: 120 }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
  );
  const renderSearchBtn = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetBtn = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateBtn = () => hasPermission('report:dashboard:create')
    ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;
  const renderCategoryFilter = () => (
    <Select placeholder="全部分类" value={searchParams.categoryId} onChange={(v) => setSearchParams((p) => ({ ...p, categoryId: v as number | undefined }))}
      showClear style={{ width: 140 }} optionList={categories.map((c) => ({ value: c.id, label: c.name }))} />
  );
  const renderFavToggle = () => (
    <Button theme={searchParams.favorited ? 'solid' : 'light'} type={searchParams.favorited ? 'warning' : 'tertiary'} icon={<Star size={14} />}
      onClick={() => setSearchParams((p) => { const np = { ...p, favorited: !p.favorited }; setPage(1); void fetchList(1, pageSize, np); return np; })}>收藏</Button>
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
        bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
      />

      <AppModal
        title={editing ? '编辑仪表盘' : '新增仪表盘'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: submitting }}
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
      <VersionModal visible={versionTarget !== null} dashboardId={versionTarget} onClose={() => setVersionTarget(null)} onRestored={() => void fetchList()} />
    </div>
  );
}
