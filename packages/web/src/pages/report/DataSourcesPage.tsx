import { useState, useRef } from 'react';
import { Button, Form, Input, Select, Switch, Tag, Toast, Modal, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useQueryClient } from '@tanstack/react-query';
import {
  reportDatasourceKeys,
  useDeleteReportDatasource,
  useReportDatasourceList,
  useSaveReportDatasource,
  useTestReportDatasourceConnection,
} from '@/hooks/queries/report-datasources';
import type {
  ReportDatasource, ReportDatasourceType, ReportApiDatasourceConfig, ReportExternalDbConfig,
} from '@zenith/shared';

interface SearchParams { keyword: string; type: string; status: string }
const defaultSearchParams: SearchParams = { keyword: '', type: '', status: '' };

const TYPE_OPTIONS = [
  { value: 'api', label: 'API（远程 HTTP）' },
  { value: 'sql', label: 'SQL（内置只读主库）' },
  { value: 'mysql', label: 'MySQL（外部库）' },
  { value: 'postgresql', label: 'PostgreSQL（外部库）' },
  { value: 'sqlserver', label: 'SQL Server（外部库）' },
  { value: 'static', label: '静态数据（JSON/文件）' },
];

function typeTag(type: ReportDatasourceType) {
  if (type === 'api') return <Tag color="blue" size="small">API</Tag>;
  if (type === 'sql') return <Tag color="violet" size="small">SQL</Tag>;
  if (type === 'mysql') return <Tag color="cyan" size="small">MySQL</Tag>;
  if (type === 'postgresql') return <Tag color="indigo" size="small">PostgreSQL</Tag>;
  if (type === 'sqlserver') return <Tag color="orange" size="small">SQL Server</Tag>;
  return <Tag color="grey" size="small">静态</Tag>;
}

function isExternalDbType(type: unknown): type is 'mysql' | 'postgresql' | 'sqlserver' {
  return type === 'mysql' || type === 'postgresql' || type === 'sqlserver';
}

