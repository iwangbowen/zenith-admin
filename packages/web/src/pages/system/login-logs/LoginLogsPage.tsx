import React, { useState, useEffect } from 'react';
import { Table, Card, Input, Button, Form, Tag } from '@douyinfe/semi-ui';
import { Search } from 'lucide-react';
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

  const fetchData = async (p = page, ps = pageSize) => {
    setLoading(true);
    try {
      const res = await request.get<PaginatedResponse<LoginLog>>('/api/login-logs', {
        params: { page: p, pageSize: ps, ...searchParams }
      });
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
    <div style={{ padding: 24 }}>
      <Card style={{ marginBottom: 16 }}>
        <Form layout="horizontal" labelPosition="left">
          <Form.Input 
            field="username" 
            label="用户名" 
            placeholder="请输入用户名" 
            value={searchParams.username}
            onChange={(v) => setSearchParams({ ...searchParams, username: v })}
          />
          <Form.Select 
            field="status" 
            label="状态" 
            placeholder="请选择状态" 
            value={searchParams.status}
            onChange={(v) => setSearchParams({ ...searchParams, status: v as string })}
            style={{ width: 150 }}
          >
            <Form.Select.Option value="">全部</Form.Select.Option>
            <Form.Select.Option value="success">成功</Form.Select.Option>
            <Form.Select.Option value="fail">失败</Form.Select.Option>
          </Form.Select>
          <Button theme="solid" icon={<Search size={16} />} onClick={handleSearch} style={{ marginLeft: 16 }}>
            查询
          </Button>
        </Form>
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
