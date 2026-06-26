import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Descriptions, Modal, Select, SideSheet, Space, Table, Tag, Toast, Typography, Input } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { RefreshCw, RotateCcw, Search } from 'lucide-react';
import type { ExportEntityMeta, ExportJob, ExportJobDownload, ExportJobFormat, ExportJobStatus, PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';

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

export default function ExportJobsPage() {
  const [entities, setEntities] = useState<ExportEntityMeta[]>([]);
  const [data, setData] = useState<ExportJob[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [logsVisible, setLogsVisible] = useState(false);
  const [currentJob, setCurrentJob] = useState<ExportJob | null>(null);
  const [downloadLogs, setDownloadLogs] = useState<ExportJobDownload[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();

  const entityOptions = useMemo(
    () => [
      { value: '', label: '全部模块' },
      ...entities.map((item) => ({ value: item.entity, label: item.moduleName })),
    ],
    [entities],
  );

  const fetchEntities = useCallback(async () => {
    const res = await request.get<ExportEntityMeta[]>('/api/export-jobs/entities', { silent: true });
    if (res.code === 0) setEntities(res.data);
  }, []);

  const fetchData = useCallback(async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
        ...(params.entity ? { entity: params.entity } : {}),
        ...(params.status ? { status: params.status } : {}),
        ...(params.format ? { format: params.format } : {}),
        ...(params.keyword ? { keyword: params.keyword } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<ExportJob>>(`/api/export-jobs?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams]);

  useEffect(() => {
    void fetchEntities();
  }, [fetchEntities]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleSearch = () => {
    setPage(1);
    void fetchData(1);
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchData(1, pageSize, defaultSearchParams);
  };

  const handleDownload = async (record: ExportJob) => {
    setActionLoadingId(record.id);
    try {
      await request.download(`/api/export-jobs/${record.id}/download`, record.filename ?? `export-${record.id}.${record.format}`);
      Toast.success('下载完成');
      void fetchData();
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleCancel = async (record: ExportJob) => {
    setActionLoadingId(record.id);
    try {
      const res = await request.post<ExportJob>(`/api/export-jobs/${record.id}/cancel`);
      if (res.code === 0) {
        Toast.success('已取消');
        void fetchData();
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleRetry = async (record: ExportJob) => {
    setActionLoadingId(record.id);
    try {
      const res = await request.post<ExportJob>(`/api/export-jobs/${record.id}/retry`);
      if (res.code === 0) {
        Toast.success('已提交重试');
        void fetchData();
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleDelete = (record: ExportJob) => {
    Modal.confirm({
      title: '删除导出任务',
      content: record.fileDeletedAt ? '将删除该任务记录。' : '将删除该任务记录，已生成的导出文件会随保留策略清理。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        const res = await request.delete<null>(`/api/export-jobs/${record.id}`);
        if (res.code === 0) {
          Toast.success('已删除');
          void fetchData();
        }
      },
    });
  };

  const openDownloadLogs = async (record: ExportJob) => {
    setCurrentJob(record);
    setLogsVisible(true);
    setLogsLoading(true);
    try {
      const res = await request.get<ExportJobDownload[]>(`/api/export-jobs/${record.id}/downloads`);
      if (res.code === 0) setDownloadLogs(res.data);
    } finally {
      setLogsLoading(false);
    }
  };

  const columns: ColumnProps<ExportJob>[] = [
    { title: '任务ID', dataIndex: 'id', width: 90 },
    { title: '模块', dataIndex: 'moduleName', width: 120 },
    { title: '文件名', dataIndex: 'filename', width: 260, render: renderEllipsis },
    { title: '格式', dataIndex: 'format', width: 80, render: (value: ExportJobFormat) => value.toUpperCase() },
    { title: '模式', dataIndex: 'executionMode', width: 90, render: (value: string) => (value === 'sync' ? '同步' : '异步') },
    { title: '行数', dataIndex: 'rowCount', width: 100, render: (value: number | null) => value ?? '-' },
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
      render: (value: string | null) => value ? <Typography.Text type="danger" ellipsis={{ showTooltip: true }}>{value}</Typography.Text> : '-',
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
          value={searchParams.entity || undefined}
          optionList={entityOptions}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, entity: (value as string) ?? '' }))}
          style={{ width: 160 }}
        />
        <Select
          placeholder="状态"
          value={searchParams.status || undefined}
          optionList={statusOptions}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, status: (value as string) ?? '' }))}
          style={{ width: 140 }}
        />
        <Select
          placeholder="格式"
          value={searchParams.format || undefined}
          optionList={formatOptions}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, format: (value as string) ?? '' }))}
          style={{ width: 120 }}
        />
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索文件名/模块"
          value={searchParams.keyword}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: value }))}
          onEnterPress={handleSearch}
          style={{ width: 240 }}
          showClear
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        <Button icon={<RefreshCw size={14} />} onClick={() => void fetchData()} loading={loading}>刷新</Button>
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        onRefresh={() => void fetchData()}
        refreshLoading={loading}
        pagination={buildPagination(total, fetchData)}
        rowKey="id"
        size="small"
        empty="暂无导出任务"
        scroll={{ x: 2050 }}
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
          loading={logsLoading}
          columns={downloadLogColumns}
          dataSource={downloadLogs}
          rowKey="id"
          pagination={false}
          size="small"
          empty={<div style={{ padding: 24 }}>暂无下载记录</div>}
        />
      </SideSheet>
    </div>
  );
}
