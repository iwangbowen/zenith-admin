import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, InputNumber, Select, Space, Form, Toast, Tag } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw, WalletCards, Undo2 } from 'lucide-react';
import type { MemberWalletTransaction, PaginatedResponse } from '@zenith/shared';
import { WALLET_TX_TYPE_LABELS } from '@zenith/shared';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';

const typeOptions = (Object.keys(WALLET_TX_TYPE_LABELS) as (keyof typeof WALLET_TX_TYPE_LABELS)[]).map((v) => ({ value: v, label: WALLET_TX_TYPE_LABELS[v] }));
const TYPE_COLORS: Record<string, string> = { recharge: 'green', consume: 'orange', refund: 'cyan', adjust: 'blue' };
const yuan = (fen: number) => (fen / 100).toFixed(2);

interface SearchParams { memberKeyword?: string; type?: string }

export default function MemberWalletPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<MemberWalletTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [search, setSearch] = useState<SearchParams>({});
  const searchRef = useRef<SearchParams>({});
  searchRef.current = search;
  const [modalVisible, setModalVisible] = useState(false);
  const [mode, setMode] = useState<'adjust' | 'refund'>('adjust');

  const fetchData = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const ap = params ?? searchRef.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({
        page: String(p), pageSize: String(ps),
        ...(ap.memberKeyword ? { memberKeyword: ap.memberKeyword } : {}),
        ...(ap.type ? { type: ap.type } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<MemberWalletTransaction>>(`/api/member-wallets/transactions?${q}`);
      if (res.code === 0) { setData(res.data.list); setTotal(res.data.total); }
    } finally { setLoading(false); }
  }, [page, pageSize]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleSearch = () => { setPage(1); void fetchData(1, pageSize); };
  const handleReset = () => { setSearch({}); setPage(1); void fetchData(1, pageSize, {}); };

  const openModal = (m: 'adjust' | 'refund') => { setMode(m); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: { memberId: number; amount: number; remark?: string };
    try { values = (await formApi.current?.validate()) as { memberId: number; amount: number; remark?: string }; } catch { throw new Error('validation'); }
    const payload = { memberId: values.memberId, amount: Math.round(values.amount * 100), remark: values.remark };
    const url = mode === 'adjust' ? '/api/member-wallets/adjust' : '/api/member-wallets/refund';
    const res = await request.post(url, payload);
    if (res.code === 0) { Toast.success(mode === 'adjust' ? '已调整' : '已退款'); setModalVisible(false); void fetchData(); }
    else throw new Error(res.message);
  };

  const columns: ColumnProps<MemberWalletTransaction>[] = [
    { title: '会员', dataIndex: 'memberName', width: 140, render: (v?: string, r?: MemberWalletTransaction) => v || `#${r?.memberId}` },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => <Tag color={TYPE_COLORS[v] as 'green'}>{WALLET_TX_TYPE_LABELS[v as keyof typeof WALLET_TX_TYPE_LABELS]}</Tag> },
    { title: '变动(元)', dataIndex: 'amount', width: 110, render: (v: number) => <span style={{ color: v >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)' }}>{v >= 0 ? `+${yuan(v)}` : yuan(v)}</span> },
    { title: '变动后(元)', dataIndex: 'balanceAfter', width: 110, render: (v: number) => yuan(v) },
    { title: '业务类型', dataIndex: 'bizType', width: 130, render: (v: string | null) => v || '-' },
    { title: '备注', dataIndex: 'remark', width: 200, render: renderEllipsis },
    createdAtColumn,
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input placeholder="会员ID/昵称" value={search.memberKeyword} showClear style={{ width: 160 }}
          onChange={(v) => setSearch((p) => ({ ...p, memberKeyword: v || undefined }))} />
        <Select placeholder="全部类型" value={search.type} style={{ width: 130 }} showClear
          onChange={(v) => setSearch((p) => ({ ...p, type: v as string | undefined }))} optionList={typeOptions} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('member:wallet:adjust') && <Button type="primary" icon={<WalletCards size={14} />} onClick={() => openModal('adjust')}>调整余额</Button>}
        {hasPermission('member:wallet:refund') && <Button type="primary" icon={<Undo2 size={14} />} onClick={() => openModal('refund')}>退款</Button>}
      </SearchToolbar>

      <ConfigurableTable bordered columns={columns} dataSource={data} loading={loading}
        onRefresh={fetchData} refreshLoading={loading} rowKey="id" size="small"
        pagination={buildPagination(total, fetchData)} empty="暂无钱包流水" />

      <AppModal title={mode === 'adjust' ? '调整会员余额' : '会员钱包退款'} visible={modalVisible} width={480}
        onCancel={() => setModalVisible(false)} onOk={handleSubmit}>
        <Form key={mode} getFormApi={(api) => { formApi.current = api; }} labelPosition="left" labelWidth={90}>
          <Form.InputNumber field="memberId" label="会员ID" min={1} style={{ width: '100%' }} rules={[{ required: true, message: '请输入会员ID' }]} />
          <Form.InputNumber field="amount" label="金额(元)" style={{ width: '100%' }}
            placeholder={mode === 'adjust' ? '正数增加，负数扣减' : '退款金额（元）'}
            min={mode === 'refund' ? 0.01 : undefined} precision={2}
            rules={[{ required: true, message: '请输入金额' }]} />
          <Form.TextArea field="remark" label="备注" placeholder={mode === 'adjust' ? '调整原因' : '退款原因'} maxCount={256} />
        </Form>
      </AppModal>
    </div>
  );
}
