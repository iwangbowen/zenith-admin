import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Descriptions, Modal, Select, SideSheet, Space, Table, Tag, Toast, Typography, Input } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import type { ExportEntityMeta, ExportJob, ExportJobDownload, ExportJobFormat, ExportJobStatus } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import {
  exportJobKeys,
  useBatchDeleteExportJobs,
  useCancelExportJob,
  useDeleteExportJob,
  useExportEntities,
  useExportJobDownloads,
  useExportJobList,
  useRerunExportJob,
  useRetryExportJob,
} from '@/hooks/queries/export-jobs';

interface SearchParams {
  entity: string;
  status: string;
  format: string;
  keyword: string;
}

const defaultSearchParams: SearchParams = {
  entity: '',
  status: '',
  format: '',
  keyword: '',
};
const EMPTY_ENTITIES: ExportEntityMeta[] = [];
const EMPTY_EXPORT_JOBS: ExportJob[] = [];

const statusOptions: Array<{ value: ExportJobStatus | ''; label: string }> = [
  { value: '', label: '全部状态' },
  { value: 'pending', label: '等待中' },
  { value: 'running', label: '执行中' },
  { value: 'success', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
  { value: 'expired', label: '已过期' },
];

const formatOptions: Array<{ value: ExportJobFormat | ''; label: string }> = [
  { value: '', label: '全部格式' },
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

function formatFileSize(size: number | null) {
  if (size == null) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

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
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const [logsVisible, setLogsVisible] = useState(false);
  const [currentJob, setCurrentJob] = useState<ExportJob | null>(null);
  const [downloadLoadingId, setDownloadLoadingId] = useState<number | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const entitiesQuery = useExportEntities();
  const entities = entitiesQuery.data ?? EMPTY_ENTITIES;
  const listQuery = useExportJobList({
    page,
    pageSize,
    entity: submittedParams.entity || undefined,
    status: submittedParams.status || undefined,
    format: submittedParams.format || undefined,
    keyword: submittedParams.keyword || undefined,
  });
  const data = listQuery.data?.list ?? EMPTY_EXPORT_JOBS;
  const total = listQuery.data?.total ?? 0;
  const downloadsQuery = useExportJobDownloads(currentJob?.id, logsVisible && currentJob != null);
  const cancelMutation = useCancelExportJob();
  const retryMutation = useRetryExportJob();
  const rerunMutation = useRerunExportJob();
  const deleteMutation = useDeleteExportJob();
  const batchDeleteMutation = useBatchDeleteExportJobs();

  const actionLoadingId =
    downloadLoadingId
    ?? (cancelMutation.isPending ? cancelMutation.variables : null)
    ?? (retryMutation.isPending ? retryMutation.variables : null)
    ?? (rerunMutation.isPending ? rerunMutation.variables?.id : null)
    ?? (deleteMutation.isPending ? deleteMutation.variables : null);
  const batchDeleting = batchDeleteMutation.isPending;

  const entityOptions = useMemo(
    () => [
      { value: '', label: '全部模块' },
      ...entities.map((item) => ({ value: item.entity, label: item.moduleName })),
    ],
    [entities],
  );
  const entityMap = useMemo(() => new Map(entities.map((item) => [item.entity, item])), [entities]);

  useEffect(() => {
    setSelectedRowKeys((prev) => prev.filter((id) => data.some((item) => item.id === id)));
  }, [data]);


  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: exportJobKeys.lists });
  };

  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: exportJobKeys.lists });
  };

  const handleDownload = async (record: ExportJob) => {
    setDownloadLoadingId(record.id);
    try {
      await request.download(`/api/export-jobs/${record.id}/download`, record.filename ?? `export-${record.id}.${record.format}`);
      Toast.success('下载完成');
      void queryClient.invalidateQueries({ queryKey: exportJobKeys.all });
    } finally {
      setDownloadLoadingId(null);
    }
  };

  const handleCancel = async (record: ExportJob) => {
    await cancelMutation.mutateAsync(record.id);
    Toast.success('已取消');
  };

  const handleRetry = async (record: ExportJob) => {
    await retryMutation.mutateAsync(record.id);
    Toast.success('已提交重试');
  };

  const handleRerun = async (record: ExportJob) => {
    const data = await rerunMutation.mutateAsync(record);
    Toast.success(data.mode === 'async' ? '已重新提交导出任务' : '已重新导出');
  };

  const handleCopyQuery = async (record: ExportJob) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(record.query ?? {}, null, 2));
      Toast.success('已复制筛选条件');
    } catch {
      Toast.error('复制失败');
    }
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

  const handleDelete = (record: ExportJob) => {
    Modal.confirm({
      title: '删除导出任务',
      content: record.fileDeletedAt ? '将删除该任务记录。' : '将删除该任务记录，已生成的导出文件会随保留策略清理。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(record.id);
        Toast.success('已删除');
        setSelectedRowKeys((prev) => prev.filter((id) => id !== record.id));
      },
    });
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    Modal.confirm({
      title: '批量删除导出任务',
      content: `将删除选中的 ${selectedRowKeys.length} 个导出任务记录。`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await batchDeleteMutation.mutateAsync(selectedRowKeys);
        Toast.success(`已删除 ${selectedRowKeys.length} 个任务`);
        setSelectedRowKeys([]);
      },
    });
  };

  const openDownloadLogs = (record: ExportJob) => {
    setCurrentJob(record);
    setLogsVisible(true);
  };

  const columns: ColumnProps<ExportJob>[] = [
    { title: '任务ID', dataIndex: 'id', width: 90 },
    { title: '模块', dataIndex: 'moduleName', width: 120 },
    { title: '文件名', dataIndex: 'filename', width: 260, render: renderEllipsis },
    { title: '格式', dataIndex: 'format', width: 80, render: (value: ExportJobFormat) => value.toUpperCase() },
    { title: '模式', dataIndex: 'executionMode', width: 90, render: (value: string) => (value === 'sync' ? '同步' : '异步') },
    { title: '进度', dataIndex: 'rowCount', width: 120, render: (_: number | null, record: ExportJob) => renderProgress(record) },
    { title: '大小', dataIndex: 'fileSize', width: 110, render: formatFileSize },
    {
      title: '安全',
      dataIndex: 'raw',
      width: 150,
      render: (_: unknown, record: ExportJob) => (
        <Space spacing={4}>
          {record.raw ? <Tag color="red">明文</Tag> : <Tag color="green">脱敏</Tag>}
          {record.watermark && <Tag color="blue">水印</Tag>}
          {record.sensitive && <Tag color="orange">敏感</Tag>}
        </Space>
      ),
    },
    { title: '创建人', dataIndex: 'createdByName', width: 130, render: (value: string | null) => value ?? '-' },
    { title: '下载次数', dataIndex: 'downloadCount', width: 100 },
    { title: '过期时间', dataIndex: 'expiresAt', width: 180, render: (value: string | null) => (value ? formatDateTime(value) : '-') },
    { title: '创建时间', dataIndex: 'createdAt', width: 180, render: (value: string) => formatDateTime(value) },
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
      ) : '-',
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
      width: 220,
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
          key: 'delete',
          label: '删除',
          danger: true,
          dividerBefore: true,
          onClick: () => handleDelete(record),
        },
      ],
    }),
  ];

  const downloadLogColumns: ColumnProps<ExportJobDownload>[] = [
    { title: '下载人', dataIndex: 'downloadedByName', width: 140, render: (value: string | null) => value ?? '-' },
    { title: 'IP', dataIndex: 'ip', width: 140, render: (value: string | null) => value ?? '-' },
    { title: 'User Agent', dataIndex: 'userAgent', width: 360, render: renderEllipsis },
    { title: '下载时间', dataIndex: 'createdAt', width: 180, render: (value: string) => formatDateTime(value) },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Select
          placeholder="模块"
          value={draftParams.entity || undefined}
          optionList={entityOptions}
          onChange={(value) => setDraftParams((prev) => ({ ...prev, entity: (value as string) ?? '' }))}
          style={{ width: 160 }}
        />
        <Select
          placeholder="状态"
          value={draftParams.status || undefined}
          optionList={statusOptions}
          onChange={(value) => setDraftParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
          style={{ width: 140 }}
        />
        <Select
          placeholder="格式"
          value={draftParams.format || undefined}
          optionList={formatOptions}
          onChange={(value) => setDraftParams((prev) => ({ ...prev, format: (value as string) ?? '' }))}
          style={{ width: 120 }}
        />
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索文件名/模块"
          value={draftParams.keyword}
          onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))}
          onEnterPress={handleSearch}
          style={{ width: 240 }}
          showClear
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        <Button icon={<RefreshCw size={14} />} onClick={() => void listQuery.refetch()} loading={listQuery.isFetching}>刷新</Button>
        {selectedRowKeys.length > 0 && (
          <Button type="danger" icon={<Trash2 size={14} />} loading={batchDeleting} onClick={handleBatchDelete}>
            批量删除 ({selectedRowKeys.length})
          </Button>
        )}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
        rowKey="id"
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys((keys ?? []) as number[]),
        }}
        size="small"
        empty="暂无导出任务"
        scroll={{ x: 2150 }}
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
              { key: '文件名', value: currentJob.filename ?? '-' },
              { key: '任务ID', value: currentJob.id },
              { key: '下载次数', value: currentJob.downloadCount },
              { key: '最后下载', value: currentJob.lastDownloadedAt ? formatDateTime(currentJob.lastDownloadedAt) : '-' },
            ]}
            row
            size="small"
            style={{ marginBottom: 16 }}
          />
        )}
        <Table
          bordered
          loading={downloadsQuery.isFetching}
          columns={downloadLogColumns}
          dataSource={downloadsQuery.data ?? []}
          rowKey="id"
          pagination={false}
          size="small"
          empty={<div style={{ padding: 24 }}>暂无下载记录</div>}
        />
      </SideSheet>
    </div>
  );
}
