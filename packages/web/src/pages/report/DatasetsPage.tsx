import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button, Form, Input, Select, Switch, Table, Tag, Toast, Modal, Space, Typography, Empty } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus, Play } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import type {
  ReportDataset, ReportDatasource, ReportDatasourceType, ReportField, ReportDataResult,
  ReportApiDatasetContent, ReportSqlDatasetContent, PaginatedResponse,
} from '@zenith/shared';

interface SearchParams { keyword: string; status: string }
const defaultSearchParams: SearchParams = { keyword: '', status: '' };

export default function DatasetsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);

  const [data, setData] = useState<PaginatedResponse<ReportDataset> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;

  const [datasources, setDatasources] = useState<ReportDatasource[]>([]);
  const dsTypeMap = useMemo(() => {
    const m = new Map<number, ReportDatasourceType>();
    datasources.forEach((d) => m.set(d.id, d.type));
    return m;
  }, [datasources]);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportDataset | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedDsId, setSelectedDsId] = useState<number | null>(null);
  const [fields, setFields] = useState<ReportField[]>([]);
  const [preview, setPreview] = useState<ReportDataResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const selectedType: ReportDatasourceType | null = selectedDsId ? dsTypeMap.get(selectedDsId) ?? null : null;

  const fetchList = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const active = params ?? searchParamsRef.current;
    setLoading(true);
    try {
      const q: Record<string, string> = { page: String(p), pageSize: String(ps) };
      if (active.keyword) q.keyword = active.keyword;
      if (active.status) q.status = active.status;
      const res = await request.get<PaginatedResponse<ReportDataset>>(`/api/report/datasets?${new URLSearchParams(q)}`);
      if (res.code === 0) { setData(res.data); setPage(res.data.page); setPageSize(res.data.pageSize); }
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    void fetchList();
    request.get<PaginatedResponse<ReportDatasource>>('/api/report/datasources?page=1&pageSize=200').then((res) => {
      if (res.code === 0) setDatasources(res.data.list.filter((d) => d.status === 'enabled'));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() { setPage(1); void fetchList(1, pageSize); }
  function handleReset() { setSearchParams(defaultSearchParams); setPage(1); void fetchList(1, pageSize, defaultSearchParams); }

  function resetModalExtra(ds: ReportDataset | null) {
    setSelectedDsId(ds?.datasourceId ?? null);
    setFields(ds?.fields ?? []);
    setPreview(null);
  }
  function openCreate() { setEditing(null); resetModalExtra(null); setModalVisible(true); }
  function openEdit(record: ReportDataset) { setEditing(record); resetModalExtra(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); setPreview(null); }

  const sqlContent = (editing?.content ?? {}) as ReportSqlDatasetContent;
  const apiContent = (editing?.content ?? {}) as ReportApiDatasetContent;
  const formInitValues = editing
    ? {
        name: editing.name,
        datasourceId: editing.datasourceId,
        sql: sqlContent.sql ?? '',
        itemsPath: apiContent.itemsPath ?? '',
        paramsText: apiContent.params ? JSON.stringify(apiContent.params, null, 2) : '',
        status: editing.status,
        remark: editing.remark ?? '',
      }
    : { status: 'enabled' };

  /** 根据当前表单值构造 content（按选中数据源类型）*/
  function buildContent(values: Record<string, unknown>): Record<string, unknown> | null {
    if (selectedType === 'sql') {
      return { sql: String(values.sql ?? '') };
    }
    if (selectedType === 'api') {
      let params: Record<string, string> | undefined;
      const txt = String(values.paramsText ?? '').trim();
      if (txt) {
        try { params = JSON.parse(txt); }
        catch { Toast.error('参数不是合法 JSON'); return null; }
      }
      return { itemsPath: String(values.itemsPath ?? '') || null, params: params ?? null };
    }
    return {};
  }

  async function handlePreview() {
    const values = formApi.current?.getValues() as Record<string, unknown>;
    if (!selectedDsId) { Toast.warning('请先选择数据源'); return; }
    const content = buildContent(values ?? {});
    if (content === null) return;
    setPreviewLoading(true);
    try {
      const res = await request.post<ReportDataResult>('/api/report/datasets/preview', { datasourceId: selectedDsId, content, limit: 50 }, { silent: true });
      if (res.code === 0) { setPreview(res.data); }
      else { Toast.error(res.message || '预览失败'); setPreview(null); }
    } finally { setPreviewLoading(false); }
  }

  function applyFieldsFromPreview() {
    if (!preview) return;
    setFields(preview.columns.map((c) => ({ name: c, label: c, type: 'string' })));
    Toast.success(`已生成 ${preview.columns.length} 个字段`);
  }

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try { values = await formApi.current?.validate() as Record<string, unknown>; }
    catch { throw new Error('validation'); }
    if (!selectedDsId) { Toast.error('请选择数据源'); throw new Error('ds'); }
    const content = buildContent(values);
    if (content === null) throw new Error('content');

    const payload = { name: values.name, datasourceId: selectedDsId, content, fields, status: values.status, remark: values.remark || undefined };
    setSubmitting(true);
    try {
      const res = editing
        ? await request.put(`/api/report/datasets/${editing.id}`, payload)
        : await request.post('/api/report/datasets', payload);
      if (res.code === 0) { Toast.success(editing ? '更新成功' : '创建成功'); closeModal(); void fetchList(); }
      else throw new Error(res.message);
    } finally { setSubmitting(false); }
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/report/datasets/${id}`);
    if (res.code === 0) { Toast.success('删除成功'); void fetchList(); }
  }

  const columns: ColumnProps<ReportDataset>[] = [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '数据源', dataIndex: 'datasourceName', width: 160, render: (v: string) => v || '-' },
    {
      title: '类型', dataIndex: 'type', width: 80,
      render: (t: ReportDatasourceType) => t === 'api' ? <Tag color="blue" size="small">API</Tag> : <Tag color="violet" size="small">SQL</Tag>,
    },
    { title: '字段数', dataIndex: 'fields', width: 80, render: (f: ReportField[]) => (f?.length ?? 0) },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    {
      title: '状态', dataIndex: 'status', width: 70, fixed: 'right',
      render: (s: string) => s === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="grey" size="small">停用</Tag>,
    },
    createOperationColumn<ReportDataset>({
      width: 140,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => [
        ...(hasPermission('report:dataset:update') ? [{ key: 'edit', label: '编辑', onClick: () => openEdit(record) }] : []),
        ...(hasPermission('report:dataset:delete') ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => { Modal.confirm({ title: '确定要删除吗？', content: '删除后不可恢复', onOk: () => handleDelete(record.id) }); },
        }] : []),
      ],
    }),
  ];

  const previewColumns: ColumnProps<Record<string, unknown>>[] = (preview?.columns ?? []).map((c) => ({ title: c, dataIndex: c, width: 140 }));
  const previewData = (preview?.rows ?? []).map((r, i) => ({ ...r, __rk: i }));

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
  const renderCreateBtn = () => hasPermission('report:dataset:create')
    ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}{renderStatusFilter()}{renderSearchBtn()}{renderResetBtn()}</>}
        actions={renderCreateBtn()}
        mobilePrimary={<>{renderKeyword()}{renderSearchBtn()}{renderCreateBtn()}</>}
        mobileFilters={renderStatusFilter()}
        filterTitle="数据集筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
      />

      <AppModal
        title={editing ? '编辑数据集' : '新增数据集'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: submitting }}
        width={760}
      >
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInitValues}
          labelPosition="left" labelWidth={72} onValueChange={(v) => { if (v.datasourceId !== undefined) setSelectedDsId(v.datasourceId as number); }}>
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={64} showClear />
          <Form.Select field="datasourceId" label="数据源" style={{ width: '100%' }} rules={[{ required: true, message: '请选择数据源' }]}
            placeholder="选择数据源"
            optionList={datasources.map((d) => ({ value: d.id, label: `${d.name}（${d.type === 'api' ? 'API' : 'SQL'}）` }))}
          />

          {selectedType === 'sql' && (
            <Form.TextArea field="sql" label="SQL" placeholder="SELECT col1, col2 FROM your_table WHERE ..."
              autosize={{ minRows: 4, maxRows: 10 }} style={{ fontFamily: 'var(--semi-font-family-mono, monospace)' }}
              rules={[{ required: true, message: '请输入 SQL' }]} />
          )}
          {selectedType === 'api' && (
            <>
              <Form.Input field="itemsPath" label="数组路径" placeholder="选填，如 data.list；留空表示响应根即数组" showClear />
              <Form.TextArea field="paramsText" label="附加参数" placeholder={'选填，JSON 键值，如：\n{ "status": "paid" }'} autosize={{ minRows: 2, maxRows: 5 }} />
            </>
          )}

          <Form.Select field="status" label="状态" style={{ width: '100%' }}
            optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
          <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 2 }} />
        </Form>

        <div style={{ borderTop: '1px solid var(--semi-color-border)', marginTop: 8, paddingTop: 12 }}>
          <Space style={{ marginBottom: 8 }}>
            <Button icon={<Play size={14} />} onClick={handlePreview} loading={previewLoading} disabled={!selectedDsId}>试跑预览</Button>
            <Button onClick={applyFieldsFromPreview} disabled={!preview}>用结果生成字段</Button>
            <Typography.Text type="tertiary" size="small">
              当前字段：{fields.length} 个{fields.length ? `（${fields.slice(0, 6).map((f) => f.name).join(', ')}${fields.length > 6 ? '…' : ''}）` : ''}
            </Typography.Text>
          </Space>
          {preview ? (
            <div style={{ maxHeight: 240, overflow: 'auto', border: '1px solid var(--semi-color-border)', borderRadius: 6 }}>
              <Table size="small" bordered={false} columns={previewColumns} dataSource={previewData} rowKey="__rk" pagination={false}
                scroll={{ x: Math.max(600, previewColumns.length * 140) }} />
            </div>
          ) : (
            <Empty description="点击「试跑预览」查看取数结果" style={{ padding: '16px 0' }} />
          )}
        </div>
      </AppModal>
    </div>
  );
}
