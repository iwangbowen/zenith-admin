import { useState, useEffect, useCallback } from 'react';
import { Table, Button, Space, Tag, Select, Popconfirm, Toast, Modal, Form } from '@douyinfe/semi-ui';
import { Search, RotateCcw, Plus } from 'lucide-react';
import type { DbBackup, BackupType, BackupStatus } from '@zenith/shared';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';

export default function DbBackupsPage() {
  const [list, setList] = useState<DbBackup[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [filterType, setFilterType] = useState<string>('');
  const [createVisible, setCreateVisible] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const { hasPermission } = usePermission();

  const fetchList = useCallback(async (p = page) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
    if (filterStatus) params.set('status', filterStatus);
    if (filterType) params.set('type', filterType);
    const res = await request.get<{ list: DbBackup[]; total: number }>(`/api/db-backups?${params}`);
    setLoading(false);
    if (res.code === 0 && res.data) {
      setList(res.data.list);
      setTotal(res.data.total);
      setPage(p);
    }
  }, [page, pageSize, filterStatus, filterType]);

  useEffect(() => { fetchList(1); }, [filterStatus, filterType]);

  const handleSearch = () => fetchList(1);
  const handleReset = () => { setFilterStatus(''); setFilterType(''); };

  const handleCreate = async (values: { type: BackupType; name?: string }) => {
    setCreateLoading(true);
    const res = await request.post('/api/db-backups', values);
    setCreateLoading(false);
    if (res.code === 0) {
      Toast.success('备份任务已创建');
      setCreateVisible(false);
      fetchList(1);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/db-backups/${id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      fetchList();
    }
  };

  const handleDownload = async (record: DbBackup) => {
    if (!record.fileId) {
      Toast.warning('该备份没有关联文件');
      return;
    }
    const name = record.name || `backup-${record.id}`;
    await request.download(`/api/files/${record.fileId}/content`, name);
  };

  const statusColorMap: Record<BackupStatus, 'grey' | 'blue' | 'green' | 'red'> = {
    pending: 'grey',
    running: 'blue',
    success: 'green',
    failed: 'red',
  };
  const statusLabelMap: Record<BackupStatus, string> = {
    pending: '等待中',
    running: '执行中',
    success: '成功',
    failed: '失败',
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', width: 260 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      render: (v: BackupType) => <Tag size="small">{v === 'pg_dump' ? 'pg_dump' : 'Drizzle 导出'}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v: BackupStatus) => <Tag color={statusColorMap[v]} size="small">{statusLabelMap[v]}</Tag>,
    },
    {
      title: '文件大小',
      dataIndex: 'fileSize',
      width: 100,
      render: (v: number | null) => v ? `${(v / 1024).toFixed(1)} KB` : '-',
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 80,
      render: (v: number | null) => v ? `${(v / 1000).toFixed(1)}s` : '-',
    },
    { title: '创建者', dataIndex: 'createdByName', width: 100, render: (v: string | null) => v || '-' },
    { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (v: string) => formatDateTime(v) },
    {
      title: '操作',
      fixed: 'right' as const,
      width: 120,
      render: (_: unknown, record: DbBackup) => (
        <Space>
          {record.fileId && record.status === 'success' && (
            <Button theme="borderless" size="small" onClick={() => handleDownload(record)}>下载</Button>
          )}
          {hasPermission('system:db-backup:delete') && (
            <Popconfirm title="确定要删除吗？" onConfirm={() => handleDelete(record.id)}>
              <Button theme="borderless" type="danger" size="small">删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <div className="search-area">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Select
              placeholder="备份类型"
              value={filterType}
              onChange={(v) => setFilterType(v as string)}
              optionList={[
                { label: '全部类型', value: '' },
                { label: 'pg_dump', value: 'pg_dump' },
                { label: 'Drizzle 导出', value: 'drizzle_export' },
              ]}
              style={{ width: 150 }}
              showClear
            />
            <Select
              placeholder="状态"
              value={filterStatus}
              onChange={(v) => setFilterStatus(v as string)}
              optionList={[
                { label: '全部状态', value: '' },
                { label: '等待中', value: 'pending' },
                { label: '执行中', value: 'running' },
                { label: '成功', value: 'success' },
                { label: '失败', value: 'failed' },
              ]}
              style={{ width: 130 }}
              showClear
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          </Space>
          <Space>
            {hasPermission('system:db-backup:create') && (
              <Button type="secondary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>新增备份</Button>
            )}
          </Space>
        </div>
      </div>

      <Table
        bordered
        loading={loading}
        dataSource={list}
        columns={columns}
        rowKey="id"
        pagination={{
          total,
          currentPage: page,
          pageSize,
          onPageChange: (p) => fetchList(p),
        }}
      />

      <Modal
        title="创建备份"
        visible={createVisible}
        onCancel={() => setCreateVisible(false)}
        footer={null}
      >
        <Form onSubmit={handleCreate} labelPosition="left" labelWidth={80}>
          <Form.Select
            field="type"
            label="备份类型"
            initValue="pg_dump"
            rules={[{ required: true, message: '请选择备份类型' }]}
            optionList={[
              { label: 'pg_dump (完整 SQL)', value: 'pg_dump' },
              { label: 'Drizzle 逻辑导出 (JSON)', value: 'drizzle_export' },
            ]}
            style={{ width: '100%' }}
          />
          <Form.Input field="name" label="备份名称" placeholder="可选，默认自动生成" style={{ width: '100%' }} />
          <Form.Slot>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button onClick={() => setCreateVisible(false)}>取消</Button>
              <Button htmlType="submit" type="primary" loading={createLoading}>确定</Button>
            </div>
          </Form.Slot>
        </Form>
      </Modal>
    </div>
  );
}
