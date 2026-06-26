import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Form, Input, Select, Tag, Toast, Modal } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import type { ReportDashboard, ReportWidget, PaginatedResponse } from '@zenith/shared';

interface SearchParams { keyword: string; status: string }
const defaultSearchParams: SearchParams = { keyword: '', status: '' };

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

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const active = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const q: Record<string, string> = { page: String(p), pageSize: String(ps) };
      if (active.keyword) q.keyword = active.keyword;
      if (active.status) q.status = active.status;
      const res = await request.get<PaginatedResponse<ReportDashboard>>(`/api/report/dashboards?${new URLSearchParams(q)}`);
      if (res.code === 0) { setData(res.data); setPage(res.data.page); setPageSize(res.data.pageSize); }
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => { void fetchList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function handleSearch() { setPage(1); void fetchList(1, pageSize); }
  function handleReset() { setSearchParams(defaultSearchParams); setPage(1); void fetchList(1, pageSize, defaultSearchParams); }

  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(record: ReportDashboard) { setEditing(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const formInitValues = editing
    ? { name: editing.name, status: editing.status, remark: editing.remark ?? '' }
    : { status: 'enabled' };

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try { values = await formApi.current?.validate() as Record<string, unknown>; }
    catch { throw new Error('validation'); }
    const payload = { name: values.name, status: values.status, remark: values.remark || undefined };
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

  const columns: ColumnProps<ReportDashboard>[] = [
    { title: '名称', dataIndex: 'name', width: 200 },
    { title: '组件数', dataIndex: 'widgets', width: 90, render: (w: ReportWidget[]) => (w?.length ?? 0) },
    { title: '备注', dataIndex: 'remark', width: 220, render: (v: string) => v || '-' },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    {
      title: '状态', dataIndex: 'status', width: 70, fixed: 'right',
      render: (s: string) => s === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="grey" size="small">停用</Tag>,
    },
    createOperationColumn<ReportDashboard>({
      width: 200,
      desktopInlineKeys: ['design', 'view', 'edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('report:dashboard:update') ? [{ key: 'design', label: '设计', onClick: () => navigate(`/report/dashboards/${record.id}/design`) }] : []),
        { key: 'view', label: '预览', onClick: () => navigate(`/report/dashboards/${record.id}/view`) },
        ...(hasPermission('report:dashboard:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(record) }] : []),
        ...(hasPermission('report:dashboard:delete') ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => { Modal.confirm({ title: '确定要删除吗？', content: '删除后不可恢复', onOk: () => handleDelete(record.id) }); },
        }] : []),
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

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}{renderStatusFilter()}{renderSearchBtn()}{renderResetBtn()}</>}
        actions={renderCreateBtn()}
        mobilePrimary={<>{renderKeyword()}{renderSearchBtn()}{renderCreateBtn()}</>}
        mobileFilters={renderStatusFilter()}
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
          <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
        </Form>
      </AppModal>
    </div>
  );
}
