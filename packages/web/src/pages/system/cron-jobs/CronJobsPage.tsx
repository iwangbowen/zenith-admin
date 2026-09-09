import { useEffect, useState } from 'react';
import { Button, Col, Dropdown, SplitButtonGroup, Row, SideSheet, Form, Modal, Popover, Space, Spin, Table, Tabs, Tag, Toast, Tooltip } from '@douyinfe/semi-ui';
import { ScrollText, Trash2, ChevronDown, HelpCircle } from 'lucide-react';
import type { CreateCronJobInput, CronJob } from '@zenith/shared/platform';
import { CRON_RUN_STATUS_LABELS } from '@zenith/shared/platform';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { formatDateTime } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { CronExpressionParser } from 'cron-parser';
import dayjs from 'dayjs';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import ExportButton from '@/components/ExportButton';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { TABLE_PAGE_SIZE_OPTIONS, usePagination } from '@/hooks/usePagination';
import { dateTimeColumn, renderEllipsis } from '../../../utils/table-columns';
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
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { useEditModal } from '@/hooks/useEditModal';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDanger } from '@/utils/confirm';
import { CLEAR_LOGS_LABELS } from '@/hooks/useClearLogs';

import { useUrlTabState } from '@/hooks/useUrlTabState';
import { compactQuery } from '@/lib/query';
interface SearchParams {
  keyword: string;
  status?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', status: '' };

const runStatusColor: Record<string, import('@douyinfe/semi-ui/lib/es/tag/interface').TagColor> = {
  success: 'green',
  fail: 'red',
  running: 'blue',
};

const runStatusLabel: Record<string, string> = CRON_RUN_STATUS_LABELS;

/** 执行日志表格公共列（两个日志抽屉共用） */
const buildRunLogColumns = (outputWidth: number) => [
  {
    title: '执行次数',
    align: 'right' as const,
    dataIndex: 'executionCount',
    width: 90,
  },
  dateTimeColumn('开始时间', 'startedAt'),
  dateTimeColumn('结束时间', 'endedAt'),
  {
    title: '耗时 ms',
    align: 'right' as const,
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
        {runStatusLabel[v] ?? v}
      </Tag>
    ),
  },
  {
    title: '输出',
    dataIndex: 'output',
    width: outputWidth,
    render: renderEllipsis,
  },
];

