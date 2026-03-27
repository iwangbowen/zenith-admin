import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  SideSheet,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Download } from 'lucide-react';
import type { CronJob, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import { SearchToolbar } from '@/components/SearchToolbar';

interface SearchParams {
  keyword: string;
  status: string;
}

interface CronJobLog {
  id: number;
  jobId: number;
  jobName: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  status: 'success' | 'fail' | 'running';
  output: string | null;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

export default function CronJobsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [data, setData] = useState<CronJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [cronExprValue, setCronExprValue] = useState('');
  const [handlers, setHandlers] = useState<string[]>([]);
  const [logsDrawerVisible, setLogsDrawerVisible] = useState(false);
  const [logsJobName, setLogsJobName] = useState('');
  const [logsJobId, setLogsJobId] = useState<number | null>(null);
  const [logsData, setLogsData] = useState<CronJobLog[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const logsPageSize = 20;;

  const fetchData = useCallback(async (p = page, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(pageSize),
        ...(params.keyword ? { keyword: params.keyword } : {}),
        ...(params.status ? { status: params.status } : {}),
      }).toString();
      const res = await request.get<PaginatedResponse<CronJob>>(`/api/cron-jobs?${query}`);
      if (res.code === 0) {
        setData(res.data.list);
        setTotal(res.data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, searchParams]);

  useEffect(() => {
    void fetchData();
    request.get<string[]>('/api/cron-jobs/handlers').then((res) => {
      if (res.code === 0) setHandlers(res.data);
    });
  }, [fetchData]);

  const handleSearch = () => { setPage(1); void fetchData(1); };
  const handleReset = () => { setSearchParams(defaultSearchParams); setPage(1); void fetchData(1, defaultSearchParams); };
  const handlePageChange = (p: number) => { setPage(p); void fetchData(p); };

  const handleExport = async () => {
    setExportLoading(true);
    try {
      await request.download('/api/cron-jobs/export', '定时任务.xlsx');
      Toast.success('导出成功');
    } catch { Toast.error('导出失败'); } finally { setExportLoading(false); }
  };

  const handleRunOnce = (id: number, name: string) => {
    Modal.confirm({
      title: '确定要立即执行一次吗？',
      content: `任务：${name}`,
      onOk: async () => {
        const res = await request.post(`/api/cron-jobs/${id}/run`);
        if (res.code === 0) {
          Toast.success('已触发执行');
          void fetchData();
        }
      },
    });
  };

  const handleModalOk = async () => {
    let values;
    try { values = await formApi.current?.validate(); } catch { throw new Error('validation'); }

    const res = editingJob
      ? await request.put(`/api/cron-jobs/${editingJob.id}`, values)
      : await request.post('/api/cron-jobs', values);

    if (res.code === 0) {
      Toast.success(editingJob ? '更新成功' : '创建成功');
      setModalVisible(false);
      setEditingJob(null);
      setCronExprValue('');
      void fetchData();
    } else {
      throw new Error(res.message);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/cron-jobs/${id}`);
    if (res.code === 0) {
      Toast.success('删除成功');
      void fetchData();
    }
  };

  const fetchJobLogs = useCallback(async (jobId: number, p = 1) => {
    setLogsLoading(true);
    try {
      const query = new URLSearchParams({ page: String(p), pageSize: String(logsPageSize) }).toString();
      const res = await request.get<PaginatedResponse<CronJobLog>>(`/api/cron-jobs/${jobId}/logs?${query}`);
      if (res.code === 0) {
        setLogsData(res.data.list);
        setLogsTotal(res.data.total);
        setLogsPage(res.data.page);
      }
    } finally {
      setLogsLoading(false);
    }
  }, [logsPageSize]);

  const openLogsDrawer = (record: CronJob) => {
    setLogsJobId(record.id);
    setLogsJobName(record.name);
    setLogsData([]);
    setLogsPage(1);
    setLogsDrawerVisible(true);
    void fetchJobLogs(record.id, 1);
  };

  const formInitValues = editingJob
    ? {
        name: editingJob.name,
        cronExpression: editingJob.cronExpression,
        handler: editingJob.handler,
        params: editingJob.params,
        status: editingJob.status,
        description: editingJob.description,
      }
    : { status: 'active' };

  const runStatusColor: Record<string, import('@douyinfe/semi-ui/lib/es/tag/interface').TagColor> = {
    success: 'green',
    fail: 'red',
    running: 'blue',
  };

  const columns: ColumnProps<CronJob>[] = [
    { title: '任务名称', dataIndex: 'name', width: 180, ellipsis: true },
    { title: 'Cron 表达式', dataIndex: 'cronExpression', width: 150 },
    { title: '处理器', dataIndex: 'handler', width: 180, ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: string) => (
        <Tag color={v === 'active' ? 'green' : 'grey'} size="small">{v === 'active' ? '启用' : '禁用'}</Tag>
      ),
    },
    {
      title: '上次执行', dataIndex: 'lastRunStatus', width: 90,
      render: (v: string | null) =>
        v ? <Tag color={runStatusColor[v] ?? 'grey'} size="small">{v}</Tag> : '—',
    },
    {
      title: '上次执行时间', dataIndex: 'lastRunAt', width: 180,
      render: (v: string | null) => v ? formatDateTime(v) : '—',
    },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '操作',
      fixed: 'right',
      width: 280,
      render: (_: unknown, record: CronJob) => (
        <Space>
          {hasPermission('system:cronjob:list') && (
            <Button theme="borderless" size="small" onClick={() => openLogsDrawer(record)}>
              执行日志
            </Button>
          )}
          {hasPermission('system:cronjob:execute') && (
            <Button theme="borderless" size="small" onClick={() => handleRunOnce(record.id, record.name)}>
              执行
            </Button>
          )}
          {hasPermission('system:cronjob:update') && (
            <Button theme="borderless" size="small" onClick={() => { setEditingJob(record); setCronExprValue(record.cronExpression ?? ''); setModalVisible(true); }}>
              编辑
            </Button>
          )}
          {hasPermission('system:cronjob:delete') && (
            <Button theme="borderless" type="danger" size="small" onClick={() => {
              Modal.confirm({ title: '确定要删除此任务吗？', okButtonProps: { type: 'danger', theme: 'solid' }, onOk: () => handleDelete(record.id) });
            }}>
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        left={<>
          <Input
            prefix={<Search size={14} />}
            placeholder="搜索任务名称/处理器"
            value={searchParams.keyword}
            onChange={(v) => setSearchParams((p) => ({ ...p, keyword: v }))}
            onEnterPress={handleSearch}
            style={{ width: 240 }}
            showClear
          />
          <Select
            placeholder="状态"
            value={searchParams.status || undefined}
            onChange={(v) => setSearchParams((p) => ({ ...p, status: (v as string) ?? '' }))}
            style={{ width: 140 }}
            optionList={[
              { value: '', label: '全部' },
              { value: 'active', label: '启用' },
              { value: 'disabled', label: '禁用' },
            ]}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        </>}
        right={<Space>
          <Button icon={<Download size={14} />} loading={exportLoading} onClick={handleExport}>导出</Button>
          {hasPermission('system:cronjob:create') && (
            <Button type="secondary" icon={<Plus size={14} />} onClick={() => { setEditingJob(null); setCronExprValue(''); setModalVisible(true); }}>新增</Button>
          )}
        </Space>}
      />

      <Table
        bordered
        className="admin-table-nowrap"
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: handlePageChange,
        }}
        empty="暂无数据"
      />

      <Modal
        title={editingJob ? '编辑定时任务' : '新增定时任务'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingJob(null); setCronExprValue(''); }}
        onOk={handleModalOk}
        width={560}
      >
        <Form
          key={editingJob?.id ?? 'new-job'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={120}
          onValueChange={(v: Record<string, unknown>) => {
            if (typeof v.cronExpression === 'string') setCronExprValue(v.cronExpression);
          }}
        >
          <Form.Input field="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]} />
          <Form.Input
            field="cronExpression"
            label="Cron 表达式"
            rules={[{ required: true, message: '请输入 Cron 表达式' }]}
            placeholder="如 0 */5 * * * *"
            addonAfter={
              <CronBuilderPopover
                value={cronExprValue}
                onApply={(expr) => {
                  formApi.current?.setValue('cronExpression', expr);
                  setCronExprValue(expr);
                }}
              />
            }
          />
          <Form.Select
            field="handler"
            label="处理器"
            rules={[{ required: true, message: '请选择处理器' }]}
            optionList={handlers.map((h) => ({ value: h, label: h }))}
            style={{ width: '100%' }}
            filter
          />
          <Form.TextArea field="params" label="参数(JSON)" placeholder='可选，如 {"key":"value"}' />
          <Form.Select
            field="status"
            label="状态"
            optionList={[
              { value: 'active', label: '启用' },
              { value: 'disabled', label: '禁用' },
            ]}
            style={{ width: '100%' }}
          />
          <Form.TextArea field="description" label="描述" maxCount={256} />
        </Form>
      </Modal>

      {/* 执行日志抽屉 */}
      <SideSheet
        title={`执行日志 — ${logsJobName}`}
        visible={logsDrawerVisible}
        onCancel={() => setLogsDrawerVisible(false)}
        width={760}
        closeOnEsc
      >
        <Table
          bordered
          size="small"
          rowKey="id"
          loading={logsLoading}
          dataSource={logsData}
          columns={[
            {
              title: '开始时间',
              dataIndex: 'startedAt',
              width: 180,
              render: (v: string) => formatDateTime(v),
            },
            {
              title: '结束时间',
              dataIndex: 'endedAt',
              width: 180,
              render: (v: string | null) => v ? formatDateTime(v) : '—',
            },
            {
              title: '耗时(ms)',
              dataIndex: 'durationMs',
              width: 90,
              render: (v: number | null) => v ?? '—',
            },
            {
              title: '状态',
              dataIndex: 'status',
              width: 80,
              render: (v: string) => (
                <Tag color={runStatusColor[v] ?? 'grey'} size="small">
                  {({'success': '成功', 'fail': '失败', 'running': '运行中'} as Record<string, string>)[v] ?? v}
                </Tag>
              ),
            },
            {
              title: '输出',
              dataIndex: 'output',
              ellipsis: true,
              render: (v: string | null) => v || '—',
            },
          ]}
          pagination={{
            currentPage: logsPage,
            pageSize: logsPageSize,
            total: logsTotal,
            onPageChange: (p) => {
              if (logsJobId != null) void fetchJobLogs(logsJobId, p);
            },
            showTotal: true,
          }}
        />
      </SideSheet>
    </div>
  );
}
