import { useState, useEffect, useCallback } from 'react';
import { Input, Button, DatePicker, Select, Tabs, TabPane, InputNumber } from '@douyinfe/semi-ui';
import { Search, RotateCcw, Download } from 'lucide-react';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { OperationLogsTable } from '@/components/logs/OperationLogsTable';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTimeForApi } from '@/utils/date';
import type { OperationLog, PaginatedResponse } from '@zenith/shared';
import OperationLogStatsPanel from './OperationLogStatsPanel';

interface SearchParams {
  username: string;
  module: string;
  description: string;
  method: string;
  path: string;
  ip: string;
  status: string;
  timeRange: [Date, Date] | null;
  minDurationMs: number | null;
  maxDurationMs: number | null;
}

const defaultParams: SearchParams = { username: '', module: '', description: '', method: '', path: '', ip: '', status: '', timeRange: null, minDurationMs: null, maxDurationMs: null };

export default function OperationLogsPage() {
  const [activeTab, setActiveTab] = useState<'list' | 'stats'>('list');
  const [data, setData] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const { page, pageSize, setPage, setPageSize, buildPagination } = usePagination();
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultParams);

  const fetchData = useCallback(async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.username ? { username: params.username } : {}),
        ...(params.module ? { module: params.module } : {}),
        ...(params.description ? { description: params.description } : {}),
        ...(params.ip ? { ip: params.ip } : {}),
        ...(params.method ? { method: params.method } : {}),
        ...(params.path ? { path: params.path } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.timeRange ? { startTime: formatDateTimeForApi(params.timeRange[0]), endTime: formatDateTimeForApi(params.timeRange[1]) } : {}),
        ...(params.minDurationMs === null ? {} : { minDurationMs: String(params.minDurationMs) }),
        ...(params.maxDurationMs === null ? {} : { maxDurationMs: String(params.maxDurationMs) }),
      }).toString();
      const res = await request.get<PaginatedResponse<OperationLog>>(`/api/operation-logs?${query}`);
      setData(res.data.list);
      setTotal(res.data.total);
      setPage(res.data.page);
      setPageSize(res.data.pageSize);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'list' | 'stats')}
        type="line"
        style={{ marginBottom: 0 }}
      >
        <TabPane tab="日志列表" itemKey="list" />
        <TabPane tab="统计分析" itemKey="stats" />
      </Tabs>
      {activeTab === 'list' && (
        <>
          <SearchToolbar>
              <Input
                prefix={<Search size={14} />}
                placeholder="请输入操作人"
                value={searchParams.username}
                onChange={(v) => setSearchParams({ ...searchParams, username: v })}
                onEnterPress={handleSearch}
                style={{ width: 160 }}
                showClear
              />
              <Input
                prefix={<Search size={14} />}
                placeholder="请输入功能模块"
                value={searchParams.module}
                onChange={(v) => setSearchParams({ ...searchParams, module: v })}
                onEnterPress={handleSearch}
                style={{ width: 160 }}
                showClear
              />
              <Input
                prefix={<Search size={14} />}
                placeholder="请输入操作描述"
                value={searchParams.description}
                onChange={(v) => setSearchParams({ ...searchParams, description: v })}
                onEnterPress={handleSearch}
                style={{ width: 160 }}
                showClear
              />
              <Select
                placeholder="请求方法"
                value={searchParams.method || undefined}
                onChange={(v) => setSearchParams({ ...searchParams, method: v as string })}
                style={{ width: 130 }}
                showClear
              >
                <Select.Option value="GET">GET</Select.Option>
                <Select.Option value="POST">POST</Select.Option>
                <Select.Option value="PUT">PUT</Select.Option>
                <Select.Option value="PATCH">PATCH</Select.Option>
                <Select.Option value="DELETE">DELETE</Select.Option>
              </Select>
              <Input
                prefix={<Search size={14} />}
                placeholder="请输入请求路径"
                value={searchParams.path}
                onChange={(v) => setSearchParams({ ...searchParams, path: v })}
                onEnterPress={handleSearch}
                style={{ width: 180 }}
                showClear
              />
              <Input
                prefix={<Search size={14} />}
                placeholder="请输入 IP 地址"
                value={searchParams.ip}
                onChange={(v) => setSearchParams({ ...searchParams, ip: v })}
                onEnterPress={handleSearch}
                style={{ width: 160 }}
                showClear
              />
              <Select
                placeholder="操作状态"
                value={searchParams.status || undefined}
                onChange={(v) => setSearchParams({ ...searchParams, status: v as string })}
                style={{ width: 130 }}
                showClear
              >
                <Select.Option value="success">成功</Select.Option>
                <Select.Option value="fail">失败</Select.Option>
              </Select>
              <DatePicker
                type="dateTimeRange"
                placeholder={['开始时间', '结束时间']}
                value={searchParams.timeRange ?? undefined}
                onChange={(v) => setSearchParams({ ...searchParams, timeRange: v ? (v as [Date, Date]) : null })}
                style={{ width: 360 }}
              />
              <InputNumber
                placeholder="耗时 ≥ (ms)"
                value={searchParams.minDurationMs ?? undefined}
                onChange={(v) => setSearchParams({ ...searchParams, minDurationMs: v !== '' && v != null ? Number(v) : null })}
                min={0}
                style={{ width: 130 }}
                hideButtons
              />
              <InputNumber
                placeholder="耗时 ≤ (ms)"
                value={searchParams.maxDurationMs ?? undefined}
                onChange={(v) => setSearchParams({ ...searchParams, maxDurationMs: v !== '' && v != null ? Number(v) : null })}
                min={0}
                style={{ width: 130 }}
                hideButtons
              />
              <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>
                查询
              </Button>
              <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>
                重置
              </Button>
              <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/operation-logs/export', '操作日志.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
          </SearchToolbar>

          <OperationLogsTable
            dataSource={data}
            loading={loading}
            onRefresh={() => void fetchData()}
            scroll={{ x: 1600 }}
            pagination={buildPagination(total, fetchData)}
          />
        </>
      )}
      {activeTab === 'stats' && (
        <div style={{ paddingTop: 16 }}>
          <OperationLogStatsPanel />
        </div>
      )}
    </div>
  );
}
