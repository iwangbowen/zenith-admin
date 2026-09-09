import { useEffect, useState } from 'react';
import { Form, Tag, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import { formatBytes } from '@zenith/shared/core';
import {
  DB_BACKUP_STATUS_LABELS,
  DB_BACKUP_STATUS_OPTIONS,
  DB_BACKUP_TYPE_LABELS,
  DB_BACKUP_TYPE_OPTIONS,
  type CreateDbBackupInput,
  type DbBackup,
  type DbBackupCreated,
  type DbBackupStatus,
  type DbBackupType,
} from '@zenith/shared/ops';
import { fileContract } from '@zenith/shared/platform';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { FilterSelect, StatusSelect } from '@/components/search-filters';
import { CreateButton } from '@/components/toolbar-controls';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { dbAdminKeys, useCreateDbBackup, useDbBackups, useDeleteDbBackup } from '@/hooks/queries/db-admin';
import { urlOf } from '@/lib/contract-query';
import { formatDurationMs } from '@/utils/format';
import { request } from '@/utils/request';
import { createdAtColumn, EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const { Text } = Typography;

interface SearchParams {
  status?: DbBackupStatus;
  type?: DbBackupType;
}

const defaultSearchParams: SearchParams = { status: undefined, type: undefined };

const STATUS_TAG_COLORS: Record<DbBackupStatus, 'grey' | 'blue' | 'green' | 'red'> = {
  pending: 'grey',
  running: 'blue',
  success: 'green',
  failed: 'red',
};

/**
 * 数据库管理 → 备份：备份记录列表 + 创建 / 下载 / 删除。
 * 创建后接口只回任务回执，产物在后台生成，列表在有未完成记录时自动轮询；
 * 查看复用 system:db-admin:view，创建 / 删除与其余运维操作一样要求 system:db-admin:maintain。
 */
export function BackupsPanel({ canMaintain, active }: Readonly<{ canMaintain: boolean; active: boolean }>) {
  // 与其它面板一致：首次切到本 Tab 才开始取数，之后保持挂载以保留筛选与分页
  const [activated, setActivated] = useState(false);
  useEffect(() => { if (active) setActivated(true); }, [active]);

  const {
    page, pageSize, setPage, buildPagination,
    draftParams, setField, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: dbAdminKeys.backupLists });
  const listQuery = useDbBackups({ page, pageSize, status: submittedParams.status, type: submittedParams.type }, active);
  const createMutation = useCreateDbBackup();
  const deleteMutation = useDeleteDbBackup();
  const createModal = useEditModal<DbBackupCreated, Partial<CreateDbBackupInput>>({
    save: {
      isPending: createMutation.isPending,
      mutateAsync: ({ values }) => createMutation.mutateAsync({ body: values as CreateDbBackupInput }),
    },
    defaults: { type: 'pg_dump' },
    successMessage: () => '备份任务已创建',
    onSaved: () => setPage(1),
  });

  const handleDownload = async (record: DbBackup) => {
    if (!record.fileId) {
      Toast.warning('该备份没有关联文件');
      return;
    }
    await request.download(urlOf(fileContract.content, { params: { id: record.fileId } }), record.name || `backup-${record.id}`);
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', width: 60 },
    { title: '名称', dataIndex: 'name', minWidth: 260 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 130,
      render: (v: DbBackupType) => <Tag size="small">{DB_BACKUP_TYPE_LABELS[v]}</Tag>,
    },
    {
      title: '文件大小',
      dataIndex: 'fileSize',
      width: 100,
      align: 'right' as const,
      render: (v: number | null) => (v == null ? EMPTY_PLACEHOLDER : formatBytes(v)),
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 90,
      align: 'right' as const,
      render: (v: number | null) => formatDurationMs(v),
    },
    { title: '创建者', dataIndex: 'createdByName', width: 100, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right' as const,
      render: (v: DbBackupStatus, record: DbBackup) => {
        const tag = <Tag color={STATUS_TAG_COLORS[v]} size="small">{DB_BACKUP_STATUS_LABELS[v]}</Tag>;
        return record.errorMessage
          ? <Tooltip content={<Text style={{ maxWidth: 400, wordBreak: 'break-all' }}>{record.errorMessage}</Text>}>{tag}</Tooltip>
          : tag;
      },
    },
    createOperationColumn<DbBackup>({
      width: 150,
      actions: (record) => [
        {
          key: 'download',
          label: '下载',
          hidden: !(record.fileId && record.status === 'success'),
          onClick: () => void handleDownload(record),
        },
        deleteAction({
          hidden: !canMaintain,
          title: `确定要删除备份「${record.name}」吗？`,
          content: '仅删除备份记录，已归档到文件存储的备份文件不会一并删除。',
          run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
          successMessage: '已删除',
        }),
      ],
    }),
  ];

  if (!activated) return null;

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 4 }}>
      <ListSearchToolbar
        filters={(
          <>
            <FilterSelect<DbBackupType>
              placeholder="全部备份类型"
              items={DB_BACKUP_TYPE_OPTIONS}
              value={draftParams.type}
              onChange={setField('type')}
              width={150}
            />
            <StatusSelect<DbBackupStatus>
              items={DB_BACKUP_STATUS_OPTIONS}
              value={draftParams.status}
              onChange={setField('status')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={canMaintain && <CreateButton onClick={createModal.openCreate}>新增备份</CreateButton>}
        filterTitle="备份筛选"
      />

      <ConfigurableTable<DbBackup>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...createModal.modalProps} title="创建备份" okText="确定" cancelText="取消">
        <Form key={createModal.formKey} {...createModal.formProps}>
          <Form.Select
            field="type"
            label="备份类型"
            rules={[{ required: true, message: '请选择备份类型' }]}
            optionList={DB_BACKUP_TYPE_OPTIONS}
            style={{ width: '100%' }}
            placeholder="请选择备份类型"
            extraText="pg_dump 生成完整 SQL（gzip 压缩，需服务器安装 PostgreSQL 客户端）；Drizzle 导出逐表生成 JSON"
          />
          <Form.Input field="name" label="备份名称" placeholder="可选，默认自动生成" style={{ width: '100%' }} />
        </Form>
      </AppModal>
    </div>
  );
}

BackupsPanel.displayName = 'BackupsPanel';
