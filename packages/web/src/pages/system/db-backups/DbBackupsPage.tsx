import { useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Tag, Select, Modal, Toast, Form } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import type { DbBackup, BackupType, BackupStatus } from '@zenith/shared';
import { AppModal } from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { createdAtColumn } from '../../../utils/table-columns';
import {
  dbBackupKeys,
  useCreateDbBackup,
  useDbBackupList,
  useDeleteDbBackup,
} from '@/hooks/queries/db-backups';
import { request } from '@/utils/request';

export default function DbBackupsPage() {
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<{ status: string; type: string }>({ status: '', type: '' });
  const [submittedParams, setSubmittedParams] = useState<{ status: string; type: string }>({ status: '', type: '' });
  const [createVisible, setCreateVisible] = useState(false);
  const createFormApi = useRef<FormApi | null>(null);
  const { hasPermission } = usePermission();
  const listQuery = useDbBackupList({
    page,
    pageSize,
    status: submittedParams.status || undefined,
    type: submittedParams.type || undefined,
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const createMutation = useCreateDbBackup();
  const deleteMutation = useDeleteDbBackup();

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: dbBackupKeys.lists });
  };
  const handleReset = () => {
    setPage(1);
    setDraftParams({ status: '', type: '' });
    setSubmittedParams({ status: '', type: '' });
    void queryClient.invalidateQueries({ queryKey: dbBackupKeys.lists });
  };

  const closeCreateModal = () => {
    setCreateVisible(false);
    createFormApi.current = null;
  };

  const handleCreateOk = async () => {
    if (!createFormApi.current) return;
    let values: { type: BackupType; name?: string };
    try {
      values = await createFormApi.current.validate() as { type: BackupType; name?: string };
    } catch {
      throw new Error('validation');
    }
    await createMutation.mutateAsync(values);
    Toast.success('备份任务已创建');
    closeCreateModal();
    setPage(1);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('已删除');
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
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right' as const,
      render: (v: BackupStatus) => <Tag color={statusColorMap[v]} size="small">{statusLabelMap[v]}</Tag>,
    },
    createOperationColumn<DbBackup>({
      width: 120,
      actions: (record) => [
        {
          key: 'download',
          label: '下载',
          hidden: !(record.fileId && record.status === 'success'),
          onClick: () => handleDownload(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:db-backup:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确定要删除吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Select
              placeholder="备份类型"
              value={draftParams.type}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, type: v as string }))}
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
              value={draftParams.status}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, status: v as string }))}
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
            {hasPermission('system:db-backup:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>新增备份</Button>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <Select
              placeholder="备份类型"
              value={draftParams.type}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, type: v as string }))}
              optionList={[
                { label: '全部类型', value: '' },
                { label: 'pg_dump', value: 'pg_dump' },
                { label: 'Drizzle 导出', value: 'drizzle_export' },
              ]}
              style={{ width: 150 }}
              showClear
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {hasPermission('system:db-backup:create') && (
              <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>新增备份</Button>
            )}
          </>
        )}
        mobileFilters={(
          <Select
            placeholder="状态"
            value={draftParams.status}
            onChange={(v) => setDraftParams((prev) => ({ ...prev, status: v as string }))}
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
        )}
        filterTitle="备份筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        dataSource={list}
        columns={columns}
        rowKey="id"
        pagination={buildPagination(total)}
      />

      <AppModal
        title="创建备份"
        visible={createVisible}
        onCancel={closeCreateModal}
        onOk={handleCreateOk}
        okText="确定"
        cancelText="取消"
        okButtonProps={{ loading: createMutation.isPending }}
        closeOnEsc
      >
        <Form
          key={createVisible ? 'create-backup-open' : 'create-backup-closed'}
          getFormApi={(api) => { createFormApi.current = api; }}
          allowEmpty
          labelPosition="left"
          labelWidth={90}
        >
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
            placeholder="请选择备份类型"
          />
          <Form.Input field="name" label="备份名称" placeholder="可选，默认自动生成" style={{ width: '100%' }} />
        </Form>
      </AppModal>
    </div>
  );
}
