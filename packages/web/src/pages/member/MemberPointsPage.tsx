import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Input, InputNumber, Select, Space, Form, Toast, Tag } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw, Coins } from 'lucide-react';
import type { MemberPointTransaction, PaginatedResponse } from '@zenith/shared';
import { POINT_TX_TYPE_LABELS } from '@zenith/shared';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';

const typeOptions = (Object.keys(POINT_TX_TYPE_LABELS) as (keyof typeof POINT_TX_TYPE_LABELS)[]).map((v) => ({ value: v, label: POINT_TX_TYPE_LABELS[v] }));
const TYPE_COLORS: Record<string, string> = { earn: 'green', redeem: 'orange', expire: 'grey', adjust: 'blue', refund: 'cyan' };

interface SearchParams { memberKeyword?: string; type?: string }

export default function MemberPointsPage() {
  const { hasPermission } = usePermission();
  const adjustFormApi = useRef<FormApi | null>(null);
  const [data, setData] = useState<MemberPointTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [search, setSearch] = useState<SearchParams>({});
  const searchRef = useRef<SearchParams>({});
  searchRef.current = search;
  const [adjustVisible, setAdjustVisible] = useState(false);

  const fetchData = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const ap = params ?? searchRef.current;
    setLoading(true);
    try {
      const q = new URLSearchParams({
        page: String(p), pageSize: String(ps),
        ...(ap.memberKeyword ? { memberKeyword: ap.memberKeyword } : {}),
        ...(ap.type ? { type: ap.type } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<MemberPointTransaction>>(`/api/member-points/transactions?${q}`);
      if (res.code === 0) { setData(res.data.list); setTotal(res.data.total); }
    } finally { setLoading(false); }
  }, [page, pageSize]);

  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleSearch = () => { setPage(1); void fetchData(1, pageSize); };
  const handleReset = () => { setSearch({}); setPage(1); void fetchData(1, pageSize, {}); };

  const handleAdjust = async () => {
    let values;
    try { values = await adjustFormApi.current?.validate(); } catch { throw new Error('validation'); }
    const res = await request.post('/api/member-points/adjust', values);
    if (res.code === 0) { Toast.success('调整成功'); setAdjustVisible(false); void fetchData(); }
    else throw new Error(res.message);
  };

  const columns: ColumnProps<MemberPointTransaction>[] = [
    { title: '会员', dataIndex: 'memberName', width: 140, render: (v?: string, r?: MemberPointTransaction) => v || `#${r?.memberId}` },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => <Tag color={TYPE_COLORS[v] as 'green'}>{POINT_TX_TYPE_LABELS[v as keyof typeof POINT_TX_TYPE_LABELS]}</Tag> },
    { title: '变动', dataIndex: 'amount', width: 100, render: (v: number) => <span style={{ color: v >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)' }}>{v >= 0 ? `+${v}` : v}</span> },
    { title: '变动后', dataIndex: 'balanceAfter', width: 100 },
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
        {hasPermission('member:point:adjust') && <Button type="primary" icon={<Coins size={14} />} onClick={() => setAdjustVisible(true)}>调整积分</Button>}
      </SearchToolbar>

      <ConfigurableTable bordered columns={columns} dataSource={data} loading={loading}
        onRefresh={fetchData} refreshLoading={loading} rowKey="id" size="small"
        pagination={buildPagination(total, fetchData)} empty="暂无积分流水" />

      <AppModal title="调整会员积分" visible={adjustVisible} width={480} onCancel={() => setAdjustVisible(false)} onOk={handleAdjust}>
        <Form getFormApi={(api) => { adjustFormApi.current = api; }} labelPosition="left" labelWidth={90}>
          <Form.InputNumber field="memberId" label="会员ID" min={1} style={{ width: '100%' }} rules={[{ required: true, message: '请输入会员ID' }]} />
          <Form.InputNumber field="delta" label="变动量" style={{ width: '100%' }} placeholder="正数增加，负数扣减"
            rules={[{ required: true, message: '请输入变动量' }]} />
          <Form.TextArea field="remark" label="备注" placeholder="调整原因" maxCount={256} />
        </Form>
      </AppModal>
    </div>
  );
}
