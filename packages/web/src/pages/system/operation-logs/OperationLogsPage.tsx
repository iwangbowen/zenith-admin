import React, { useState, useEffect } from 'react';
import { Table, Card, Input, Button, Tag, Space, DatePicker } from '@douyinfe/semi-ui';
import { Search, RotateCcw } from 'lucide-react';
import { request } from '../../../utils/request';
import { formatDateTime } from '../../../utils/date';
import type { OperationLog, PaginatedResponse } from '@zenith/shared';

interface SearchParams {
  username: string;
  module: string;
  description: string;
  timeRange: [Date, Date] | null;
}

const defaultParams: SearchParams = { username: '', module: '', description: '', timeRange: null };

export default function OperationLogsPage() {
  const [data, setData] = useState<OperationLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultParams);

  const fetchData = async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.username ? { username: params.username } : {}),
        ...(params.module ? { module: params.module } : {}),
        ...(params.description ? { description: params.description } : {}),
        ...(params.timeRange ? { startTime: params.timeRange[0].toISOString(), endTime: params.timeRange[1].toISOString() } : {}),
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
  };

  useEffect(() => {
    fetchData();
  }, []);

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
    { title: 'ID', dataIndex: 'id', width: 70 },
    { title: '操作人', dataIndex: 'username', width: 110, render: (v: string | null) => v ?? '-' },
    { title: '功能模块', dataIndex: 'module', width: 120, render: (v: string | null) => v ?? '-' },
    { title: '操作描述', dataIndex: 'description', width: 140 },
    { title: '请求方法', dataIndex: 'method', width: 90, render: (v: string) => <Tag color="blue">{v}</Tag> },
    { title: '请求路径', dataIndex: 'path', width: 180, ellipsis: true },
    { title: 'IP 地址', dataIndex: 'ip', width: 130, render: (v: string | null) => v ?? '-' },
    { title: '操作系统', dataIndex: 'os', width: 130, render: (v: string | null) => v ?? '-' },
    { title: '浏览器', dataIndex: 'browser', width: 150, render: (v: string | null) => v ?? '-' },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 90,
      render: (v: number | null) => v === null ? '-' : `${v} ms`,
    },
    {
      title: '状态',
      dataIndex: 'responseCode',
      width: 90,
      render: (v: number | null) => {
        const success = v != null && v >= 200 && v < 400;
        return <Tag color={success ? 'green' : 'red'}>{success ? '成功' : '失败'}</Tag>;
      },
    },
    {
      title: '操作时间',
      dataIndex: 'createdAt',
      width: 180,
      render: (v: string) => formatDateTime(v),
      fixed: 'right' as const,
    },
  ];

  return (
    <div className="page-container">
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
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
          <DatePicker
            type="dateTimeRange"
            placeholder={['开始时间', '结束时间']}
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
        </Space>
      </Card>

      <Card>
        <Table
          columns={columns}
          dataSource={data}
          loading={loading}
          scroll={{ x: 1600 }}
          pagination={{
            currentPage: page,
            pageSize,
            total,
            onPageChange: (c) => { void fetchData(c, pageSize); },
            onPageSizeChange: (s) => { void fetchData(1, s); },
          }}
        />
      </Card>
    </div>
  );
}
