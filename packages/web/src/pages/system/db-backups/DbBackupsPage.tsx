
import { Tag, Toast, Form } from '@douyinfe/semi-ui';
import { enumValueOf } from '@zenith/shared/core';
import { DB_BACKUP_STATUSES, DB_BACKUP_TYPES, type DbBackup, type DbBackupCreated, type DbBackupStatus, type DbBackupType } from '@zenith/shared/ops';
import { fileContract, type CreateBackupInput } from '@zenith/shared/platform';
import { AppModal } from '@/components/AppModal';
import { urlOf } from '@/lib/contract-query';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { createdAtColumn } from '../../../utils/table-columns';
import {
  dbBackupKeys,
  useCreateDbBackup,
  useDbBackupList,
  useDeleteDbBackups,
} from '@/hooks/queries/db-backups';
import { request } from '@/utils/request';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { confirmDelete } from '@/utils/confirm';
import { FilterSelect, StatusSelect } from '@/components/search-filters';

export default function DbBackupsPage() {
  const {
    page, pageSize, setPage, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<{ status: string; type: string }>({ defaults: { status: '', type: '' }, listKey: dbBackupKeys.lists });
  const { hasPermission } = usePermission();
  const listQuery = useDbBackupList({
    page,
    pageSize,
    status: enumValueOf(DB_BACKUP_STATUSES, submittedParams.status),
    type: enumValueOf(DB_BACKUP_TYPES, submittedParams.type),
  });
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const createMutation = useCreateDbBackup();
  const createModal = useEditModal<DbBackupCreated, Partial<CreateBackupInput>>({
    save: {
      isPending: createMutation.isPending,
      mutateAsync: async ({ values }) => createMutation.mutateAsync({ body: values as CreateBackupInput }),
    },
    defaults: { type: 'pg_dump' },
    successMessage: () => '备份任务已创建',
    onSaved: () => setPage(1),
  });
  const deleteMutation = useDeleteDbBackups();

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync([id]);
    Toast.success('已删除');
  };

  const handleDownload = async (record: DbBackup) => {
    if (!record.fileId) {
      Toast.warning('该备份没有关联文件');
      return;
    }
    const name = record.name || `backup-${record.id}`;
    await request.download(urlOf(fileContract.content, { params: { id: record.fileId } }), name);
  };

  const statusColorMap: Record<DbBackupStatus, 'grey' | 'blue' | 'green' | 'red'> = {
    pending: 'grey',
    running: 'blue',
    success: 'green',
    failed: 'red',
  };
  const statusLabelMap: Record<DbBackupStatus, string> = {
    pending: '等待中',
    running: '执行中',
    success: '成功',
    failed: '失败',
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', minWidth: 260 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 130,
      render: (v: DbBackupType) => <Tag size="small">{v === 'pg_dump' ? 'pg_dump' : 'Drizzle 导出'}</Tag>,
    },
    {
      title: '文件大小',
      align: 'right' as const,
      dataIndex: 'fileSize',
      width: 100,
      render: (v: number | null) => v ? `${(v / 1024).toFixed(1)} KB` : '-',
    },
    {
      title: '耗时',
      align: 'right' as const,
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
      render: (v: DbBackupStatus) => <Tag color={statusColorMap[v]} size="small">{statusLabelMap[v]}</Tag>,
    },
    createOperationColumn<DbBackup>({
      width: 150,
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
            confirmDelete({
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
            <FilterSelect
              placeholder="全部备份类型"
              items={[{ label: 'pg_dump', value: 'pg_dump' },
                { label: 'Drizzle 导出', value: 'drizzle_export' },]}
              value={draftParams.type}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, type: v as string }))}
              width={150}
            />
            <StatusSelect
              items={[{ label: '等待中', value: 'pending' },
                { label: '执行中', value: 'running' },
                { label: '成功', value: 'success' },
                { label: '失败', value: 'failed' },]}
              value={draftParams.status}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, status: v as string }))}
            />
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
            {hasPermission('system:db-backup:create') && (
              <CreateButton onClick={createModal.openCreate}>新增备份</CreateButton>
            )}
          </>
        )}
        mobilePrimary={(
          <>
            <FilterSelect
              placeholder="全部备份类型"
              items={[{ label: 'pg_dump', value: 'pg_dump' },
                { label: 'Drizzle 导出', value: 'drizzle_export' },]}
              value={draftParams.type}
              onChange={(v) => setDraftParams((prev) => ({ ...prev, type: v as string }))}
              width={150}
            />
            <SearchButton onClick={handleSearch} />
            {hasPermission('system:db-backup:create') && (
              <CreateButton onClick={createModal.openCreate}>新增备份</CreateButton>
            )}
          </>
        )}
        mobileFilters={(
          <StatusSelect
            items={[{ label: '等待中', value: 'pending' },
              { label: '执行中', value: 'running' },
              { label: '成功', value: 'success' },
              { label: '失败', value: 'failed' },]}
            value={draftParams.status}
            onChange={(v) => setDraftParams((prev) => ({ ...prev, status: v as string }))}
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
        {...createModal.modalProps}
        title="创建备份"
        okText="确定"
        cancelText="取消"
      >
        <Form
          key={createModal.formKey} {...createModal.formProps}
        >
          <Form.Select
            field="type"
            label="备份类型"
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
