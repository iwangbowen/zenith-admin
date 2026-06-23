import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Form, Popconfirm, Select, Space, Spin, Switch, Tag, Toast } from '@douyinfe/semi-ui';
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
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_LABELS } from '@zenith/shared';
import type { PaginatedResponse, PaymentChannel, PaymentFeeRule, PaymentMethod } from '@zenith/shared';

const yuan = (cents: number | null | undefined) => (cents == null ? '-' : `¥${(cents / 100).toFixed(2)}`);
const channelOptions = Object.entries(PAYMENT_CHANNEL_LABELS).map(([value, label]) => ({ value, label }));
const methodOptions = Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }));

interface SearchParams { channel: string; status: string; }
const defaultSearch: SearchParams = { channel: '', status: '' };

interface FeeFormValues {
  name: string;
  channel: PaymentChannel;
  payMethod?: PaymentMethod;
  ratePercent?: number;
  fixedYuan?: number;
  minYuan?: number;
  maxYuan?: number;
  priority?: number;
  status?: 'enabled' | 'disabled';
  remark?: string;
}

export default function PaymentFeeRulesPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<PaginatedResponse<PaymentFeeRule> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [search, setSearch] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = search;

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PaymentFeeRule | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [togglingIds, setTogglingIds] = useState<Set<number>>(new Set());

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const active = params ?? searchRef.current;
      setLoading(true);
      try {
        const query: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (active.channel) query.channel = active.channel;
        if (active.status) query.status = active.status;
        const res = await request.get<PaginatedResponse<PaymentFeeRule>>(`/api/payment/fee-rules?${new URLSearchParams(query)}`);
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

  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(record: PaymentFeeRule) { setEditing(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const formInit: Partial<FeeFormValues> = editing
    ? {
        name: editing.name,
        channel: editing.channel,
        payMethod: editing.payMethod ?? undefined,
        ratePercent: editing.rateBps / 100,
        fixedYuan: editing.fixedFee / 100,
        minYuan: editing.minFee != null ? editing.minFee / 100 : undefined,
        maxYuan: editing.maxFee != null ? editing.maxFee / 100 : undefined,
        priority: editing.priority,
        status: editing.status,
        remark: editing.remark ?? '',
      }
    : { channel: 'wechat', status: 'enabled', priority: 0, ratePercent: 0.6, fixedYuan: 0 };

  async function handleOk() {
    let values: FeeFormValues;
    try { values = (await formApi.current?.validate()) as FeeFormValues; } catch { throw new Error('validation'); }
    setSubmitting(true);
    try {
      const payload = {
        name: values.name,
        channel: values.channel,
        payMethod: values.payMethod || undefined,
        rateBps: Math.round((values.ratePercent ?? 0) * 100),
        fixedFee: Math.round((values.fixedYuan ?? 0) * 100),
        minFee: values.minYuan != null ? Math.round(values.minYuan * 100) : undefined,
        maxFee: values.maxYuan != null ? Math.round(values.maxYuan * 100) : undefined,
        priority: values.priority ?? 0,
        status: values.status,
        remark: values.remark || undefined,
      };
      const res = editing
        ? await request.put<PaymentFeeRule>(`/api/payment/fee-rules/${editing.id}`, payload)
        : await request.post<PaymentFeeRule>('/api/payment/fee-rules', payload);
      if (res.code === 0) { Toast.success(editing ? '更新成功' : '创建成功'); closeModal(); void fetchList(); }
      else throw new Error(res.message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleToggle(record: PaymentFeeRule, checked: boolean) {
    setTogglingIds((prev) => new Set(prev).add(record.id));
    request
      .put<PaymentFeeRule>(`/api/payment/fee-rules/${record.id}`, { status: checked ? 'enabled' : 'disabled' })
      .then((res) => { if (res.code === 0) { Toast.success(checked ? '已启用' : '已停用'); void fetchList(); } })
      .finally(() => setTogglingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; }));
  }

  async function handleDelete(id: number) {
    const res = await request.delete(`/api/payment/fee-rules/${id}`);
    if (res.code === 0) { Toast.success('删除成功'); void fetchList(); }
  }

  const columns: ColumnProps<PaymentFeeRule>[] = [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={v === 'wechat' ? 'green' : 'blue'}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '支付方式', dataIndex: 'payMethod', width: 130, render: (v: PaymentMethod | null) => (v ? PAYMENT_METHOD_LABELS[v] : '全部') },
    { title: '费率', dataIndex: 'rateBps', width: 90, render: (v: number) => `${(v / 100).toFixed(2)}%` },
    { title: '固定费', dataIndex: 'fixedFee', width: 100, render: (v: number) => yuan(v) },
    { title: '限额(低/高)', dataIndex: 'minFee', width: 150, render: (_: unknown, r: PaymentFeeRule) => `${yuan(r.minFee)} / ${yuan(r.maxFee)}` },
    { title: '优先级', dataIndex: 'priority', width: 80 },
    createdAtColumn as ColumnProps<PaymentFeeRule>,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, r: PaymentFeeRule) => (
        <Switch checked={r.status === 'enabled'} loading={togglingIds.has(r.id)} disabled={!hasPermission('payment:fee:update')} size="small" onChange={(c) => handleToggle(r, c)} />
      ),
    },
    {
      title: '操作', fixed: 'right', width: 120,
      render: (_: unknown, r: PaymentFeeRule) => (
        <Space>
          {hasPermission('payment:fee:update') && <Button theme="borderless" size="small" onClick={() => openEdit(r)}>编辑</Button>}
          {hasPermission('payment:fee:delete') && (
            <Popconfirm title="确定要删除吗？" content="删除后不可恢复" onConfirm={() => handleDelete(r.id)}>
              <Button theme="borderless" type="danger" size="small">删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Select placeholder="全部渠道" value={search.channel || undefined} onChange={(v) => setSearch((p) => ({ ...p, channel: (v as string) ?? '' }))} showClear style={{ width: 130 }} optionList={channelOptions} />
        <Select placeholder="全部状态" value={search.status || undefined} onChange={(v) => setSearch((p) => ({ ...p, status: (v as string) ?? '' }))} showClear style={{ width: 120 }}
          optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('payment:fee:create') && <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>}
      </SearchToolbar>

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
      />

      <AppModal title={editing ? '编辑费率规则' : '新增费率规则'} visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: submitting }} width={700} closeOnEsc>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInit} labelPosition="left" labelWidth={124}>
            <Form.Input field="name" label="名称" placeholder="如：微信标准费率" rules={[{ required: true, message: '名称不能为空' }]} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
              <Form.Select field="channel" label="渠道" style={{ width: '100%' }} optionList={channelOptions} rules={[{ required: true, message: '请选择渠道' }]} />
              <Form.Select field="payMethod" label="支付方式" style={{ width: '100%' }} optionList={methodOptions} showClear placeholder="留空=全部方式" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
              <Form.InputNumber field="ratePercent" label="费率(%)" min={0} max={100} step={0.01} precision={2} style={{ width: '100%' }} suffix="%" />
              <Form.InputNumber field="fixedYuan" label="固定费(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
              <Form.InputNumber field="minYuan" label="最低手续费(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
              <Form.InputNumber field="maxYuan" label="最高手续费(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
              <Form.InputNumber field="priority" label="优先级" min={0} max={9999} step={1} precision={0} style={{ width: '100%' }} extraText="数值越大越优先匹配" />
              <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
            </div>
            <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
