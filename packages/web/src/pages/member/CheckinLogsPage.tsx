import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, DatePicker, Input } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw } from 'lucide-react';
import type { MemberCheckin, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { formatDateForApi } from '@/utils/date';

interface SearchParams {
  memberKeyword?: string;
  dateRange: [Date, Date] | null;
}

const defaultSearch: SearchParams = {
  memberKeyword: undefined,
  dateRange: null,
};

export default function CheckinLogsPage() {
  const [data, setData] = useState<MemberCheckin[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState<SearchParams>(defaultSearch);
  const searchRef = useRef<SearchParams>(defaultSearch);
  searchRef.current = search;
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const fetchData = useCallback(async (p = page, ps = pageSize, params?: SearchParams) => {
    const current = params ?? searchRef.current;
    setLoading(true);
    try {
      const [dateStart, dateEnd] = current.dateRange ?? [];
      const q = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(current.memberKeyword ? { memberKeyword: current.memberKeyword } : {}),
        ...(dateStart ? { dateStart: formatDateForApi(dateStart) } : {}),
        ...(dateEnd ? { dateEnd: formatDateForApi(dateEnd) } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<MemberCheckin>>(`/api/member-checkins?${q}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const columns: ColumnProps<MemberCheckin>[] = [
    { title: 'ID', dataIndex: 'id', width: 90 },
    { title: '会员昵称', dataIndex: 'memberNickname', width: 140, render: (value?: string | null, row?: MemberCheckin) => value || `#${row?.memberId}` },
    { title: '签到日期', dataIndex: 'checkinDate', width: 120 },
    { title: '连续天数', dataIndex: 'consecutiveDays', width: 100 },
    { title: '积分奖励', dataIndex: 'pointsAwarded', width: 100 },
    { title: '经验奖励', dataIndex: 'experienceAwarded', width: 100 },
    { title: '签到时间', dataIndex: 'createdAt', width: 180 },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          placeholder="会员ID/昵称"
          value={search.memberKeyword}
          showClear
          style={{ width: 160 }}
          onChange={(value) => setSearch((prev) => ({ ...prev, memberKeyword: value || undefined }))}
        />
        <DatePicker
          type="dateRange"
          placeholder={['开始日期', '结束日期']}
          value={search.dateRange ?? undefined}
          onChange={(value) => setSearch((prev) => ({ ...prev, dateRange: value ? (value as [Date, Date]) : null }))}
          style={{ width: 300 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={() => { setPage(1); void fetchData(1, pageSize); }}>
          查询
        </Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={() => { setSearch(defaultSearch); setPage(1); void fetchData(1, pageSize, defaultSearch); }}>
          重置
        </Button>
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        onRefresh={fetchData}
        refreshLoading={loading}
        rowKey="id"
        size="small"
        pagination={buildPagination(total, fetchData)}
        empty="暂无签到记录"
      />
    </div>
  );
}
