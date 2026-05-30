import { useState, useEffect, useCallback, useTransition} from 'react';
import { Input, Button, Select, DatePicker } from '@douyinfe/semi-ui';
import { Search, RotateCcw, Download } from 'lucide-react';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { LoginLogsTable } from '@/components/logs/LoginLogsTable';
import { formatDateTimeForApi } from '@/utils/date';
import type { LoginLog, PaginatedResponse } from '@zenith/shared';

export default function LoginLogsPage() {
  interface SearchParams {
    username: string;
    status: string;
    timeRange: [Date, Date] | null;
  }

  const defaultParams: SearchParams = { username: '', status: '', timeRange: null };
  const [data, setData] = useState<LoginLog[]>([]);
  const [isPending, startTransition] = useTransition();
  const [exportLoading, setExportLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [searchParams, setSearchParams] = useState<SearchParams>(defaultParams);

  const fetchData = useCallback((p = page, ps = pageSize, params = searchParams) => {
    startTransition(async () => {
      try {
        const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.username ? { username: params.username } : {}),
        ...(params.status ? { status: params.status } : {}),
      });
      if (params.timeRange) {
        query.set('startTime', formatDateTimeForApi(params.timeRange[0]));
        query.set('endTime', formatDateTimeForApi(params.timeRange[1]));
      }
      const res = await request.get<PaginatedResponse<LoginLog>>(`/api/login-logs?${query.toString()}`);
      setData(res.data.list);
      setTotal(res.data.total);
      setPage(res.data.page);
      setPageSize(res.data.pageSize);
    } catch (error) {
      console.error(error);
    }
    });
  }, [page, pageSize, searchParams]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = () => {
    setPage(1);
    fetchData(1, pageSize);
  };

  const handleReset = () => {
    setSearchParams(defaultParams);
    setPage(1);
    fetchData(1, pageSize, defaultParams);
  };

  return (
    <div className="page-container">
      <SearchToolbar>
          <Input
            prefix={<Search size={14} />}
            placeholder="请输入用户名"
            value={searchParams.username}
            onChange={(v) => setSearchParams({ ...searchParams, username: v })}
            onEnterPress={handleSearch}
            style={{ width: 180 }}
            showClear
          />
          <Select
            placeholder="请选择状态"
            value={searchParams.status || undefined}
            onChange={(v) => setSearchParams({ ...searchParams, status: v as string })}
            style={{ width: 150 }}
          >
            <Select.Option value="">全部</Select.Option>
            <Select.Option value="success">成功</Select.Option>
            <Select.Option value="fail">失败</Select.Option>
          </Select>
          <DatePicker
            type="dateTimeRange"
            placeholder={["开始时间", "结束时间"]}
            value={searchParams.timeRange ?? undefined}
            onChange={(v) => setSearchParams({ ...searchParams, timeRange: v ? (v as [Date, Date]) : null })}
            style={{ width: 360 }}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
            查询
          </Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>
            重置
          </Button>
          <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/login-logs/export', '登录日志.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
      </SearchToolbar>

      <LoginLogsTable
        dataSource={data}
        pending={isPending}
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: (c) => { fetchData(c, pageSize); },
          onPageSizeChange: (s) => { fetchData(1, s); },
          showSizeChanger: true,
        }}
      />
    </div>
  );
}
