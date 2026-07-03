import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Col,
  Dropdown,
  SplitButtonGroup,
  Row,
  SideSheet,
  Form,
  Input,
  Modal,
  Popover,
  Select,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Toast,
  Tooltip,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, Plus, RotateCcw, ScrollText, Trash2, ChevronDown, HelpCircle } from 'lucide-react';
import type { CronJob } from '@zenith/shared';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { CronExpressionParser } from 'cron-parser';
import dayjs from 'dayjs';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import { SearchToolbar } from '@/components/SearchToolbar';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePagination } from '@/hooks/usePagination';
import { renderEllipsis } from '../../../utils/table-columns';
import CronJobDashboard from './CronJobDashboard';
import {
  cronJobKeys,
  useClearCronJobLogs,
  useCronJobAllLogs,
  useCronJobDetail,
  useCronJobHandlers,
  useCronJobList,
  useCronJobLogs,
  useDeleteCronJob,
  useRunCronJob,
  useSaveCronJob,
  useUpdateCronJobStatus,
} from '@/hooks/queries/cron-jobs';

interface SearchParams {
  keyword: string;
  status: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

export default function CronJobsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJob | null>(null);
  const [cronExprValue, setCronExprValue] = useState('');
  const [logsDrawerVisible, setLogsDrawerVisible] = useState(false);
  const [logsJobName, setLogsJobName] = useState('');
  const [logsJobId, setLogsJobId] = useState<number | null>(null);
  const [logsPage, setLogsPage] = useState(1);
  const logsPageSize = 20;
  const [allLogsDrawerVisible, setAllLogsDrawerVisible] = useState(false);
  const [allLogsPage, setAllLogsPage] = useState(1);
  const [allLogsJobFilter, setAllLogsJobFilter] = useState<number | null>(null);
  const listQuery = useCronJobList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const handlersQuery = useCronJobHandlers();
  const handlers = handlersQuery.data ?? [];
  const detailQuery = useCronJobDetail(editingJob?.id, modalVisible && !!editingJob);
  const modalDetailLoading = !!editingJob && detailQuery.isFetching;
  const jobLogsQuery = useCronJobLogs({ jobId: logsJobId ?? 0, page: logsPage, pageSize: logsPageSize }, logsDrawerVisible && logsJobId != null);
  const allLogsQuery = useCronJobAllLogs({
    page: allLogsPage,
    pageSize: logsPageSize,
    jobId: allLogsJobFilter ?? undefined,
  }, allLogsDrawerVisible);

  const saveMutation = useSaveCronJob();
  const deleteMutation = useDeleteCronJob();
  const runMutation = useRunCronJob();
  const toggleStatusMutation = useUpdateCronJobStatus();
  const clearLogsMutation = useClearCronJobLogs();
  const switchLoadingId = toggleStatusMutation.isPending ? (toggleStatusMutation.variables?.id ?? null) : null;

