import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Descriptions, Modal, SideSheet, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import type { ExportEntityMeta, ExportJob, ExportJobDownload, ExportJobFormat, ExportJobStatus } from '@zenith/shared/tasks';
import { EXPORT_JOB_FORMATS, EXPORT_JOB_STATUSES, exportJobContract } from '@zenith/shared/tasks';
import { enumValueOf, formatBytes } from '@zenith/shared/core';
import { urlOf } from '@/lib/contract-query';
import { request } from '@/utils/request';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { confirmAndDelete, deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { formatDateTime } from '@/utils/date';
import { EMPTY_PLACEHOLDER, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import {
  exportJobKeys,
  rerunExportJobBody,
  useBatchDeleteExportJobs,
  useCancelExportJob,
  useDeleteExportJob,
  useExportEntities,
  useExportJobDownloads,
  useExportJobList,
  useRerunExportJob,
  useRetryExportJob,
} from '@/hooks/queries/export-jobs';
import { BatchDeleteButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { useListSearch } from '@/hooks/useListSearch';
import { copyTextWithToast } from '@/utils/clipboard';

interface SearchParams {
  entity?: string;
  status?: string;
  format?: string;
  keyword: string;
}

const defaultSearchParams: SearchParams = {
  entity: undefined,
  status: undefined,
  format: undefined,
  keyword: '',
};
const EMPTY_ENTITIES: ExportEntityMeta[] = [];
const EMPTY_EXPORT_JOBS: ExportJob[] = [];

const statusOptions: Array<{ value: ExportJobStatus; label: string }> = [
  { value: 'pending', label: '等待中' },
  { value: 'running', label: '执行中' },
  { value: 'success', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
  { value: 'expired', label: '已过期' },
];

const formatOptions: Array<{ value: ExportJobFormat; label: string }> = [
  { value: 'xlsx', label: 'Excel' },
  { value: 'csv', label: 'CSV' },
];

const statusTagMap = {
  pending: { color: 'blue', label: '等待中' },
  running: { color: 'cyan', label: '执行中' },
  success: { color: 'green', label: '已完成' },
  failed: { color: 'red', label: '失败' },
  cancelled: { color: 'grey', label: '已取消' },
  expired: { color: 'orange', label: '已过期' },
} as const satisfies Record<ExportJobStatus, { color: 'blue' | 'cyan' | 'green' | 'red' | 'grey' | 'orange'; label: string }>;

function renderProgress(record: ExportJob) {
  if (record.status === 'pending') return <Typography.Text type="tertiary">排队中</Typography.Text>;
  if (record.status === 'running') return <Typography.Text type="secondary">执行中</Typography.Text>;
  if (record.status === 'success') return <Typography.Text type="success">{record.rowCount == null ? '已完成' : `${record.rowCount} 行`}</Typography.Text>;
  if (record.status === 'failed') return <Typography.Text type="danger">失败</Typography.Text>;
  if (record.status === 'cancelled') return <Typography.Text type="tertiary">已取消</Typography.Text>;
  return <Typography.Text type="warning">文件已过期</Typography.Text>;
}

export default function ExportJobsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: exportJobKeys.lists });
  const [logsVisible, setLogsVisible] = useState(false);
  const [currentJob, setCurrentJob] = useState<ExportJob | null>(null);
  const [downloadLoadingId, setDownloadLoadingId] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const entitiesQuery = useExportEntities();
  const entities = entitiesQuery.data ?? EMPTY_ENTITIES;
  const listQuery = useExportJobList({
    page,
    pageSize,
    entity: submittedParams.entity || undefined,
    status: enumValueOf(EXPORT_JOB_STATUSES, submittedParams.status),
    format: enumValueOf(EXPORT_JOB_FORMATS, submittedParams.format),
    keyword: submittedParams.keyword || undefined,
  });
  const data = listQuery.data?.list ?? EMPTY_EXPORT_JOBS;
  const downloadsQuery = useExportJobDownloads(currentJob?.id, logsVisible && currentJob != null);
  const cancelMutation = useCancelExportJob();
  const retryMutation = useRetryExportJob();
  const rerunMutation = useRerunExportJob();
  const deleteMutation = useDeleteExportJob();
  const batchDeleteMutation = useBatchDeleteExportJobs();

  const actionLoadingId =
    downloadLoadingId
    ?? (cancelMutation.isPending ? cancelMutation.variables?.params.id : null)
    ?? (retryMutation.isPending ? retryMutation.variables?.params.id : null)
    ?? (rerunMutation.isPending ? rerunMutation.variables?.sourceId : null)
    ?? (deleteMutation.isPending ? deleteMutation.variables?.params.id : null)
    ?? null;
  const batchDeleting = batchDeleteMutation.isPending;

  const entityOptions = useMemo(
    () => entities.map((item) => ({ value: item.entity, label: item.moduleName })),
    [entities],
  );
  const entityMap = useMemo(() => new Map(entities.map((item) => [item.entity, item])), [entities]);

  useEffect(() => {
    setSelectedRowKeys((prev) => prev.filter((id) => data.some((item) => item.id === id)));
  }, [data]);

  const handleDownload = async (record: ExportJob) => {
    setDownloadLoadingId(record.id);
    try {
      await request.download(urlOf(exportJobContract.download, { params: { id: record.id } }), record.filename ?? `export-${record.id}.${record.format}`);
      Toast.success('下载完成');
      // 下载会写入该任务的下载记录（列表的下载次数列随之变化），不涉及可导出实体元数据
      void queryClient.invalidateQueries({ queryKey: exportJobKeys.lists });
      void queryClient.invalidateQueries({ queryKey: exportJobKeys.downloads(record.id) });
    } finally {
      setDownloadLoadingId(null);
    }
  };

  const handleCancel = async (record: ExportJob) => {
    await cancelMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('已取消');
  };

  const handleRetry = async (record: ExportJob) => {
    await retryMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('已提交重试');
  };

  const handleRerun = async (record: ExportJob) => {
    const data = await rerunMutation.mutateAsync({ body: rerunExportJobBody(record), sourceId: record.id });
    Toast.success(data.mode === 'async' ? '已重新提交导出任务' : '已重新导出');
  };

  const handleCopyQuery = async (record: ExportJob) => {
    await copyTextWithToast(JSON.stringify(record.query ?? {}, null, 2), { success: '已复制筛选条件', error: '复制失败' });
  };

  const handleOpenSource = (record: ExportJob) => {
    const sourcePath = entityMap.get(record.entity)?.sourcePath;
    if (!sourcePath) {
      Toast.warning('该导出实体未配置来源页面');
      return;
    }
    navigate(sourcePath);
  };

  const handleShowError = (record: ExportJob) => {
    Modal.error({
      title: `导出失败 #${record.id}`,
      content: (
        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
          {record.errorMessage ?? '未返回失败原因'}
        </Typography.Paragraph>
      ),
      okText: '知道了',
    });
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    confirmAndDelete({
      title: '批量删除导出任务',
      content: `将删除选中的 ${selectedRowKeys.length} 个导出任务记录。`,
      run: () => batchDeleteMutation.mutateAsync(selectedRowKeys),
      successMessage: `已删除 ${selectedRowKeys.length} 个任务`,
      onDeleted: () => setSelectedRowKeys([]),
    });
  };

  const openDownloadLogs = (record: ExportJob) => {
    setCurrentJob(record);
    setLogsVisible(true);
  };

  const columns: ColumnProps<ExportJob>[] = [
    { title: '任务ID', dataIndex: 'id', width: 90 },
    { title: '模块', dataIndex: 'moduleName', width: 120 },
    { title: '文件名', dataIndex: 'filename', minWidth: 260, render: renderEllipsis },
    { title: '格式', dataIndex: 'format', width: 80, render: (value: ExportJobFormat) => value.toUpperCase() },
    { title: '模式', dataIndex: 'executionMode', width: 90, render: (value: string) => (value === 'sync' ? '同步' : '异步') },
    { title: '进度', dataIndex: 'rowCount', width: 120, render: (_: number | null, record: ExportJob) => renderProgress(record) },
    { title: '大小', dataIndex: 'fileSize', width: 110, align: 'right', render: (size: number | null) => (size == null ? EMPTY_PLACEHOLDER : formatBytes(size)) },
    {
      title: '安全',
      dataIndex: 'raw',
      width: 160,
      render: (_: unknown, record: ExportJob) => (
        <Space spacing={4}>
          {/* 脱敏/明文仅对含敏感列的导出有实际意义，无敏感数据的任务不展示 */}
          {record.sensitive && (record.raw ? <Tag color="red">明文</Tag> : <Tag color="green">脱敏</Tag>)}
          {record.watermark && <Tag color="blue">水印</Tag>}
          {record.sensitive && <Tag color="orange">敏感</Tag>}
        </Space>
      ),
    },
    { title: '创建人', dataIndex: 'createdByName', width: 130, render: (value: string | null) => value || EMPTY_PLACEHOLDER },
    { title: '下载次数', dataIndex: 'downloadCount', width: 100, align: 'right' },
    dateTimeColumn('过期时间', 'expiresAt'),
    dateTimeColumn('创建时间', 'createdAt'),
    {
      title: '错误信息',
      dataIndex: 'errorMessage',
      width: 240,
      render: (value: string | null, record: ExportJob) => value ? (
        <Button
          theme="borderless"
          type="danger"
          size="small"
          icon={<AlertTriangle size={13} />}
          onClick={() => handleShowError(record)}
        >
          查看失败原因
        </Button>
      ) : EMPTY_PLACEHOLDER,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      fixed: 'right',
      render: (value: ExportJobStatus) => {
        const meta = statusTagMap[value];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    createOperationColumn<ExportJob>({
      width: 210,
      desktopInlineKeys: ['download', 'logs'],
      actions: (record) => [
        {
          key: 'download',
          label: '下载',
          loading: actionLoadingId === record.id,
          disabled: record.status !== 'success' || !!record.fileDeletedAt,
          disabledReason: record.fileDeletedAt ? '文件已清理' : '文件尚未生成',
          onClick: () => void handleDownload(record),
        },
        {
          key: 'logs',
          label: '下载日志',
          onClick: () => void openDownloadLogs(record),
        },
        {
          key: 'rerun',
          label: '重新导出',
          loading: actionLoadingId === record.id,
          onClick: () => void handleRerun(record),
        },
        {
          key: 'copy-query',
          label: '复制筛选',
          onClick: () => void handleCopyQuery(record),
        },
        {
          key: 'source',
          label: '来源页面',
          hidden: !entityMap.get(record.entity)?.sourcePath,
          onClick: () => handleOpenSource(record),
        },
        {
          key: 'cancel',
          label: '取消',
          hidden: !['pending', 'running'].includes(record.status),
          loading: actionLoadingId === record.id,
          onClick: () => void handleCancel(record),
        },
        {
          key: 'retry',
          label: '重试',
          hidden: record.status !== 'failed',
          loading: actionLoadingId === record.id,
          onClick: () => void handleRetry(record),
        },
        {
          ...deleteAction({
            title: '删除导出任务',
            content: record.fileDeletedAt ? '将删除该任务记录。' : '将删除该任务记录，已生成的导出文件会随保留策略清理。',
            run: () => deleteMutation.mutateAsync({ params: { id: record.id } }),
            successMessage: '已删除',
            onDeleted: () => setSelectedRowKeys((prev) => prev.filter((id) => id !== record.id)),
          }),
          dividerBefore: true,
        },
      ],
    }),
  ];

  const downloadLogColumns: ColumnProps<ExportJobDownload>[] = [
    { title: '下载人', dataIndex: 'downloadedByName', width: 140, render: (value: string | null) => value || EMPTY_PLACEHOLDER },
    { title: 'IP', dataIndex: 'ip', width: 140, render: (value: string | null) => value || EMPTY_PLACEHOLDER },
    { title: 'User Agent', dataIndex: 'userAgent', width: 360, render: renderEllipsis },
    dateTimeColumn('下载时间', 'createdAt'),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索文件名/模块" {...bindKeyword('keyword')} width={240} />}
        filters={(
          <>
            <FilterSelect
              placeholder="全部模块"
              items={entityOptions}
              {...bind('entity')}
              width={160}
            />
            <StatusSelect
              items={statusOptions}
              {...bind('status')}
            />
            <FilterSelect
              placeholder="全部格式"
              items={formatOptions}
              {...bind('format')}
            />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        actions={(
          <>
            <Button icon={<RefreshCw size={14} />} onClick={() => void listQuery.refetch()} loading={listQuery.isFetching}>刷新</Button>
            {selectedRowKeys.length > 0 && <BatchDeleteButton count={selectedRowKeys.length} loading={batchDeleting} onClick={handleBatchDelete} />}
          </>
        )}
      />

      <ConfigurableTable<ExportJob>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          rowSelection: {
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys((keys ?? []) as number[]),
          },
          empty: '暂无导出任务',
        })}
      />

      <SideSheet
        title="下载日志"
        visible={logsVisible}
        onCancel={() => setLogsVisible(false)}
        width={720}
      >
        {currentJob && (
          <Descriptions
            data={[
              { key: '文件名', value: currentJob.filename ?? EMPTY_PLACEHOLDER },
              { key: '任务ID', value: currentJob.id },
              { key: '下载次数', value: currentJob.downloadCount },
              { key: '最后下载', value: currentJob.lastDownloadedAt ? formatDateTime(currentJob.lastDownloadedAt) : EMPTY_PLACEHOLDER },
            ]}
            row
            size="small"
            style={{ marginBottom: 16 }}
          />
        )}
        <ConfigurableTable
          columnSettingsKey="export-job-downloads"
          columns={downloadLogColumns}
          {...listTableProps(downloadsQuery, { empty: <div style={{ padding: 24 }}>暂无下载记录</div> })}
        />
      </SideSheet>
    </div>
  );
}
