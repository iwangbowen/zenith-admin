import React, { useState, useEffect, useCallback } from 'react';
import { Table, Input, Button, Tag, Select, DatePicker, Modal } from '@douyinfe/semi-ui';
import { Search, RotateCcw, Download } from 'lucide-react';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import { formatDateTime } from '@/utils/date';
import type { LoginLog, PaginatedResponse } from '@zenith/shared';

export default function LoginLogsPage() {
  interface SearchParams {
    username: string;
    status: string;
    timeRange: [Date, Date] | null;
  }

  const defaultParams: SearchParams = { username: '', status: '', timeRange: null };
  const [data, setData] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [searchParams, setSearchParams] = useState<SearchParams>(defaultParams);
  const [detailLog, setDetailLog] = useState<LoginLog | null>(null);

  const fetchData = useCallback(async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.username ? { username: params.username } : {}),
        ...(params.status ? { status: params.status } : {}),
      });
      if (params.timeRange) {
        query.set('startTime', params.timeRange[0].toISOString());
        query.set('endTime', params.timeRange[1].toISOString());
      }
      const res = await request.get<PaginatedResponse<LoginLog>>(`/api/login-logs?${query.toString()}`);
      setData(res.data.list);
      setTotal(res.data.total);
      setPage(res.data.page);
      setPageSize(res.data.pageSize);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
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

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 80 },
    { title: '用户名', dataIndex: 'username', width: 120 },
    { title: '登录信息', dataIndex: 'message', width: 150 },
    { title: 'IP 地址', dataIndex: 'ip', width: 150 },
    { title: '浏览器', dataIndex: 'browser', width: 150 },
    { title: '操作系统', dataIndex: 'os', width: 150 },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: string) => (
        <Tag color={status === 'success' ? 'green' : 'red'}>
          {status === 'success' ? '成功' : '失败'}
        </Tag>
      ),
    },
    {
      title: '登录时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
    },
    {
      title: '操作',
      width: 80,
      fixed: 'right' as const,
      render: (_: unknown, record: LoginLog) => (
        <Button
          theme="borderless"
          type="primary"
          size="small"
          onClick={() => setDetailLog(record)}
        >
          详情
        </Button>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        left={<>
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
        </>}
        right={
          <Button icon={<Download size={14} />} loading={exportLoading} onClick={async () => { setExportLoading(true); try { await request.download('/api/login-logs/export', '登录日志.xlsx'); } finally { setExportLoading(false); } }}>导出</Button>
        }
      />

      <Table
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: (c) => { void fetchData(c, pageSize); },
          onPageSizeChange: (s) => { void fetchData(1, s); }
        }}
      />

      <Modal
        title="登录日志详情"
        visible={detailLog !== null}
        onCancel={() => setDetailLog(null)}
        footer={null}
        width={560}
        style={{ top: 40 }}
      >
        {detailLog && (
          <div style={{ padding: '4px 0' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
              {([
                ['ID', String(detailLog.id)],
                ['用户名', detailLog.username],
                ['状态', null],
                ['登录信息', detailLog.message ?? '-'],
                ['IP 地址', detailLog.ip ?? '-'],
                ['浏览器', detailLog.browser ?? '-'],
                ['操作系统', detailLog.os ?? '-'],
                ['登录时间', formatDateTime(detailLog.createdAt)],
              ] as const).map(([label, value]) => (
                <div key={label} style={{ padding: '8px 0', borderBottom: '1px solid var(--semi-color-border)' }}>
                  <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 13, wordBreak: 'break-all' }}>
                    {label === '状态'
                      ? <Tag color={detailLog.status === 'success' ? 'green' : 'red'} size="small">
                        {detailLog.status === 'success' ? '成功' : '失败'}
                      </Tag>
                      : value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