  useEffect(() => {
    if (!modalVisible || !detailQuery.data) return;
    setEditingJob(detailQuery.data);
    setCronExprValue(detailQuery.data.cronExpression ?? '');
  }, [detailQuery.data, modalVisible]);

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: cronJobKeys.lists });
  };
  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: cronJobKeys.lists });
  };
  const buildExportQuery = () => ({
    ...(submittedParams.keyword ? { keyword: submittedParams.keyword } : {}),
    ...(submittedParams.status ? { status: submittedParams.status } : {}),
  });

  const handleRunOnce = (id: number, name: string) => {
    Modal.confirm({
      title: '确定要立即执行一次吗？',
      content: `任务：${name}`,
      onOk: async () => {
        await runMutation.mutateAsync(id);
        Toast.success('已触发执行');
      },
    });
  };

  const handleModalOk = async () => {
    let values;
    try { values = await formApi.current?.validate(); } catch { throw new Error('validation'); }

    await saveMutation.mutateAsync({ id: editingJob?.id, values: values as Partial<CronJob> });
    Toast.success(editingJob ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingJob(null);
    setCronExprValue('');
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  };

  const openEdit = (record: CronJob) => {
    setEditingJob(record);
    setCronExprValue(record.cronExpression ?? '');
    setModalVisible(true);
  };

  const handleToggleStatus = (id: number, currentStatus: string, name: string) => {
    const newStatus = currentStatus === 'enabled' ? 'disabled' : 'enabled';
    const doToggle = async () => {
      await toggleStatusMutation.mutateAsync({ id, status: newStatus });
      Toast.success(newStatus === 'enabled' ? '已启用' : '已暂停');
    };
    if (newStatus === 'disabled') {
      Modal.confirm({
        title: '暂停定时任务',
        content: `确定要暂停「${name}」吗？暂停后该任务将不再自动执行。`,
        okText: '暂停',
        okButtonProps: { type: 'warning' },
        cancelText: '取消',
        onOk: doToggle,
      });
    } else {
      void doToggle();
    }
  };

  const openLogsDrawer = (record: CronJob) => {
    setLogsJobId(record.id);
    setLogsJobName(record.name);
    setLogsPage(1);
    setLogsDrawerVisible(true);
  };

  const clearLogsLabels: Record<number, string> = { 0: '全部', 1: '一个月', 3: '三个月', 6: '六个月', 12: '一年' };

  const handleClearLogs = (months: number, jobId?: number | null) => {
    const label = months === 0 ? '全部' : `${clearLogsLabels[months]}前`;
    Modal.confirm({
      title: '确认清除日志',
      content: `将删除${label}的执行日志，此操作不可恢复，确认继续吗？`,
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await clearLogsMutation.mutateAsync({ months, jobId });
        Toast.success('清除成功');
        if (jobId !== null && jobId !== undefined) setLogsPage(1);
        else setAllLogsPage(1);
      },
    });
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
        retryBackoff: editingJob.retryBackoff,
        monitorTimeout: editingJob.monitorTimeout,
      }
    : { status: 'enabled', retryCount: 0, retryInterval: 0, retryBackoff: false };

  const runStatusColor: Record<string, import('@douyinfe/semi-ui/lib/es/tag/interface').TagColor> = {
    success: 'green',
    fail: 'red',
    running: 'blue',
  };

  const lastRunStatusLabel: Record<string, string> = { success: '成功', fail: '失败', running: '运行中' };

  const columns: ColumnProps<CronJob>[] = [
    { title: '任务名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    {
      title: 'Cron 表达式', dataIndex: 'cronExpression', width: 200,
      render: (v: string) => {
        let scheduleContent: React.ReactNode = '表达式无效';
        try {
          const interval = CronExpressionParser.parse(v);
          const times = Array.from({ length: 5 }, () => {
            const d = dayjs(interval.next().toDate());
            const dateStr = d.format('YYYY-MM-DD');
            const today = dayjs().format('YYYY-MM-DD');
            const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
            let prefix: string;
            if (dateStr === today) prefix = '今天';
            else if (dateStr === tomorrow) prefix = '明天';
            else prefix = d.format('MM-DD');
            return `${prefix} ${d.format('HH:mm:ss')}`;
          });
          scheduleContent = (
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <div style={{ marginBottom: 4, color: 'var(--semi-color-text-2)' }}>最近 5 次执行时间：</div>
              {times.map((t) => <div key={t} style={{ fontVariantNumeric: 'tabular-nums' }}>{t}</div>)}
            </div>
          );
        } catch { /* invalid */ }
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Tooltip content={v} position="top">
              <span style={{ fontFamily: 'monospace', cursor: 'default' }}>{v}</span>
            </Tooltip>
            <Popover
              content={scheduleContent}
              position="right"
              showArrow
              style={{ padding: '10px 14px', minWidth: 180 }}
            >
              <HelpCircle size={13} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0, cursor: 'help' }} />
            </Popover>
          </span>
        );
      },
    },
    { title: '处理器', dataIndex: 'handler', width: 220, render: renderEllipsis },
    {
      title: '上次执行',
      width: 200,
      render: (_: unknown, record: CronJob) => {
        if (!record.lastRunStatus) return '—';
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
            <Tag color={runStatusColor[record.lastRunStatus] ?? 'grey'} size="small">
              {lastRunStatusLabel[record.lastRunStatus] ?? record.lastRunStatus}
            </Tag>
            {record.lastRunAt && (
              <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', whiteSpace: 'nowrap' }}>
                {formatDateTime(record.lastRunAt)}
              </span>
            )}
          </span>
        );
      },
    },
    {
      title: '下次执行',
      dataIndex: 'cronExpression',
      width: 160,
      render: (expr: string, record: CronJob) => {
        if (record.status !== 'enabled') return <span style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>已停用</span>;
        try {
          const next = CronExpressionParser.parse(expr).next().toDate();
          const t = dayjs(next);
          const dateStr = t.format('YYYY-MM-DD');
          const today = dayjs().format('YYYY-MM-DD');
          const tomorrow = dayjs().add(1, 'day').format('YYYY-MM-DD');
          let prefix: string;
          if (dateStr === today) prefix = '今天';
          else if (dateStr === tomorrow) prefix = '明天';
          else prefix = t.format('MM-DD');
          return (
            <span style={{ fontSize: 12, color: 'var(--semi-color-text-1)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
              {prefix} {t.format('HH:mm:ss')}
            </span>
          );
        } catch {
          return <span style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>表达式无效</span>;
        }
      },
    },
    { title: '描述', dataIndex: 'description', width: 200, render: renderEllipsis },
    {
      title: '启用',
      dataIndex: 'status',
      width: 70,
      fixed: 'right',
      render: (v: string, record: CronJob) => (
        <Switch
          checked={v === 'enabled'}
          loading={switchLoadingId === record.id}
          size="small"
          onChange={() => { handleToggleStatus(record.id, v, record.name); }}
          disabled={!hasPermission('system:cronjob:update')}
        />
      ),
    },
    createOperationColumn<CronJob>({
      width: 240,
      desktopInlineKeys: ['execute', 'edit', 'delete'],
      actions: (record) => [
        {
          key: 'execute',
          label: '执行',
          hidden: !hasPermission('system:cronjob:execute'),
          onClick: () => handleRunOnce(record.id, record.name),
        },
        {
          key: 'edit',
          label: '编辑',
          hidden: !hasPermission('system:cronjob:update'),
          onClick: () => openEdit(record),
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !hasPermission('system:cronjob:delete'),
          onClick: () => {
            Modal.confirm({
              title: '确定要删除此任务吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => handleDelete(record.id),
            });
          },
        },
        {
          key: 'logs',
          label: '执行日志',
          hidden: !hasPermission('system:cronjob:list'),
          onClick: () => openLogsDrawer(record),
        },
      ],
    }),
  ];

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" lazyRender>
        <Tabs.TabPane tab="任务管理" itemKey="jobs">
          <SearchToolbar
            primary={(
              <>
                <Input
                  prefix={<Search size={14} />}
                  placeholder="搜索任务名称/处理器"
                  value={draftParams.keyword}
                  onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
                  onEnterPress={handleSearch}
                  style={{ width: 240 }}
                  showClear
                />
                <Select
                  placeholder="状态"
                  value={draftParams.status || undefined}
                  onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
                  style={{ width: 140 }}
                  optionList={[
                    { value: '', label: '全部' },
                    { value: 'enabled', label: '启用' },
                    { value: 'disabled', label: '禁用' },
                  ]}
                />
                <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
                <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
              </>
            )}
            actions={(
              <>
                <Button icon={<ScrollText size={14} />} onClick={() => { setAllLogsPage(1); setAllLogsJobFilter(null); setAllLogsDrawerVisible(true); }}>全部执行日志</Button>
                <ExportButton entity="system.cron-jobs" query={buildExportQuery()} />
                {hasPermission('system:cronjob:create') && (
                  <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingJob(null); setCronExprValue(''); setModalVisible(true); }}>新增</Button>
                )}
              </>
            )}
            mobilePrimary={(
              <>
                <Input
                  prefix={<Search size={14} />}
                  placeholder="搜索任务名称/处理器"
                  value={draftParams.keyword}
                  onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))}
                  onEnterPress={handleSearch}
                  style={{ width: 240 }}
                  showClear
                />
                <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
                {hasPermission('system:cronjob:create') && (
                  <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingJob(null); setCronExprValue(''); setModalVisible(true); }}>新增</Button>
                )}
              </>
            )}
            mobileFilters={(
              <Select
                placeholder="状态"
                value={draftParams.status || undefined}
                onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
                style={{ width: 140 }}
                optionList={[
                  { value: '', label: '全部' },
                  { value: 'enabled', label: '启用' },
                  { value: 'disabled', label: '禁用' },
                ]}
              />
            )}
            mobileActions={(
              <>
                <Button icon={<ScrollText size={14} />} onClick={() => { setAllLogsPage(1); setAllLogsJobFilter(null); setAllLogsDrawerVisible(true); }}>全部执行日志</Button>
                <ExportButton entity="system.cron-jobs" query={buildExportQuery()} variant="flat" />
              </>
            )}
            filterTitle="定时任务筛选"
            actionTitle="定时任务操作"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
          />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={data}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        rowKey="id"
        pagination={buildPagination(total)}
        empty="暂无数据"
      />
        </Tabs.TabPane>
        <Tabs.TabPane tab="执行概览" itemKey="dashboard">
          <CronJobDashboard jobs={data} />
        </Tabs.TabPane>
      </Tabs>

      <AppModal
        title={editingJob ? '编辑定时任务' : '新增定时任务'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditingJob(null); setCronExprValue(''); }}
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
                label="重试间隔(秒)"
                rules={[{ required: true, message: '请输入重试间隔' }]}
                placeholder="0 表示无间隔"
                min={0}
                style={{ width: '100%' }}
              />
            </Col>
            <Col span={12}>
              <Form.Switch field="retryBackoff" label="指数退避重试" />
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
      </AppModal>

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
            }}
            style={{ width: 220 }}
            showClear
            optionList={data.map((job) => ({ value: job.id, label: job.name }))}
          />
          {hasPermission('system:cronjob:delete') && (
            <SplitButtonGroup>
              <Button icon={<Trash2 size={14} />} type="danger" theme="light" loading={clearLogsMutation.isPending} onClick={() => handleClearLogs(12, null)}>清除日志</Button>
              <Dropdown
                trigger="click"
                position="bottomRight"
                clickToHide
                render={
                  <Dropdown.Menu>
                    {([12, 6, 3, 1] as const).map((m) => (
                      <Dropdown.Item key={m} onClick={() => handleClearLogs(m, null)}>
                        清除{clearLogsLabels[m]}前的日志
                      </Dropdown.Item>
                    ))}
                    <Dropdown.Divider />
                    <Dropdown.Item type="danger" onClick={() => handleClearLogs(0, null)}>清除全部日志</Dropdown.Item>
                  </Dropdown.Menu>
                }
              >
                <Button type="danger" theme="light" icon={<ChevronDown size={14} />} />
              </Dropdown>
            </SplitButtonGroup>
          )}
        </div>
        <Table
          bordered
          size="small"
          rowKey="id"
          loading={allLogsQuery.isFetching}
          dataSource={allLogsQuery.data?.list ?? []}
          scroll={{ x: 'max-content' }}
          columns={[
            {
              title: '任务名称',
              dataIndex: 'jobName',
              width: 160,
              render: renderEllipsis,
            },
            {
              title: '执行次数',
              dataIndex: 'executionCount',
              width: 90,
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
              title: '耗时 ms',
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
              render: renderEllipsis,
            },
          ]}
          pagination={{
            currentPage: allLogsPage,
            pageSize: logsPageSize,
            total: allLogsQuery.data?.total ?? 0,
            onPageChange: (p) => { setAllLogsPage(p); },
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
        {hasPermission('system:cronjob:delete') && (
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <SplitButtonGroup>
              <Button icon={<Trash2 size={14} />} type="danger" theme="light" loading={clearLogsMutation.isPending} onClick={() => handleClearLogs(12, logsJobId)}>清除日志</Button>
              <Dropdown
                trigger="click"
                position="bottomRight"
                clickToHide
                render={
                  <Dropdown.Menu>
                    {([12, 6, 3, 1] as const).map((m) => (
                      <Dropdown.Item key={m} onClick={() => handleClearLogs(m, logsJobId)}>
                        清除{clearLogsLabels[m]}前的日志
                      </Dropdown.Item>
                    ))}
                    <Dropdown.Divider />
                    <Dropdown.Item type="danger" onClick={() => handleClearLogs(0, logsJobId)}>清除全部日志</Dropdown.Item>
                  </Dropdown.Menu>
                }
              >
                <Button type="danger" theme="light" icon={<ChevronDown size={14} />} />
              </Dropdown>
            </SplitButtonGroup>
          </div>
        )}
        <Table
          bordered
          size="small"
          rowKey="id"
          loading={jobLogsQuery.isFetching}
          dataSource={jobLogsQuery.data?.list ?? []}
          scroll={{ x: 'max-content' }}
          columns={[
            {
              title: '执行次数',
              dataIndex: 'executionCount',
              width: 90,
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
              title: '耗时 ms',
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
              render: renderEllipsis,
            },
          ]}
          pagination={{
            currentPage: logsPage,
            pageSize: logsPageSize,
            total: jobLogsQuery.data?.total ?? 0,
            onPageChange: (p) => {
              setLogsPage(p);
            },
            showTotal: true,
          }}
        />
      </SideSheet>
    </div>
  );
}
