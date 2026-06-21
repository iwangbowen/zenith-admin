import { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Input, Select, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import type { PaginatedResponse, PaymentOutboxEvent } from '@zenith/shared';

const EVENT_STATUS_LABELS = { pending: '待处理', done: '已完成', failed: '失败' } as const satisfies Record<PaymentOutboxEvent['status'], string>;
const EVENT_STATUS_COLOR = { pending: 'blue', done: 'green', failed: 'red' } as const satisfies Record<PaymentOutboxEvent['status'], string>;

interface SearchParams { keyword: string; status: string; type: string; }
const defaultSearch: SearchParams = { keyword: '', status: '', type: '' };

export default function PaymentEventsPage() {
  const { hasPermission } = usePermission();
  const [data, setData] = useState<PaginatedResponse<PaymentOutboxEvent> | null>(null);
  const [loading, setLoading] = useState(false);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = searchParams;
  const [redispatchingIds, setRedispatchingIds] = useState<Set<number>>(new Set());

  const fetchList = useCallback(
    async (p = page, ps = pageSize, params?: SearchParams) => {
      const active = params ?? searchRef.current;
      setLoading(true);
      try {
        const query: Record<string, string> = { page: String(p), pageSize: String(ps) };
        if (active.keyword) query.keyword = active.keyword;
        if (active.status) query.status = active.status;
        if (active.type) query.type = active.type;
        const res = await request.get<PaginatedResponse<PaymentOutboxEvent>>(`/api/payment/ops/events?${new URLSearchParams(query)}`);
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
  function handleReset() { setSearchParams(defaultSearch); setPage(1); void fetchList(1, pageSize, defaultSearch); }

  function handleRedispatch(record: PaymentOutboxEvent) {
    setRedispatchingIds((prev) => new Set(prev).add(record.id));
    request
      .post<PaymentOutboxEvent>(`/api/payment/ops/events/${record.id}/redispatch`, {})
      .then((res) => {
        if (res.code === 0) {
          Toast.success('重投成功');
          void fetchList();
        } else {
          Toast.error(`重投失败：${res.message}`);
        }
      })
      .finally(() => setRedispatchingIds((prev) => { const s = new Set(prev); s.delete(record.id); return s; }));
  }

  const columns: ColumnProps<PaymentOutboxEvent>[] = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '事件类型', dataIndex: 'type', width: 180 },
    { title: '订单号', dataIndex: 'orderNo', width: 200 },
    { title: '次数', dataIndex: 'attempts', width: 80 },
    { title: '错误信息', dataIndex: 'lastError', width: 260, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 240 }}>{v || '-'}</Typography.Text> },
    { title: '创建时间', dataIndex: 'createdAt', width: 170, render: (t: string) => formatDateTime(t) },
    { title: '处理时间', dataIndex: 'processedAt', width: 170, render: (t: string | null) => (t ? formatDateTime(t) : '-') },
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentOutboxEvent['status']) => <Tag color={EVENT_STATUS_COLOR[v]}>{EVENT_STATUS_LABELS[v]}</Tag> },
    {
      title: '操作', fixed: 'right', width: 90,
      render: (_: unknown, r: PaymentOutboxEvent) => (
        <Space>
          {r.status !== 'done' && hasPermission('payment:ops:manage') && (
            <Button theme="borderless" size="small" loading={redispatchingIds.has(r.id)} onClick={() => handleRedispatch(r)}>重投</Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input prefix={<Search size={14} />} placeholder="订单号..." value={searchParams.keyword} onChange={(v) => setSearchParams((p) => ({ ...p, keyword: v }))} showClear style={{ width: 200 }} onEnterPress={handleSearch} />
        <Select placeholder="全部状态" value={searchParams.status || undefined} onChange={(v) => setSearchParams((p) => ({ ...p, status: (v as string) ?? '' }))} showClear style={{ width: 120 }}
          optionList={Object.entries(EVENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))} />
        <Input prefix={<Search size={14} />} placeholder="事件类型..." value={searchParams.type} onChange={(v) => setSearchParams((p) => ({ ...p, type: v }))} showClear style={{ width: 180 }} onEnterPress={handleSearch} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
      </SearchToolbar>

      <ConfigurableTable
        bordered columns={columns} dataSource={data?.list ?? []} loading={loading} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void fetchList()} refreshLoading={loading} pagination={buildPagination(data?.total ?? 0, fetchList)}
      />
    </div>
  );
}

