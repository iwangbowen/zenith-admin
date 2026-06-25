import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Form, Popconfirm, Select, Space, Switch, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { request } from '@/utils/request';
import { createdAtColumn } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_RISK_SCOPE_LABELS } from '@zenith/shared';
import type { PaginatedResponse, PaymentChannel, PaymentRiskRule, PaymentRiskScope } from '@zenith/shared';

const yuan = (cents: number | null | undefined) => (cents == null ? '-' : `¥${(cents / 100).toFixed(2)}`);
const channelOptions = Object.entries(PAYMENT_CHANNEL_LABELS).map(([value, label]) => ({ value, label }));
const scopeOptions = Object.entries(PAYMENT_RISK_SCOPE_LABELS).map(([value, label]) => ({ value, label }));

interface SearchParams { scope: string; status: string; }
const defaultSearch: SearchParams = { scope: '', status: '' };

interface RiskFormValues {
  name: string;
  scope: PaymentRiskScope;
  channel?: PaymentChannel;
  bizType?: string;
  singleYuan?: number;
  dailyYuan?: number;
  dailyCountLimit?: number;
  blocklist?: string[];
  status?: 'enabled' | 'disabled';
  remark?: string;
}

export default function PaymentRiskRulesPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<PaginatedResponse<PaymentRiskRule> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [search, setSearch] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = search;

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PaymentRiskRule | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scopeWatch, setScopeWatch] = useState<PaymentRiskScope>('global');
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const active = params ?? searchRef.current;
      setLoading(true);
      try {
        const query: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (active.scope) query.scope = active.scope;
        if (active.status) query.status = active.status;
        const res = await request.get<PaginatedResponse<PaymentRiskRule>>(`/api/payment/risk-rules?${new URLSearchParams(query)}`);
        if (res.code === 0) { setData(res.data); setPage(res.data.page); setPageSize(res.data.pageSize); }
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [page, pageSize],
  );

  useEffect(() => {
    void fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSearch() { setPage(1); void fetchList(1, pageSize); }
  function handleReset() { setSearch(defaultSearch); setPage(1); void fetchList(1, pageSize, defaultSearch); }

  function openCreate() { setEditing(null); setScopeWatch('global'); setModalVisible(true); }
  function openEdit(record: PaymentRiskRule) { setEditing(record); setScopeWatch(record.scope); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const formInit: Partial<RiskFormValues> = editing
    ? {
        name: editing.name,
        scope: editing.scope,
        channel: editing.channel ?? undefined,
        bizType: editing.bizType ?? undefined,
        singleYuan: editing.singleLimit != null ? editing.singleLimit / 100 : undefined,
        dailyYuan: editing.dailyLimit != null ? editing.dailyLimit / 100 : undefined,
        dailyCountLimit: editing.dailyCountLimit ?? undefined,
        blocklist: editing.blocklist ?? [],
        status: editing.status,
        remark: editing.remark ?? '',
      }
    : { scope: 'global', status: 'enabled', blocklist: [] };

  async function handleOk() {
    let values: RiskFormValues;
    try { values = (await formApi.current?.validate()) as RiskFormValues; } catch { throw new Error('validation'); }
    setSubmitting(true);
    try {
      const payload = {
        name: values.name,
        scope: values.scope,
        channel: values.scope === 'channel' ? values.channel : undefined,
        bizType: values.scope === 'bizType' ? values.bizType : undefined,
        singleLimit: values.singleYuan != null ? Math.round(values.singleYuan * 100) : undefined,
        dailyLimit: values.dailyYuan != null ? Math.round(values.dailyYuan * 100) : undefined,
        dailyCountLimit: values.dailyCountLimit ?? undefined,
        blocklist: values.blocklist ?? [],
        status: values.status,
        remark: values.remark || undefined,
      };
      const res = editing
        ? await request.put<PaymentRiskRule>(`/api/payment/risk-rules/${editing.id}`, payload)
        : await request.post<PaymentRiskRule>('/api/payment/risk-rules', payload);
      if (res.code === 0) { Toast.success(editing ? '更新成功' : '创建成功'); closeModal(); void fetchList(); }
      else throw new Error(res.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleToggle(record: PaymentRiskRule, checked: boolean) {
    setTogglingIds((prev) => new Set(prev).add(record.id));
    request
      .put<PaymentRiskRule>(`/api/payment/risk-rules/${record.id}`, { status: checked ? 'enabled' : 'disabled' })
      .then((res) => { if (res.code === 0) { Toast.success(checked ? '已启用' : '已停用'); void fetchList(); } })
      .finally(() => setTogglingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; }));
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/payment/risk-rules/${id}`);
    if (res.code === 0) { Toast.success('删除成功'); void fetchList(); }
  }

  const columns: ColumnProps<PaymentRiskRule>[] = [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '作用域', dataIndex: 'scope', width: 110, render: (v: PaymentRiskScope) => PAYMENT_RISK_SCOPE_LABELS[v] },
    { title: '范围', dataIndex: 'channel', width: 120, render: (_: unknown, r: PaymentRiskRule) => (r.scope === 'channel' ? (r.channel ? PAYMENT_CHANNEL_LABELS[r.channel] : '-') : r.scope === 'bizType' ? (r.bizType || '-') : '全局') },
    { title: '单笔上限', dataIndex: 'singleLimit', width: 110, render: (v: number | null) => yuan(v) },
    { title: '当日限额', dataIndex: 'dailyLimit', width: 110, render: (v: number | null) => yuan(v) },
    { title: '当日笔数', dataIndex: 'dailyCountLimit', width: 100, render: (v: number | null) => (v == null ? '-' : v) },
    { title: '黑名单', dataIndex: 'blocklist', width: 90, render: (v: string[]) => (v.length ? <Tag color="red">{v.length} 项</Tag> : '-') },
    createdAtColumn as ColumnProps<PaymentRiskRule>,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, r: PaymentRiskRule) => (
        <Switch checked={r.status === 'enabled'} loading={togglingIds.has(r.id)} disabled={!hasPermission('payment:risk:update')} size="small" onChange={(c) => handleToggle(r, c)} />
      ),
    },
    {
      title: '操作', fixed: 'right', width: 120,
      render: (_: unknown, r: PaymentRiskRule) => (
        <Space>
          {hasPermission('payment:risk:update') && <Button theme="borderless" size="small" onClick={() => openEdit(r)}>编辑</Button>}
          {hasPermission('payment:risk:delete') && (
            <Popconfirm title="确定要删除吗？" content="删除后不可恢复" onConfirm={() => handleDelete(r.id)}>
              <Button theme="borderless" type="danger" size="small">删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const renderScopeFilter = () => (
    <Select
      placeholder="全部作用域"
      value={search.scope || undefined}
      onChange={(v) => setSearch((p) => ({ ...p, scope: (v as string) ?? '' }))}
      showClear
      style={{ width: 130 }}
      optionList={scopeOptions}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={search.status || undefined}
      onChange={(v) => setSearch((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => hasPermission('payment:risk:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderScopeFilter()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderScopeFilter()}
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderStatusFilter()}
          </>
        )}
        filterTitle="风控规则筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
      />

      <AppModal title={editing ? '编辑风控规则' : '新增风控规则'} visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: submitting }} width={700} closeOnEsc>
        <Form
          key={editing?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInit}
          labelPosition="left"
          labelWidth={100}
          onValueChange={(v) => { if (v.scope && v.scope !== scopeWatch) setScopeWatch(v.scope as PaymentRiskScope); }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
            <Form.Input field="name" label="名称" placeholder="如：大额交易拦截" rules={[{ required: true, message: '名称不能为空' }]} />
            <Form.Select field="scope" label="作用域" style={{ width: '100%' }} optionList={scopeOptions} rules={[{ required: true, message: '请选择作用域' }]} />
          </div>
          {scopeWatch === 'channel' && <Form.Select field="channel" label="渠道" style={{ width: '100%' }} optionList={channelOptions} rules={[{ required: true, message: '请选择渠道' }]} />}
          {scopeWatch === 'bizType' && <Form.Input field="bizType" label="业务类型" placeholder="如：membership" rules={[{ required: true, message: '请输入业务类型' }]} />}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
            <Form.InputNumber field="singleYuan" label="单笔上限(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
            <Form.InputNumber field="dailyYuan" label="当日累计(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
            <Form.InputNumber field="dailyCountLimit" label="当日笔数" min={0} step={1} precision={0} style={{ width: '100%' }} placeholder="可选" />
            <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
          </div>
          <Form.TagInput field="blocklist" label="黑名单" placeholder="输入 openId / userId 后回车" />
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', margin: '-8px 0 8px 100px' }}>命中黑名单的 openId / userId 将被拦截下单</Typography.Text>
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>
    </div>
  );
}
