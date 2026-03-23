import React, { useState, useEffect } from 'react';
import { Table, Card, Input, Button, Tag, Select, Space } from '@douyinfe/semi-ui';
import { Search, RotateCcw } from 'lucide-react';
import { request } from '../../../utils/request';
import { formatDateTime } from '../../../utils/date';
import type { LoginLog, PaginatedResponse } from '@zenith/shared';

export default function LoginLogsPage() {
  const [data, setData] = useState<LoginLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [searchParams, setSearchParams] = useState({ username: '', status: '' });

  const fetchData = async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(p), pageSize: String(ps), ...(params.username ? { username: params.username } : {}), ...(params.status ? { status: params.status } : {}) }).toString();
      const res = await request.get<PaginatedResponse<LoginLog>>(`/api/login-logs?${query}`);
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
    setSearchParams({ username: '', status: '' });
    setPage(1);
    fetchData(1, pageSize, { username: '', status: '' });
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
  ];

  return (
    <div className="page-container">
      <Card>
        <Space>
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
            value={searchParams.status}
            onChange={(v) => setSearchParams({ ...searchParams, status: v as string })}
            style={{ width: 150 }}
          >
            <Select.Option value="">全部</Select.Option>
            <Select.Option value="success">成功</Select.Option>
            <Select.Option value="fail">失败</Select.Option>
          </Select>
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
          pagination={{
            currentPage: page,
            pageSize,
            total,
            onPageChange: (c) => fetchData(c, pageSize),
            onPageSizeChange: (s) => fetchData(1, s)
          }}
        />
      </Card>
    </div>
  );
}
