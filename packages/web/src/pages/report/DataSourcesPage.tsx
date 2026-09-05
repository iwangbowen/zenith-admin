import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Col, Form, Row, Switch, Toast, Modal, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Activity } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { createdAtColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import {
  reportDatasourceKeys,
  useBatchReportDatasourceStatus,
  useCloneReportDatasource,
  useDeleteReportDatasources,
  useRunReportDatasourceHealthCheck,
  useReportDatasourceList,
  useSaveReportDatasource,
  useTestReportDatasourceConnection,
} from '@/hooks/queries/report-datasources';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import type { ReportDatasource, ReportDatasourceType, ReportApiDatasourceConfig, ReportExternalDbConfig } from '@zenith/shared/report';
import { REPORT_DATASOURCE_TYPE_OPTIONS, REPORT_DATASOURCE_TYPES } from '@zenith/shared/report';
import { useDictItems } from '@/hooks/useDictItems';
import { renderReportDatasourceTypeTag } from './report-datasource-ui';
import { flattenReportFolders, useReportFolderTree } from '@/hooks/queries/report-folders';
import { useAllUsers } from '@/hooks/queries/users';
import { useListSearch } from '@/hooks/useListSearch';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { abortSubmit } from '@/lib/abort-submit';

interface SearchParams { keyword: string; type?: string; status?: string; ownerId?: number; folderId?: number }
const defaultSearchParams: SearchParams = { keyword: '', type: undefined, status: undefined, ownerId: undefined, folderId: undefined };

function isExternalDbType(type: unknown): type is 'mysql' | 'postgresql' | 'sqlserver' {
  return type === 'mysql' || type === 'postgresql' || type === 'sqlserver';
}

export default function DataSourcesPage() {
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const navigate = useNavigate();

  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: reportDatasourceKeys.lists });

  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

  const listQuery = useReportDatasourceList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    type: enumValueOf(REPORT_DATASOURCE_TYPES, submittedParams.type),
    status: enumValueOf(USER_STATUSES, submittedParams.status),
    ownerId: submittedParams.ownerId,
    folderId: submittedParams.folderId,
  });
  const users = useAllUsers().data ?? [];
  const folders = flattenReportFolders(useReportFolderTree({ resourceType: 'datasource' }).data ?? []);
  const data = listQuery.data ?? null;
  const saveMutation = useSaveReportDatasource();
  const toggleMutation = useSaveReportDatasource();
  const batchStatusMutation = useBatchReportDatasourceStatus();
  const cloneMutation = useCloneReportDatasource();
  const healthTaskMutation = useRunReportDatasourceHealthCheck();
  const deleteMutation = useDeleteReportDatasources();
  const testConnectionMutation = useTestReportDatasourceConnection();
  const togglingId = toggleMutation.isPending ? toggleMutation.variables?.id ?? null : null;

  const datasourceModal = useEditModal<ReportDatasource, Record<string, unknown>>({
    entityName: '数据源',
    save: saveMutation,
    defaults: { type: 'api', method: 'GET', port: 3306, status: 'enabled' },
    labelWidth: 72,
    toValues: (record) => {
      const api = (record.config ?? {}) as ReportApiDatasourceConfig;
      const external = (record.config ?? {}) as ReportExternalDbConfig;
      return {
        name: record.name,
        type: record.type,
        url: api.url ?? '',
        method: api.method ?? 'GET',
        headersText: api.headers ? JSON.stringify(api.headers, null, 2) : '',
        host: external.host ?? '',
        port: external.port ?? (record.type === 'postgresql' ? 5432 : record.type === 'sqlserver' ? 1433 : 3306),
        database: external.database ?? '',
        user: external.user ?? '',
        password: '',
        ssl: external.ssl ?? false,
        ownerId: record.ownerId ?? undefined,
        folderId: record.folderId ?? undefined,
        status: record.status,
        remark: record.remark ?? '',
      };
    },
    beforeSave: (values) => {
      const type = values.type as ReportDatasourceType;
      let config: Record<string, unknown> = {};
      if (type === 'api') {
        const url = String(values.url ?? '').trim();
        if (!/^https?:\/\//i.test(url)) { Toast.error('请填写以 http:// 或 https:// 开头的 URL'); abortSubmit('url'); }
        let headers: Record<string, string> | undefined;
        const headersText = String(values.headersText ?? '').trim();
        if (headersText) {
          try { headers = JSON.parse(headersText); }
          catch { Toast.error('请求头不是合法 JSON'); abortSubmit('headers'); }
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
      return {
        name: values.name,
        ownerId: values.ownerId ? Number(values.ownerId) : null,
        folderId: values.folderId ? Number(values.folderId) : null,
        type,
        config,
        status: values.status,
        remark: values.remark || undefined,
      };
    },
  });
  const editing = datasourceModal.editing;
  const externalConfig = (editing?.config ?? {}) as ReportExternalDbConfig;

  async function handleTestConnection() {
    const values = datasourceModal.formApi.current?.getValues() as Record<string, unknown> | undefined;
    const type = values?.type as ReportDatasourceType | undefined;
    if (!values || (!isExternalDbType(type) && type !== 'api')) return;
    try {
      let res: { ok: boolean; message: string; latencyMs?: number };
      if (type === 'api') {
        const url = String(values.url ?? '').trim();
        if (!url) { Toast.warning('请先填写 URL'); return; }
        let headers: Record<string, string> | undefined;
        const headersText = String(values.headersText ?? '').trim();
        if (headersText) {
          try { headers = JSON.parse(headersText) as Record<string, string>; }
          catch { Toast.warning('请求头不是合法 JSON'); return; }
        }
        res = await testConnectionMutation.mutateAsync({ body: {
          id: editing?.id,
          type,
          config: { url, method: values.method === 'POST' ? 'POST' : 'GET', ...(headers ? { headers } : {}) },
        } });
      } else {
        const host = String(values.host ?? '').trim();
        const database = String(values.database ?? '').trim();
        const user = String(values.user ?? '').trim();
        const port = Number(values.port);
        if (!host || !port || !database || !user) { Toast.warning('请先填写连接信息'); return; }
        const password = String(values.password ?? '').trim();
        res = await testConnectionMutation.mutateAsync({ body: {
          id: editing?.id,
          type,
          config: { host, port, database, user, ssl: !!values.ssl, ...(password ? { password } : {}) },
        } });
      }
      if (res.ok) Toast.success(res.latencyMs != null ? `连接成功（${res.latencyMs}ms）` : '连接成功');
      else Toast.error(res.message || '连接失败');
    } catch (error) {
      Toast.error(error instanceof Error ? error.message : '连接失败');
    }
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync([id]);
    Toast.success('删除成功');
  }

  function healthTag(status: ReportDatasource['lastTestStatus']) {
    if (status === 'success') return <Typography.Text style={{ color: 'var(--semi-color-success)' }}>健康</Typography.Text>;
    if (status === 'failed') return <Typography.Text type="danger">异常</Typography.Text>;
    return <Typography.Text type="tertiary">未检测</Typography.Text>;
  }

  function handleToggleStatus(record: ReportDatasource, checked: boolean) {
    const doToggle = async () => {
      await toggleMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } });
      Toast.success(checked ? '已启用' : '已停用');
    };
    if (checked) void doToggle();
    else Modal.confirm({ title: '确认停用', content: `停用后「${record.name}」将不可用于取数，确认停用？`, onOk: () => void doToggle() });
  }

  function handleBatchStatus(status: 'enabled' | 'disabled') {
    if (selectedRowKeys.length === 0) return;
    const label = status === 'enabled' ? '启用' : '停用';
    Modal.confirm({
      title: `确认批量${label}选中的 ${selectedRowKeys.length} 个数据源？`,
      content: status === 'disabled' ? '停用后相关数据集将无法继续取数。' : '启用后数据集可继续使用这些数据源。',
      onOk: async () => {
        await batchStatusMutation.mutateAsync({ body: { ids: selectedRowKeys, status } });
        setSelectedRowKeys([]);
        Toast.success(`批量${label}成功`);
      },
    });
  }

  async function handleClone(record: ReportDatasource) {
    const cloned = await cloneMutation.mutateAsync({ params: { id: record.id }, body: {} });
    Toast.success(`已复制为「${cloned.name}」`);
  }

  async function handleHealthCheck(ids: number[], name?: string) {
    const task = await healthTaskMutation.mutateAsync({ body: { ids } });
    Toast.success(name ? `已提交「${name}」健康检查任务` : `已提交 ${ids.length} 个数据源的健康检查任务（#${task.id}）`);
  }

  const columns: ColumnProps<ReportDatasource>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 180, render: renderEllipsis },
    { title: '类型', dataIndex: 'type', width: 90, render: (t: ReportDatasourceType) => renderReportDatasourceTypeTag(t) },
    { title: '负责人', dataIndex: 'ownerName', width: 120, render: (v: string | null) => v || '—' },
    { title: '目录', dataIndex: 'folderName', width: 140, render: (v: string | null) => v || '—' },
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
    {
      title: '健康状态', dataIndex: 'lastTestStatus', width: 110,
      render: (value: ReportDatasource['lastTestStatus'], record: ReportDatasource) => {
        if (record.type === 'static') return EMPTY_PLACEHOLDER;
        // 测试明细收进 tooltip：列表保持紧凑，悬停可见延迟/连续失败/最近错误
        return (
          <Tooltip
            content={(
              <div style={{ maxWidth: 320 }}>
                <div>最近测试：{record.lastTestAt ?? '未检测'}</div>
                <div>测试延迟：{record.lastTestLatencyMs == null ? EMPTY_PLACEHOLDER : `${record.lastTestLatencyMs}ms`}</div>
                <div>连续失败：{record.consecutiveFailures ?? 0}</div>
                {record.lastTestError ? <div>最近错误：{record.lastTestError}</div> : null}
              </div>
            )}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {healthTag(value)}
              {(record.consecutiveFailures ?? 0) > 0 ? (
                <Typography.Text type="danger" size="small">×{record.consecutiveFailures}</Typography.Text>
              ) : null}
            </span>
          </Tooltip>
        );
      },
    },
    { title: '备注', dataIndex: 'remark', width: 180, render: renderEllipsis },
    createdAtColumn,
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
      width: 180,
      desktopInlineKeys: ['health', 'edit'],
      actions: (record) => [
        // 静态数据源是纯容器，无连接可测，不提供「检测」
        ...(hasPermission('report:datasource:update') && record.type !== 'static'
          ? [{ key: 'health', label: '检测', onClick: () => void handleHealthCheck([record.id], record.name) }] : []),
        ...(hasPermission('report:datasource:update') ? [{ key: 'edit', label: '编辑', onClick: () => datasourceModal.openEdit(record) }] : []),
        { key: 'governance', label: '权限与转移', onClick: () => navigate(`/report/governance?resourceType=datasource&resourceId=${record.id}`) },
        ...(hasPermission('report:datasource:create') ? [{ key: 'clone', label: '复制', onClick: () => void handleClone(record) }] : []),
        ...(hasPermission('report:datasource:delete') ? [{
          key: 'delete', label: '删除', danger: true,
          onClick: () => { confirmDelete({ content: '删除后不可恢复；若被数据集引用将无法删除。', onOk: () => handleDelete(record.id) }); },
        }] : []),
      ],
    }),
  ];

  const renderKeyword = () => (
    <KeywordInput placeholder="搜索名称/备注..." value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
  );
  const renderTypeFilter = () => (
    <FilterSelect
      placeholder="全部类型"
      items={REPORT_DATASOURCE_TYPE_OPTIONS}
      value={draftParams.type}
      onChange={(v) => setDraftParams((p) => ({ ...p, type: v }))}
      width={140}
    />
  );
  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.status}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))}
    />
  );
  const renderOwnerFilter = () => (
    <FilterSelect
      placeholder="全部负责人"
      items={users.map((u) => ({ value: u.id, label: u.nickname || u.username }))}
      value={draftParams.ownerId}
      onChange={(v) => setDraftParams((p) => ({ ...p, ownerId: v as number | undefined }))}
      filter
      width={140}
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
  const renderCreateBtn = () => hasPermission('report:datasource:create')
    ? <CreateButton onClick={datasourceModal.openCreate} /> : null;
  const renderBatchHealthBtn = () => selectedRowKeys.length > 0 && hasPermission('report:datasource:update')
    ? <Button icon={<Activity size={14} />} onClick={() => void handleHealthCheck(selectedRowKeys)}>批量检测</Button> : null;
  const renderBatchEnableBtn = () => selectedRowKeys.length > 0 && hasPermission('report:datasource:update')
    ? <Button onClick={() => handleBatchStatus('enabled')}>批量启用</Button> : null;
  const renderBatchDisableBtn = () => selectedRowKeys.length > 0 && hasPermission('report:datasource:update')
    ? <Button type="danger" onClick={() => handleBatchStatus('disabled')}>批量停用</Button> : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<>{renderKeyword()}{renderTypeFilter()}{renderOwnerFilter()}{renderFolderFilter()}{renderStatusFilter()}{renderSearchBtn()}{renderResetBtn()}</>}
        actions={<>{renderBatchHealthBtn()}{renderBatchEnableBtn()}{renderBatchDisableBtn()}{renderCreateBtn()}</>}
        mobilePrimary={<>{renderKeyword()}{renderSearchBtn()}{renderCreateBtn()}</>}
        mobileFilters={<>{renderTypeFilter()}{renderOwnerFilter()}{renderFolderFilter()}{renderStatusFilter()}</>}
        mobileActions={<>{renderBatchHealthBtn()}{renderBatchEnableBtn()}{renderBatchDisableBtn()}</>}
        filterTitle="数据源筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        rowSelection={hasPermission('report:datasource:update') ? {
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as number[]),
        } : undefined}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(data?.total ?? 0)}
      />

      <AppModal
        {...datasourceModal.modalProps}
        width={660}
      >
        <Form key={datasourceModal.formKey} {...datasourceModal.formProps}>
          {({ values }) => (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} maxLength={64} showClear placeholder="如：订单库" />
                </Col>
                <Col span={12}>
                  <Form.Select
                    field="type"
                    label="类型"
                    optionList={REPORT_DATASOURCE_TYPE_OPTIONS}
                    style={{ width: '100%' }}
                    rules={[{ required: true }]}
                    onChange={(v) => {
                      if (v === 'mysql') datasourceModal.formApi.current?.setValue('port', 3306);
                      if (v === 'postgresql') datasourceModal.formApi.current?.setValue('port', 5432);
                      if (v === 'sqlserver') datasourceModal.formApi.current?.setValue('port', 1433);
                    }}
                  />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Select field="ownerId" label="负责人" filter showClear style={{ width: '100%' }}
                    optionList={users.map((u) => ({ value: u.id, label: u.nickname || u.username }))} />
                </Col>
                <Col span={12}>
                  <Form.Select field="folderId" label="资源目录" filter showClear style={{ width: '100%' }}
                    optionList={folders.map((f) => ({ value: f.id, label: f.name }))} />
                </Col>
              </Row>
              {values.type === 'api' ? (
                <>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Input field="url" label="URL" placeholder="https://api.example.com/data" rules={[{ required: true, message: '请输入 URL' }]} showClear />
                    </Col>
                    <Col span={12}>
                      <Form.Select field="method" label="方法" optionList={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }]} style={{ width: '100%' }} />
                    </Col>
                  </Row>
                  <Form.TextArea field="headersText" label="请求头" placeholder={'选填，JSON 键值，如：\n{ "Authorization": "Bearer xxx" }'} autosize={{ minRows: 2, maxRows: 5 }} />
                  <Form.Slot label=" ">
                    <Button onClick={handleTestConnection} loading={testConnectionMutation.isPending}>测试连接</Button>
                  </Form.Slot>
                </>
              ) : isExternalDbType(values.type) ? (
                <>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Input field="host" label="主机" placeholder="127.0.0.1" rules={[{ required: true, message: '请输入主机' }]} showClear />
                    </Col>
                    <Col span={12}>
                      <Form.InputNumber field="port" label="端口" min={1} max={65535} style={{ width: '100%' }} rules={[{ required: true, message: '请输入端口' }]} />
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Input field="database" label="数据库" rules={[{ required: true, message: '请输入数据库名' }]} showClear />
                    </Col>
                    <Col span={12}>
                      <Form.Input field="user" label="用户" rules={[{ required: true, message: '请输入用户名' }]} showClear />
                    </Col>
                  </Row>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Input
                        field="password"
                        label="密码"
                        mode="password"
                        placeholder={editing ? '留空表示不修改' : '请输入密码'}
                        helpText={editing && externalConfig.hasPassword ? '已保存密码，留空表示继续使用原密码' : undefined}
                      />
                    </Col>
                    <Col span={12}>
                      <Form.Switch field="ssl" label="SSL" />
                    </Col>
                  </Row>
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
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Select field="status" label="状态" style={{ width: '100%' }}
                    optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
                </Col>
              </Row>
              <Form.TextArea field="remark" label="备注" maxLength={256} autosize={{ minRows: 1, maxRows: 3 }} />
            </>
          )}
        </Form>
      </AppModal>
    </div>
  );
}
