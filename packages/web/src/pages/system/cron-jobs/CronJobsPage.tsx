import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Col,
  Dropdown,
  Row,
  SideSheet,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tag,
  Typography,
  Toast,
  Tooltip,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, Download, ScrollText, MoreHorizontal } from 'lucide-react';
import type { CronJob, PaginatedResponse } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';

interface SearchParams {
  keyword: string;
  status: string;
}

interface CronJobLog {
  id: number;
  jobId: number;
  jobName: string;
  executionCount: number;
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
  const [pageSize, setPageSize] = useState(10);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [modalDetailLoading, setModalDetailLoading] = useState(false);
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
  const [allLogsDrawerVisible, setAllLogsDrawerVisible] = useState(false);
  const [allLogsData, setAllLogsData] = useState<CronJobLog[]>([]);
  const [allLogsTotal, setAllLogsTotal] = useState(0);
  const [allLogsPage, setAllLogsPage] = useState(1);
  const [allLogsLoading, setAllLogsLoading] = useState(false);
  const [allLogsJobFilter, setAllLogsJobFilter] = useState<number | null>(null);
  const [switchLoadingIds, setSwitchLoadingIds] = useState<Set<number>>(new Set());
  const [openMoreId, setOpenMoreId] = useState<number | null>(null);

  const fetchData = useCallback(async (p = page, ps = pageSize, params = searchParams) => {
    setLoading(true);
    try {
      const query = new URLSearchParams({
        page: String(p),
        pageSize: String(ps),
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

  const handleSearch = () => { setPage(1); void fetchData(1, pageSize); };
  const handleReset = () => { setSearchParams(defaultSearchParams); setPage(1); void fetchData(1, pageSize, defaultSearchParams); };
  const handlePageChange = (p: number) => { setPage(p); void fetchData(p, pageSize); };

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

  const openEdit = async (record: CronJob) => {
    setEditingJob(record);
    setCronExprValue(record.cronExpression ?? '');
    setModalVisible(true);
    setModalDetailLoading(true);
    const res = await request.get<CronJob>(`/api/cron-jobs/${record.id}`);
    setModalDetailLoading(false);
    if (res.code === 0 && res.data) {
      setEditingJob(res.data);
      setCronExprValue(res.data.cronExpression ?? '');
    } else {
      Toast.error(res.message || '获取信息失败');
    }
  };

  const handleToggleStatus = async (id: number, currentStatus: string) => {
    const newStatus = currentStatus === 'enabled' ? 'disabled' : 'enabled';
    setSwitchLoadingIds((prev) => new Set([...prev, id]));
    try {
      const res = await request.put(`/api/cron-jobs/${id}/status`, { status: newStatus });
      if (res.code === 0) {
        Toast.success(newStatus === 'enabled' ? '已启用' : '已禁用');
        void fetchData();
      }
    } finally {
      setSwitchLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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

  const fetchAllLogs = useCallback(async (p = 1, jobId: number | null = allLogsJobFilter) => {
    setAllLogsLoading(true);
    try {
      const params: Record<string, string> = { page: String(p), pageSize: String(logsPageSize) };
      if (jobId) params.jobId = String(jobId);
      const query = new URLSearchParams(params).toString();
      const res = await request.get<PaginatedResponse<CronJobLog>>(`/api/cron-jobs/logs?${query}`);
      if (res.code === 0) {
        setAllLogsData(res.data.list);
        setAllLogsTotal(res.data.total);
        setAllLogsPage(res.data.page);
      }
    } finally {
      setAllLogsLoading(false);
    }
  }, [logsPageSize, allLogsJobFilter]);

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
        retryCount: editingJob.retryCount,
        retryInterval: editingJob.retryInterval,
        monitorTimeout: editingJob.monitorTimeout,
      }
    : { status: 'enabled', retryCount: 0, retryInterval: 0 };

  const runStatusColor: Record<string, import('@douyinfe/semi-ui/lib/es/tag/interface').TagColor> = {
    success: 'green',
    fail: 'red',
    running: 'blue',
  };

  const lastRunStatusLabel: Record<string, string> = { success: '成功', fail: '失败', running: '运行中' };

  const columns: ColumnProps<CronJob>[] = [
    { title: '任务名称', dataIndex: 'name', width: 180, render: (v: unknown) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v != null ? String(v) : '—'}</Typography.Text> },
    {
      title: 'Cron 表达式', dataIndex: 'cronExpression', width: 150,
      render: (v: string) => (
        <Tooltip content={v} position="top">
          <span style={{ fontFamily: 'monospace', cursor: 'default' }}>{v}</span>
        </Tooltip>
      ),
    },
    { title: '处理器', dataIndex: 'handler', width: 180, render: (v: unknown) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v != null ? String(v) : '—'}</Typography.Text> },
    {
      title: '上次执行',
      width: 175,
      render: (_: unknown, record: CronJob) => {
        if (!record.lastRunStatus) return '—';
        return (
          <div>
            <Tag color={runStatusColor[record.lastRunStatus] ?? 'grey'} size="small">
              {lastRunStatusLabel[record.lastRunStatus] ?? record.lastRunStatus}
            </Tag>
            {record.lastRunAt && (
              <div style={{ fontSize: 11, color: 'var(--semi-color-text-2)', marginTop: 2 }}>
                {formatDateTime(record.lastRunAt)}
              </div>
            )}
          </div>
        );
      },
    },
    { title: '描述', dataIndex: 'description', width: 200, render: (v: unknown) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v != null ? String(v) : '—'}</Typography.Text> },
    {
      title: '启用',
      dataIndex: 'status',
      width: 70,
      fixed: 'right',
      render: (v: string, record: CronJob) => (
        <Switch
          checked={v === 'enabled'}
          loading={switchLoadingIds.has(record.id)}
          size="small"
          onChange={() => { void handleToggleStatus(record.id, v); }}
          disabled={!hasPermission('system:cronjob:update')}
        />
      ),
    },
    {
      title: '操作',
      fixed: 'right',
      width: 220,
      render: (_: unknown, record: CronJob) => (
        <Space>
          {hasPermission('system:cronjob:execute') && (
            <Button theme="borderless" size="small" onClick={() => handleRunOnce(record.id, record.name)}>
              执行
            </Button>
          )}
          {hasPermission('system:cronjob:update') && (
            <Button theme="borderless" size="small" onClick={() => { void openEdit(record); }}>
              编辑
            </Button>
          )}
          {hasPermission('system:cronjob:delete') && (
            <Button
              theme="borderless"
              type="danger"
              size="small"
              onClick={() => {
                Modal.confirm({
                  title: '确定要删除此任务吗？',
                  okButtonProps: { type: 'danger', theme: 'solid' },
                  onOk: () => handleDelete(record.id),
                });
              }}
            >删除</Button>
          )}
          {hasPermission('system:cronjob:list') && (
            <Dropdown
              trigger="custom"
              visible={openMoreId === record.id}
              onClickOutSide={() => setOpenMoreId(null)}
              position="bottomRight"
              render={
                <Dropdown.Menu>
                  <Dropdown.Item onClick={() => { setOpenMoreId(null); openLogsDrawer(record); }}>执行日志</Dropdown.Item>
                </Dropdown.Menu>
              }
            >
              <Button
                theme="borderless"
                size="small"
                icon={<MoreHorizontal size={14} />}
                onClick={() => setOpenMoreId(openMoreId === record.id ? null : record.id)}
              />
            </Dropdown>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
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
              { value: 'enabled', label: '启用' },
              { value: 'disabled', label: '禁用' },
            ]}
          />
          <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
          <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
          <Button icon={<ScrollText size={14} />} onClick={() => { setAllLogsPage(1); setAllLogsJobFilter(null); setAllLogsDrawerVisible(true); void fetchAllLogs(1, null); }}>全部执行日志</Button>
          <Button type="primary" icon={<Download size={14} />} loading={exportLoading} onClick={handleExport}>导出</Button>
          {hasPermission('system:cronjob:create') && (
            <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingJob(null); setCronExprValue(''); setModalVisible(true); }}>新增</Button>
          )}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        pagination={{
          currentPage: page,
          pageSize,
          total,
          onPageChange: handlePageChange,
          onPageSizeChange: (size) => { setPageSize(size); void fetchData(1, size); },
          showSizeChanger: true,
        }}
        empty="暂无数据"
      />

      <Modal
        title={editingJob ? '编辑定时任务' : '新增定时任务'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingJob(null); setCronExprValue(''); setModalDetailLoading(false); }}
        onOk={handleModalOk}
        okButtonProps={{ disabled: modalDetailLoading }}
        width={720}
      >
        <Spin spinning={modalDetailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={editingJob?.id ?? 'new-job'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={110}
          onValueChange={(v: Record<string, unknown>) => {
            if (typeof v.cronExpression === 'string') setCronExprValue(v.cronExpression);
          }}
        >
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="任务名称" placeholder="请输入任务名称" rules={[{ required: true, message: '请输入任务名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Select
                field="status"
                label="状态"
                optionList={[
                  { value: 'enabled', label: '启用' },
                  { value: 'disabled', label: '禁用' },
                ]}
                style={{ width: '100%' }}
              />
            </Col>
          </Row>
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
            placeholder="请选择处理器"
          />
          <Row gutter={16}>
            <Col span={12}>
              <Form.InputNumber
                field="retryCount"
                label="重试次数"
                rules={[{ required: true, message: '请输入重试次数' }]}
                placeholder="0 表示不重试"
                min={0}
                max={10}
                style={{ width: '100%' }}
              />
            </Col>
            <Col span={12}>
              <Form.InputNumber
                field="retryInterval"
                label="重试间隔(ms)"
                rules={[{ required: true, message: '请输入重试间隔' }]}
                placeholder="0 表示无间隔"
                min={0}
                style={{ width: '100%' }}
              />
            </Col>
            <Col span={12}>
              <Form.InputNumber
                field="monitorTimeout"
                label="监控超时(ms)"
                placeholder="可选，超时报警阈值"
                min={0}
                style={{ width: '100%' }}
              />
            </Col>
          </Row>
          <Form.TextArea field="params" label="参数 JSON" placeholder='可选，如 {"key":"value"}' rows={2} />
          <Form.TextArea field="description" label="描述" placeholder="请输入描述" maxCount={256} rows={2} />
        </Form>
        </Spin>
      </Modal>

      {/* 全量执行日志抽屉 */}
      <SideSheet
        title="全部执行日志"
        visible={allLogsDrawerVisible}
        onCancel={() => { setAllLogsDrawerVisible(false); setAllLogsJobFilter(null); }}
        width={1060}
        closeOnEsc
      >
        <div style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
          <Select
            placeholder="过滤任务"
            value={allLogsJobFilter ?? undefined}
            onChange={(v) => {
              const jobId = (v as number | undefined) ?? null;
              setAllLogsJobFilter(jobId);
              setAllLogsPage(1);
              void fetchAllLogs(1, jobId);
            }}
            style={{ width: 220 }}
            showClear
            optionList={data.map((job) => ({ value: job.id, label: job.name }))}
          />
        </div>
        <Table
          bordered
          size="small"
          rowKey="id"
          loading={allLogsLoading}
          dataSource={allLogsData}
          scroll={{ x: 'max-content' }}
          columns={[
            {
              title: '任务名称',
              dataIndex: 'jobName',
              width: 160,
              render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v || '—'}</Typography.Text>,
            },
            {
              title: '第几次执行',
              dataIndex: 'executionCount',
              width: 100,
            },
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
              width: 260,
              render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v || '—'}</Typography.Text>,
            },
          ]}
          pagination={{
            currentPage: allLogsPage,
            pageSize: logsPageSize,
            total: allLogsTotal,
            onPageChange: (p) => { setAllLogsPage(p); void fetchAllLogs(p, allLogsJobFilter); },
            showTotal: true,
          }}
        />
      </SideSheet>

      {/* 执行日志抽屉 */}
      <SideSheet
        title={`执行日志 — ${logsJobName}`}
        visible={logsDrawerVisible}
        onCancel={() => setLogsDrawerVisible(false)}
        width={900}
        closeOnEsc
      >
        <Table
          bordered
          size="small"
          rowKey="id"
          loading={logsLoading}
          dataSource={logsData}
          scroll={{ x: 'max-content' }}
          columns={[
            {
              title: '第几次执行',
              dataIndex: 'executionCount',
              width: 100,
            },
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
              width: 270,
              render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>{v || '—'}</Typography.Text>,
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
