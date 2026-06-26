import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Form, Input, Select, Spin, Switch, Tag, Toast, Modal } from '@douyinfe/semi-ui';
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
import type { ReportDatasource, ReportDatasourceType, ReportApiDatasourceConfig, PaginatedResponse } from '@zenith/shared';

interface SearchParams { keyword: string; type: string; status: string }
const defaultSearchParams: SearchParams = { keyword: '', type: '', status: '' };

const TYPE_OPTIONS = [
  { value: 'api', label: 'API（远程 HTTP）' },
  { value: 'sql', label: 'SQL（内置只读主库）' },
];

function typeTag(type: ReportDatasourceType) {
  return type === 'api'
    ? <Tag color="blue" size="small">API</Tag>
    : <Tag color="violet" size="small">SQL</Tag>;
}

export default function DataSourcesPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);

  const [data, setData] = useState<PaginatedResponse<ReportDatasource> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportDatasource | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const active = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const q: Record<string, string> = { page: String(p), pageSize: String(ps) };
      if (active.keyword) q.keyword = active.keyword;
      if (active.type) q.type = active.type;
      if (active.status) q.status = active.status;
      const res = await request.get<PaginatedResponse<ReportDatasource>>(`/api/report/datasources?${new URLSearchParams(q)}`);
      if (res.code === 0) { setData(res.data); setPage(res.data.page); setPageSize(res.data.pageSize); }
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => { void fetchList(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  function handleSearch() { setPage(1); void fetchList(1, pageSize); }
  function handleReset() { setSearchParams(defaultSearchParams); setPage(1); void fetchList(1, pageSize, defaultSearchParams); }

  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(record: ReportDatasource) { setEditing(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const apiConfig = (editing?.config ?? {}) as ReportApiDatasourceConfig;
  const formInitValues = editing
    ? {
        name: editing.name,
        type: editing.type,
        url: apiConfig.url ?? '',
        method: apiConfig.method ?? 'GET',
        headersText: apiConfig.headers ? JSON.stringify(apiConfig.headers, null, 2) : '',
        status: editing.status,
        remark: editing.remark ?? '',
      }
    : { type: 'api', method: 'GET', status: 'enabled' };

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try { values = await formApi.current?.validate() as Record<string, unknown>; }
    catch { throw new Error('validation'); }

    const type = values.type as ReportDatasourceType;
    let config: Record<string, unknown> = {};
    if (type === 'api') {
      const url = String(values.url ?? '').trim();
      if (!/^https?:\/\//i.test(url)) { Toast.error('请填写以 http:// 或 https:// 开头的 URL'); throw new Error('url'); }
      let headers: Record<string, string> | undefined;
      const headersText = String(values.headersText ?? '').trim();
      if (headersText) {
        try { headers = JSON.parse(headersText); }
        catch { Toast.error('请求头不是合法 JSON'); throw new Error('headers'); }
      }
      config = { url, method: values.method || 'GET', headers };
    }

    const payload = { name: values.name, type, config, status: values.status, remark: values.remark || undefined };
    setSubmitting(true);
    try {
      const res = editing
        ? await request.put(`/api/report/datasources/${editing.id}`, payload)
        : await request.post('/api/report/datasources', payload);
      if (res.code === 0) { Toast.success(editing ? '更新成功' : '创建成功'); closeModal(); void fetchList(); }
      else throw new Error(res.message);
    } finally { setSubmitting(false); }
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/report/datasources/${id}`);
    if (res.code === 0) { Toast.success('删除成功'); void fetchList(); }
  }

  function handleToggleStatus(record: ReportDatasource, checked: boolean) {
    const doToggle = async () => {
      setTogglingIds((p) => new Set(p).add(record.id));
      try {
        await request.put(`/api/report/datasources/${record.id}`, { status: checked ? 'enabled' : 'disabled' });
        Toast.success(checked ? '已启用' : '已停用');
        void fetchList();
      } finally { setTogglingIds((p) => { const s = new Set(p); s.delete(record.id); return s; }); }
    };
    if (checked) void doToggle();
    else Modal.confirm({ title: '确认停用', content: `停用后「${record.name}」将不可用于取数，确认停用？`, onOk: () => void doToggle() });
  }

  const columns: ColumnProps<ReportDatasource>[] = [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '类型', dataIndex: 'type', width: 90, render: (t: ReportDatasourceType) => typeTag(t) },
    {
      title: '连接', dataIndex: 'config', width: 320,
      render: (_: unknown, r: ReportDatasource) => r.type === 'api'
        ? <span style={{ color: 'var(--semi-color-text-1)' }}>{(r.config as ReportApiDatasourceConfig).url ?? '-'}</span>
        : <span style={{ color: 'var(--semi-color-text-2)' }}>内置只读主库</span>,
    },
    { title: '备注', dataIndex: 'remark', width: 180, render: (v: string) => v || '-' },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, record: ReportDatasource) => (
        <Switch
          checked={record.status === 'enabled'}
          loading={togglingIds.has(record.id)}
          disabled={!hasPermission('report:datasource:update')}
          onChange={(c) => handleToggleStatus(record, c)}
          size="small"
        />
      ),
    },
    createOperationColumn<ReportDatasource>({
      width: 140,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('report:datasource:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(record) }] : []),
        ...(hasPermission('report:datasource:delete') ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => { Modal.confirm({ title: '确定要删除吗？', content: '删除后不可恢复；若被数据集引用将无法删除。', onOk: () => handleDelete(record.id) }); },
        }] : []),
      ],
    }),
  ];

  const renderKeyword = () => (
    <Input prefix={<Search size={14} />} placeholder="搜索名称/备注..." value={searchParams.keyword}
      onChange={(v) => setSearchParams((p) => ({ ...p, keyword: v }))} showClear style={{ width: 220 }} onEnterPress={handleSearch} />
  );
  const renderTypeFilter = () => (
    <Select placeholder="全部类型" value={searchParams.type || undefined} onChange={(v) => setSearchParams((p) => ({ ...p, type: (v as string) ?? '' }))}
      showClear style={{ width: 140 }} optionList={TYPE_OPTIONS} />
  );
  const renderStatusFilter = () => (
    <Select placeholder="全部状态" value={searchParams.status || undefined} onChange={(v) => setSearchParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear style={{ width: 120 }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
  );
  const renderSearchBtn = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetBtn = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateBtn = () => hasPermission('report:datasource:create')
    ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}{renderTypeFilter()}{renderStatusFilter()}{renderSearchBtn()}{renderResetBtn()}</>}
        actions={renderCreateBtn()}
        mobilePrimary={<>{renderKeyword()}{renderSearchBtn()}{renderCreateBtn()}</>}
        mobileFilters={<>{renderTypeFilter()}{renderStatusFilter()}</>}
        filterTitle="数据源筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
      />

      <AppModal
        title={editing ? '编辑数据源' : '新增数据源'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: submitting }}
        width={560}
      >
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInitValues} labelPosition="left" labelWidth={72}>
          {({ values }) => (
            <>
              <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={64} showClear placeholder="如：订单库" />
              <Form.Select field="type" label="类型" optionList={TYPE_OPTIONS} style={{ width: '100%' }} rules={[{ required: true }]} />
              {values.type === 'api' ? (
                <>
                  <Form.Input field="url" label="URL" placeholder="https://api.example.com/data" rules={[{ required: true, message: '请输入 URL' }]} showClear />
                  <Form.Select field="method" label="方法" optionList={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }]} style={{ width: '100%' }} />
                  <Form.TextArea field="headersText" label="请求头" placeholder={'选填，JSON 键值，如：\n{ "Authorization": "Bearer xxx" }'} autosize={{ minRows: 2, maxRows: 5 }} />
                </>
              ) : (
                <Form.Slot label="说明">
                  <span style={{ color: 'var(--semi-color-text-2)', fontSize: 13 }}>内置只读主库，无需额外连接配置。SQL 语句在「数据集」中编写。</span>
                </Form.Slot>
              )}
              <Form.Select field="status" label="状态" style={{ width: '100%' }}
                optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
              <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
            </>
          )}
        </Form>
      </AppModal>
    </div>
  );
}