export default function CronJobsPage() {
  const [activeTab, setActiveTab] = useUrlTabState(['jobs', 'dashboard'] as const, 'jobs');
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setField, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: cronJobKeys.lists });
  const [cronExprValue, setCronExprValue] = useState('');
  const [logsDrawerVisible, setLogsDrawerVisible] = useState(false);
  const [logsJobName, setLogsJobName] = useState('');
  const [logsJobId, setLogsJobId] = useState<number | null>(null);
  const {
    page: logsPage,
    pageSize: logsPageSize,
    setPage: setLogsPage,
    buildPagination: buildLogsPagination,
  } = usePagination(20);
  const [allLogsDrawerVisible, setAllLogsDrawerVisible] = useState(false);
  const {
    page: allLogsPage,
    pageSize: allLogsPageSize,
    setPage: setAllLogsPage,
    buildPagination: buildAllLogsPagination,
  } = usePagination(20);
  const [allLogsJobFilter, setAllLogsJobFilter] = useState<number | null>(null);
  // 列表端点只支持 keyword 检索；状态筛选值仅进入导出条件
  const listQuery = useCronJobList({
    page,
    pageSize,
    keyword: submittedParams.keyword || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const handlersQuery = useCronJobHandlers();
  const handlers = handlersQuery.data ?? [];
  const jobLogsQuery = useCronJobLogs({ jobId: logsJobId ?? 0, page: logsPage, pageSize: logsPageSize }, logsDrawerVisible && logsJobId != null);
  const allLogsQuery = useCronJobAllLogs({
    page: allLogsPage,
    pageSize: allLogsPageSize,
    jobId: allLogsJobFilter ?? undefined,
  }, allLogsDrawerVisible);

  const saveMutation = useSaveCronJob();
  const modal = useEditModal<CronJob, Partial<CreateCronJobInput>>({
    entityName: '定时任务',
    save: saveMutation,
    useDetail: useCronJobDetail,
    defaults: { status: 'enabled', retryCount: 0, retryInterval: 0, retryBackoff: false },
    toValues: (job) => ({
      name: job.name,
      cronExpression: job.cronExpression,
      handler: job.handler,
      params: job.params,
      status: job.status,
      description: job.description,
      retryCount: job.retryCount,
      retryInterval: job.retryInterval,
      retryBackoff: job.retryBackoff,
      monitorTimeout: job.monitorTimeout,
    }),
    labelWidth: 110,
  });
  const deleteMutation = useDeleteCronJob();
  const runMutation = useRunCronJob();
  const toggleStatusMutation = useUpdateCronJobStatus();
  const clearLogsMutation = useClearCronJobLogs();
  const status = useStatusToggle<CronJob>({
    toggle: (job, enabled) => toggleStatusMutation.mutateAsync({ params: { id: job.id }, body: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (job) => ({
      title: '暂停定时任务',
      content: `确定要暂停「${job.name}」吗？暂停后该任务将不再自动执行。`,
      okText: '暂停',
      okButtonProps: { type: 'warning' },
      cancelText: '取消',
    }),
    disabled: !hasPermission('system:cronjob:update'),
    messages: { disabled: '已暂停' },
  });

  useEffect(() => {
    if (modal.visible && modal.editing) setCronExprValue(modal.editing.cronExpression ?? '');
  }, [modal.visible, modal.editing]);

  const buildExportQuery = () => compactQuery({
    keyword: submittedParams.keyword,
    status: submittedParams.status,
  });

  const handleRunOnce = (id: number, name: string) => {
    Modal.confirm({
      title: '确定要立即执行一次吗？',
      content: `任务：${name}`,
      onOk: async () => {
        await runMutation.mutateAsync({ params: { id } });
        Toast.success('已触发执行');
      },
    });
  };

  const openCreate = () => {
    setCronExprValue('');
    modal.openCreate();
  };

  const openEdit = (record: CronJob) => {
    setCronExprValue(record.cronExpression ?? '');
    modal.openEdit(record);
  };

  const openLogsDrawer = (record: CronJob) => {
    setLogsJobId(record.id);
    setLogsJobName(record.name);
    setLogsPage(1);
    setLogsDrawerVisible(true);
  };


  const handleClearLogs = (days: number, jobId?: number | null) => {
    const label = CLEAR_LOGS_LABELS[days] ?? `${days} 天前`;
    confirmDanger({
      title: '确认清除日志',
      content: `将删除${label}的执行日志，此操作不可恢复，确认继续吗？`,
      onOk: async () => {
        await clearLogsMutation.mutateAsync({ days, jobId });
        Toast.success('清除成功');
        if (jobId !== null && jobId !== undefined) setLogsPage(1);
        else setAllLogsPage(1);
      },
    });
  };

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
          <Space spacing={4}>
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
          </Space>
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
          <Space spacing={6}>
            <Tag color={runStatusColor[record.lastRunStatus] ?? 'grey'} size="small">
              {runStatusLabel[record.lastRunStatus] ?? record.lastRunStatus}
            </Tag>
            {record.lastRunAt && (
              <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', whiteSpace: 'nowrap' }}>
                {formatDateTime(record.lastRunAt)}
              </span>
            )}
          </Space>
        );
      },
    },
    {
      title: '下次执行',
      dataIndex: 'nextRunAt',
      width: 160,
      render: (_: unknown, record: CronJob) => {
        if (record.status !== 'enabled') return <span style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>已停用</span>;
        try {
          const next = CronExpressionParser.parse(record.cronExpression).next().toDate();
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
    { title: '描述', dataIndex: 'description', minWidth: 200, render: renderEllipsis },
    status.column({ title: '启用' }),
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
        deleteAction({
          hidden: !hasPermission('system:cronjob:delete'),
          title: '确定要删除此任务吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
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
      <Tabs collapsible="auto" type="line" lazyRender activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
        <Tabs.TabPane tab="任务管理" itemKey="jobs">
          <ListSearchToolbar
            keyword={<KeywordInput placeholder="搜索任务名称/处理器" value={draftParams.keyword} onChange={setField('keyword')} onSearch={handleSearch} width={240} />}
            filters={(
              <StatusSelect
                items={statusItems}
                value={draftParams.status}
                onChange={setField('status')}
              />
            )}
            onSearch={handleSearch}
            onReset={handleReset}
            create={hasPermission('system:cronjob:create') && <CreateButton onClick={openCreate} />}
            actions={(
              <>
                <Button icon={<ScrollText size={14} />} onClick={() => { setAllLogsPage(1); setAllLogsJobFilter(null); setAllLogsDrawerVisible(true); }}>全部执行日志</Button>
                <ExportButton entity="system.cron-jobs" query={buildExportQuery()} />
              </>
            )}
            mobileActions={(
              <>
                <Button icon={<ScrollText size={14} />} onClick={() => { setAllLogsPage(1); setAllLogsJobFilter(null); setAllLogsDrawerVisible(true); }}>全部执行日志</Button>
                <ExportButton entity="system.cron-jobs" query={buildExportQuery()} variant="flat" />
              </>
            )}
            filterTitle="定时任务筛选"
            actionTitle="定时任务操作"
          />

      <ConfigurableTable<CronJob>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无数据' })}
      />
        </Tabs.TabPane>
        <Tabs.TabPane tab="执行概览" itemKey="dashboard">
          <CronJobDashboard jobs={data} />
        </Tabs.TabPane>
      </Tabs>

      <AppModal
        {...modal.modalProps}
        width={720}
      >
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
        <Form
          key={modal.formKey} {...modal.formProps}
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
                optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
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
                  modal.formApi.current?.setValue('cronExpression', expr);
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
          <FilterSelect
            placeholder="全部过滤任务"
            items={data.map((job) => ({ value: job.id, label: job.name }))}
            value={allLogsJobFilter ?? undefined}
            onChange={(v) => {
              const jobId = v ?? null;
              setAllLogsJobFilter(jobId);
              setAllLogsPage(1);
            }}
            width={220}
          />
          {hasPermission('system:cronjob:delete') && (
            <SplitButtonGroup>
              <Button icon={<Trash2 size={14} />} type="danger" theme="light" loading={clearLogsMutation.isPending} onClick={() => handleClearLogs(365, null)}>清除日志</Button>
              <Dropdown
                trigger="click"
                position="bottomRight"
                clickToHide
                render={
                  <Dropdown.Menu>
                    {([365, 180, 90, 30] as const).map((m) => (
                      <Dropdown.Item key={m} onClick={() => handleClearLogs(m, null)}>
                        清除{CLEAR_LOGS_LABELS[m]}的日志
                      </Dropdown.Item>
                    ))}
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
            ...buildRunLogColumns(260),
          ]}
          pagination={{
            ...buildAllLogsPagination(allLogsQuery.data?.total ?? 0),
            showSizeChanger: true,
            pageSizeOpts: TABLE_PAGE_SIZE_OPTIONS,
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
              <Button icon={<Trash2 size={14} />} type="danger" theme="light" loading={clearLogsMutation.isPending} onClick={() => handleClearLogs(365, logsJobId)}>清除日志</Button>
              <Dropdown
                trigger="click"
                position="bottomRight"
                clickToHide
                render={
                  <Dropdown.Menu>
                    {([365, 180, 90, 30] as const).map((m) => (
                      <Dropdown.Item key={m} onClick={() => handleClearLogs(m, logsJobId)}>
                        清除{CLEAR_LOGS_LABELS[m]}的日志
                      </Dropdown.Item>
                    ))}
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
          columns={buildRunLogColumns(270)}
          pagination={{
            ...buildLogsPagination(jobLogsQuery.data?.total ?? 0),
            showSizeChanger: true,
            pageSizeOpts: TABLE_PAGE_SIZE_OPTIONS,
            showTotal: true,
          }}
        />
      </SideSheet>
    </div>
  );
}