export default function DataSourcesPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();

  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<ReportDatasource | null>(null);

  const listQuery = useReportDatasourceList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    type: submittedParams.type || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data ?? null;
  const saveMutation = useSaveReportDatasource();
  const toggleMutation = useSaveReportDatasource();
  const deleteMutation = useDeleteReportDatasource();
  const testConnectionMutation = useTestReportDatasourceConnection();
  const togglingId = toggleMutation.isPending ? toggleMutation.variables?.id ?? null : null;

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: reportDatasourceKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearchParams); setSubmittedParams(defaultSearchParams); setPage(1); void queryClient.invalidateQueries({ queryKey: reportDatasourceKeys.lists }); }

  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(record: ReportDatasource) { setEditing(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const apiConfig = (editing?.config ?? {}) as ReportApiDatasourceConfig;
  const externalConfig = (editing?.config ?? {}) as ReportExternalDbConfig;
  const formInitValues = editing
    ? {
        name: editing.name,
        type: editing.type,
        url: apiConfig.url ?? '',
        method: apiConfig.method ?? 'GET',
        headersText: apiConfig.headers ? JSON.stringify(apiConfig.headers, null, 2) : '',
        host: externalConfig.host ?? '',
        port: externalConfig.port ?? (editing.type === 'postgresql' ? 5432 : editing.type === 'sqlserver' ? 1433 : 3306),
        database: externalConfig.database ?? '',
        user: externalConfig.user ?? '',
        password: '',
        ssl: externalConfig.ssl ?? false,
        status: editing.status,
        remark: editing.remark ?? '',
      }
    : { type: 'api', method: 'GET', port: 3306, status: 'enabled' };

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
    if (isExternalDbType(type)) {
      const password = String(values.password ?? '').trim();
      config = {
        host: String(values.host ?? '').trim(),
        port: Number(values.port),
        database: String(values.database ?? '').trim(),
        user: String(values.user ?? '').trim(),
        ssl: !!values.ssl,
        ...(password ? { password } : {}),
      };
    }

    const payload = { name: values.name, type, config, status: values.status, remark: values.remark || undefined };
    await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleTestConnection() {
    const values = formApi.current?.getValues() as Record<string, unknown> | undefined;
    const type = values?.type as ReportDatasourceType | undefined;
    if (!values || !isExternalDbType(type)) return;
    const host = String(values.host ?? '').trim();
    const database = String(values.database ?? '').trim();
    const user = String(values.user ?? '').trim();
    const port = Number(values.port);
    if (!host || !port || !database || !user) { Toast.warning('请先填写连接信息'); return; }
    const password = String(values.password ?? '').trim();
    try {
      const res = await testConnectionMutation.mutateAsync({
        id: editing?.id,
        type,
        config: { host, port, database, user, ssl: !!values.ssl, ...(password ? { password } : {}) },
      });
      if (res.ok) Toast.success(res.latencyMs != null ? `连接成功（${res.latencyMs}ms）` : '连接成功');
      else Toast.error(res.message || '连接失败');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '连接失败');
    }
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  function handleToggleStatus(record: ReportDatasource, checked: boolean) {
    const doToggle = async () => {
      await toggleMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } });
      Toast.success(checked ? '已启用' : '已停用');
    };
    if (checked) void doToggle();
    else Modal.confirm({ title: '确认停用', content: `停用后「${record.name}」将不可用于取数，确认停用？`, onOk: () => void doToggle() });
  }

  const columns: ColumnProps<ReportDatasource>[] = [
    { title: '名称', dataIndex: 'name', width: 180 },
    { title: '类型', dataIndex: 'type', width: 90, render: (t: ReportDatasourceType) => typeTag(t) },
    {
      title: '连接', dataIndex: 'config', width: 320,
      render: (_: unknown, r: ReportDatasource) => {
        if (r.type === 'api') {
          return <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%', color: 'var(--semi-color-text-1)' }}>{(r.config as ReportApiDatasourceConfig).url ?? '-'}</Typography.Text>;
        }
        if (r.type === 'sql') return <span style={{ color: 'var(--semi-color-text-2)' }}>内置只读主库</span>;
        if (r.type === 'static') return <span style={{ color: 'var(--semi-color-text-2)' }}>静态容器</span>;
        const cfg = r.config as ReportExternalDbConfig;
        const text = `${cfg.user ?? '-'}@${cfg.host ?? '-'}:${cfg.port ?? '-'}/${cfg.database ?? '-'}`;
        return <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%', color: 'var(--semi-color-text-1)' }}>{text}</Typography.Text>;
      },
    },
    { title: '备注', dataIndex: 'remark', width: 180, render: renderEllipsis },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, record: ReportDatasource) => (
        <Switch
          checked={record.status === 'enabled'}
          loading={togglingId === record.id}
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
    <Input prefix={<Search size={14} />} placeholder="搜索名称/备注..." value={draftParams.keyword}
      onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} showClear style={{ width: 220 }} onEnterPress={handleSearch} />
  );
  const renderTypeFilter = () => (
    <Select placeholder="全部类型" value={draftParams.type || undefined} onChange={(v) => setDraftParams((p) => ({ ...p, type: (v as string) ?? '' }))}
      showClear style={{ width: 140 }} optionList={TYPE_OPTIONS} />
  );
  const renderStatusFilter = () => (
    <Select placeholder="全部状态" value={draftParams.status || undefined} onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
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
        bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal
        title={editing ? '编辑数据源' : '新增数据源'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={560}
      >
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInitValues} labelPosition="left" labelWidth={72}>
          {({ values }) => (
            <>
              <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={64} showClear placeholder="如：订单库" />
              <Form.Select
                field="type"
                label="类型"
                optionList={TYPE_OPTIONS}
                style={{ width: '100%' }}
                rules={[{ required: true }]}
                onChange={(v) => {
                  if (v === 'mysql') formApi.current?.setValue('port', 3306);
                  if (v === 'postgresql') formApi.current?.setValue('port', 5432);
                  if (v === 'sqlserver') formApi.current?.setValue('port', 1433);
                }}
              />
              {values.type === 'api' ? (
                <>
                  <Form.Input field="url" label="URL" placeholder="https://api.example.com/data" rules={[{ required: true, message: '请输入 URL' }]} showClear />
                  <Form.Select field="method" label="方法" optionList={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }]} style={{ width: '100%' }} />
                  <Form.TextArea field="headersText" label="请求头" placeholder={'选填，JSON 键值，如：\n{ "Authorization": "Bearer xxx" }'} autosize={{ minRows: 2, maxRows: 5 }} />
                </>
              ) : isExternalDbType(values.type) ? (
                <>
                  <Form.Input field="host" label="主机" placeholder="127.0.0.1" rules={[{ required: true, message: '请输入主机' }]} showClear />
                  <Form.InputNumber field="port" label="端口" min={1} max={65535} style={{ width: '100%' }} rules={[{ required: true, message: '请输入端口' }]} />
                  <Form.Input field="database" label="数据库" rules={[{ required: true, message: '请输入数据库名' }]} showClear />
                  <Form.Input field="user" label="用户" rules={[{ required: true, message: '请输入用户名' }]} showClear />
                  <Form.Input
                    field="password"
                    label="密码"
                    mode="password"
                    placeholder={editing ? '留空表示不修改' : '请输入密码'}
                    helpText={editing && externalConfig.hasPassword ? '已保存密码，留空表示继续使用原密码' : undefined}
                  />
                  <Form.Switch field="ssl" label="SSL" />
                  <Form.Slot label=" ">
                    <Button onClick={handleTestConnection} loading={testConnectionMutation.isPending}>测试连接</Button>
                  </Form.Slot>
                </>
              ) : values.type === 'static' ? (
                <Form.Slot label="说明">
                  <span style={{ color: 'var(--semi-color-text-2)', fontSize: 13 }}>静态数据源仅作容器，数据在「数据集」中以 JSON 粘贴或上传 Excel/CSV 维护。</span>
                </Form.Slot>
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
