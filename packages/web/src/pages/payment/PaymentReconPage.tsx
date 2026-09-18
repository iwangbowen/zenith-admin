import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrayField, Banner, Button, DatePicker, Descriptions, Empty, Form, Select, SideSheet, Space, Spin, Tabs, Tag, Toast, Typography, Upload } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { BodyOf } from '@zenith/shared/core';
import {
  formatReconciliationAmount, isUnresolvedReconciliationCase, paymentReconContract, PAYMENT_CHANNEL_LABELS, PAYMENT_RECON_ADJUSTMENT_STATUS_LABELS,
  PAYMENT_RECON_CASE_ACTION_OPTIONS, PAYMENT_RECON_CASE_STATUS_LABELS, PAYMENT_RECON_CASE_TYPE_LABELS, PAYMENT_RECON_DIRECTION_OPTIONS,
  PAYMENT_RECON_MAX_FILE_BYTES, PAYMENT_RECON_RUN_STATUS_LABELS, PAYMENT_STATEMENT_ENTRY_TYPE_LABELS, PAYMENT_STATEMENT_IMPORT_FORMAT_OPTIONS,
  PAYMENT_STATEMENT_PERIOD_STATUS_LABELS, PAYMENT_STATEMENT_SOURCE_LABELS, PAYMENT_STATEMENT_STATUS_LABELS,
  PAYMENT_STATEMENT_TYPE_LABELS, PAYMENT_STATEMENT_TYPE_OPTIONS, serializeReconciliationCsv,
  type PaymentReconAdjustment, type PaymentReconCase, type PaymentReconRun, type PaymentStatementEntry, type PaymentStatementPeriod,
} from '@zenith/shared/payment';
import type { AsyncTask } from '@zenith/shared/tasks';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { asyncTaskStatusColumn } from '@/components/async-task-columns';
import ConfigurableTable from '@/components/ConfigurableTable';
import { EditFormModal } from '@/components/EditFormModal';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { InstantFilterToolbar, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import WorkflowSideSheet from '@/components/workflow/WorkflowSideSheet';
import { useEditModal } from '@/hooks/useEditModal';
import { useListPage } from '@/hooks/useListPage';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import { useAsyncTaskAction } from '@/hooks/queries/async-tasks';
import { useWorkflowDefinitionOptions } from '@/hooks/queries/workflow-definitions';
import { toUserOptions, useAllUsers } from '@/hooks/queries/users';
import {
  invalidatePaymentReconciliation, useCompensatePaymentReconCase, useCreatePaymentReconAdjustment, useExecutePaymentReconAdjustment,
  useHandlePaymentReconCase, useImportPaymentStatement, useMatchPaymentBankEntries, usePaymentChannelAccounts, usePaymentReconAdjustments,
  usePaymentReconCase, usePaymentReconCases, usePaymentReconRuns, usePaymentReconSummary, usePaymentReconWorkflowContext,
  usePaymentReconWorkflowPreview, usePaymentStatement, usePaymentStatementEntries, usePaymentStatementPeriods, usePaymentStatements,
  useRetryPaymentStatement, useReversePaymentReconAdjustment, useRunPaymentRecon, useSubmitPaymentReconAdjustment, useSubmitPaymentStatement,
} from '@/hooks/queries/payment-recon';
import { urlOf } from '@/lib/contract-query';
import { abortSubmit } from '@/lib/abort-submit';
import { request } from '@/utils/request';
import { downloadBlob } from '@/utils/download';
import { formatDateForApi } from '@/utils/date';
import { dateColumn, dateTimeColumn } from '@/utils/table-columns';
import { PaymentAppField, PaymentCurrencyField, PaymentMerchantConfigField } from './payment-form-fields';
import { useAppMerchantConfigLookup } from './payment-app-options';
import { ReconAdjustmentDetails } from './PaymentReconAdjustmentApprovalView';
import { usePaymentReconNavigation } from './payment-recon-navigation';
import './PaymentReconPage.css';

const BusinessWorkflowPanel = lazy(() => import('@/components/workflow/BusinessWorkflowPanel'));
const TASK_TYPES = ['payment-statement-download', 'payment-statement-import', 'payment-reconcile', 'payment-recon-compensate'];
const required = [{ required: true, message: '请填写此项' }];
const fullWidth = { width: '100%' };
const textJsonStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 } as const;
const renderAmount = (value: string | null) => formatReconciliationAmount(value);
const renderSingleLine = (value: string | null | undefined) => (
  <Typography.Text ellipsis={{ showTooltip: true }} className="payment-recon-single-line">
    {value || '—'}
  </Typography.Text>
);
type DownloadValues = Omit<BodyOf<typeof paymentReconContract.submit>, 'billDate'> & { billDate: Date | string };
type ImportValues = Omit<BodyOf<typeof paymentReconContract.importBill>, 'billDate' | 'content' | 'filename'> & { billDate: Date | string };
type HandleValues = Omit<BodyOf<typeof paymentReconContract.handleCase>, 'expectedVersion'>;
type BankValues = { accountId: number; allocations: BodyOf<typeof paymentReconContract.matchBank>['allocations'] };

function encodeFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

export default function PaymentReconPage() {
  const qc = useQueryClient();
  const { hasPermission } = usePermission();
  const [accountId, setAccountId] = useState<number>();
  const { tab, setTab, periodId, statementId, setStatementId, caseId, openPeriod, closePeriod, openCase, closeCase } = usePaymentReconNavigation();
  const [adjustment, setAdjustment] = useState<PaymentReconAdjustment>();
  const [definitionId, setDefinitionId] = useState<number>();
  const [selectedInstanceId, setSelectedInstanceId] = useState<number>();
  const [uploadFile, setUploadFile] = useState<File>();
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const accounts = usePaymentChannelAccounts();
  const accountOptions = useMemo(() => (accounts.data ?? []).map((account) => ({ value: account.id, label: `${account.name} · ${PAYMENT_CHANNEL_LABELS[account.channel]} · ${account.environment === 'sandbox' ? '沙箱' : '生产'}` })), [accounts.data]);
  const summary = usePaymentReconSummary(accountId);
  const periods = useListPage({ contract: paymentReconContract, useList: usePaymentStatementPeriods, params: { accountId }, resetKey: accountId });
  const cases = useListPage({ op: paymentReconContract.cases, useList: usePaymentReconCases, params: { accountId }, resetKey: accountId });
  const runs = useListPage({ op: paymentReconContract.runs, useList: usePaymentReconRuns, params: { accountId }, resetKey: accountId });
  const adjustments = useListPage({ op: paymentReconContract.adjustments, useList: usePaymentReconAdjustments });
  const versions = usePaymentStatements(periodId);
  const selectedStatementId = statementId ?? versions.data?.[0]?.id;
  const statement = usePaymentStatement(selectedStatementId);
  const entryPage = usePagination({ resetKey: selectedStatementId });
  const entries = usePaymentStatementEntries(selectedStatementId, { page: entryPage.page, pageSize: entryPage.pageSize });
  const caseDetail = usePaymentReconCase(caseId);
  const definitions = useWorkflowDefinitionOptions(!!adjustment);
  const definitionOptions = (definitions.data ?? []).filter((item) => item.formType === 'external' && item.status === 'published').map((item) => ({ value: item.id, label: item.name }));
  const currentAdjustment = adjustments.listQuery.data?.list.find((item) => item.id === adjustment?.id) ?? caseDetail.data?.adjustments.find((item) => item.id === adjustment?.id) ?? adjustment;
  const workflow = usePaymentReconWorkflowContext(adjustment?.id, selectedInstanceId);
  const preview = usePaymentReconWorkflowPreview(currentAdjustment?.status === 'draft' ? adjustment?.id : undefined, definitionId);
  const { tasks, loading: tasksLoading, refresh: refreshTasks } = useMyAsyncTasks({ taskTypes: TASK_TYPES });
  const terminalTaskKey = tasks.filter((task) => task.status === 'success' || task.status === 'failed' || task.status === 'cancelled').map((task) => `${task.id}:${task.status}:${task.updatedAt}`).join('|');
  useEffect(() => { if (terminalTaskKey) invalidatePaymentReconciliation(qc); }, [terminalTaskKey, qc]);
  const submit = useSubmitPaymentStatement(); const importBill = useImportPaymentStatement(); const retry = useRetryPaymentStatement();
  const run = useRunPaymentRecon(); const handle = useHandlePaymentReconCase(); const compensate = useCompensatePaymentReconCase();
  const createAdjustment = useCreatePaymentReconAdjustment(); const submitAdjustment = useSubmitPaymentReconAdjustment();
  const executeAdjustment = useExecutePaymentReconAdjustment(); const reverseAdjustment = useReversePaymentReconAdjustment();
  const bankMatch = useMatchPaymentBankEntries();
  const cancelTask = useAsyncTaskAction('cancel'); const resumeTask = useAsyncTaskAction('resume');
  const users = useAllUsers({ enabled: hasPermission('system:user:list') });
  const merchantLookup = useAppMerchantConfigLookup(selectedAppId);
  const afterTask = (task: AsyncTask) => { void refreshTasks({ silent: true }); Toast.success(`任务 #${task.id} 已提交`); };
  const openAdjustment = (value: PaymentReconAdjustment) => { setAdjustment(value); setDefinitionId(undefined); setSelectedInstanceId(undefined); };

  const downloadModal = useEditModal<AsyncTask, DownloadValues>({ entityName: '账单下载任务', defaults: () => ({ accountId, currency: 'CNY', type: 'trade', billDate: new Date(Date.now() - 86400000) }),
    save: { isPending: submit.isPending, mutateAsync: ({ values }) => submit.mutateAsync({ body: { ...values, billDate: formatDateForApi(values.billDate) } }) }, onSaved: afterTask, successMessage: () => null });
  const importModal = useEditModal<AsyncTask, ImportValues>({ entityName: '账单导入任务', defaults: () => ({ accountId, currency: 'CNY', type: 'trade', format: 'internal', billDate: new Date(Date.now() - 86400000) }),
    save: { isPending: importBill.isPending, mutateAsync: async ({ values }) => {
      if (!uploadFile) { Toast.warning('请选择原始账单文件'); throw abortSubmit(); }
      return importBill.mutateAsync({ body: { ...values, billDate: formatDateForApi(values.billDate), filename: uploadFile.name, content: await encodeFile(uploadFile) } });
    } }, onSaved: afterTask, successMessage: () => null });
  const handleModal = useEditModal<PaymentReconCase, HandleValues>({ entityName: '案件处理', defaults: { action: 'investigate', remark: '' },
    save: { isPending: handle.isPending, mutateAsync: ({ values }) => { const item = caseDetail.data; if (!item) throw abortSubmit(); return handle.mutateAsync({ params: { id: item.id }, body: { ...values, expectedVersion: item.version } }); } },
    successMessage: () => '处理记录已追加' });
  const adjustmentModal = useEditModal<PaymentReconAdjustment, BodyOf<typeof paymentReconContract.createAdjustment>>({ entityName: '调整单', defaults: { direction: 'in', reason: '' },
    save: { isPending: createAdjustment.isPending, mutateAsync: ({ values }) => { if (!caseId) throw abortSubmit(); return createAdjustment.mutateAsync({ params: { id: caseId }, body: values }); } }, onSaved: openAdjustment });
  const reverseModal = useEditModal<PaymentReconAdjustment, BodyOf<typeof paymentReconContract.reverseAdjustment>>({ entityName: '冲正申请', defaults: { reason: '' },
    save: { isPending: reverseAdjustment.isPending, mutateAsync: ({ values }) => { if (!adjustment) throw abortSubmit(); return reverseAdjustment.mutateAsync({ params: { id: adjustment.id }, body: values }); } }, onSaved: openAdjustment });
  const bankModal = useEditModal<{ id: number }, BankValues>({ entityName: '银行到账分配', defaults: () => ({ accountId, allocations: [{ bankEntryId: undefined as unknown as number, settlementEntryId: undefined as unknown as number, amount: '' }] }),
    save: { isPending: bankMatch.isPending, mutateAsync: async ({ values }) => { const saved = await bankMatch.mutateAsync({ body: values }); return { id: saved[0]?.id ?? 0 }; } }, successMessage: () => '到账分配已保存' });

  const accountField = <Form.Select field="accountId" label="渠道账户" optionList={accountOptions} filter loading={accounts.isFetching} rules={required} style={fullWidth} />;
  const periodFields = <>{accountField}<Form.DatePicker field="billDate" label="账单日期" rules={required} style={fullWidth} /><PaymentCurrencyField /></>;
  const periodColumns: ColumnProps<PaymentStatementPeriod>[] = [
    dateColumn('账期', 'billDate'), { title: '账户', dataIndex: 'accountId', width: 320, render: (id: number) => renderSingleLine(accounts.data?.find((item) => item.id === id)?.name ?? `#${id}`) },
    { title: '类型', dataIndex: 'type', width: 110, render: (value: PaymentStatementPeriod['type']) => PAYMENT_STATEMENT_TYPE_LABELS[value] },
    { title: '状态', dataIndex: 'status', width: 110, render: (value: PaymentStatementPeriod['status']) => <Tag color={value === 'failed' ? 'red' : value === 'ready' ? 'green' : 'blue'}>{PAYMENT_STATEMENT_PERIOD_STATUS_LABELS[value]}</Tag> },
    { title: '币种', dataIndex: 'currency', width: 80 }, dateTimeColumn('下次获取', 'nextAttemptAt'), { title: '错误原因', dataIndex: 'lastError', width: 300, render: renderSingleLine },
    createOperationColumn<PaymentStatementPeriod>({ width: 170, actions: (item) => [
      { key: 'detail', label: '账单与原件', onClick: () => openPeriod(item.id) },
      { key: 'retry', label: '补跑', hidden: !hasPermission('payment:recon:create') || item.type === 'bank', onClick: async () => afterTask(await retry.mutateAsync({ params: { id: item.id } })) },
    ] }),
  ];
  const caseColumns: ColumnProps<PaymentReconCase>[] = [
    { title: '案件', dataIndex: 'id', width: 80 }, { title: '业务标识', dataIndex: 'entryKey', width: 220 },
    { title: '差异类型', dataIndex: 'type', width: 110, render: (value: PaymentReconCase['type']) => PAYMENT_RECON_CASE_TYPE_LABELS[value] },
    { title: '阶段', dataIndex: 'stage', width: 100, render: (value: PaymentReconCase['stage']) => PAYMENT_STATEMENT_TYPE_LABELS[value] },
    { title: '本地金额', dataIndex: 'localAmount', width: 120, render: renderAmount }, { title: '渠道金额', dataIndex: 'channelAmount', width: 120, render: renderAmount },
    { title: '状态', dataIndex: 'status', width: 100, render: (value: PaymentReconCase['status']) => PAYMENT_RECON_CASE_STATUS_LABELS[value] },
    dateTimeColumn('处理期限', 'dueAt'), createOperationColumn<PaymentReconCase>({ width: 140, actions: (item) => [{ key: 'detail', label: '调查处理', onClick: () => openCase(item.id) }] }),
  ];
  const runColumns: ColumnProps<PaymentReconRun>[] = [
    { title: '运行', dataIndex: 'id', width: 80 }, { title: '账单', dataIndex: 'statementId', width: 80 }, { title: '规则版本', dataIndex: 'ruleVersion', width: 110 },
    { title: '匹配 / 差异', key: 'counts', width: 140, render: (_: unknown, item) => `${item.matchedCount} / ${item.diffCount}` },
    { title: '状态', dataIndex: 'status', width: 110, render: (value: PaymentReconRun['status']) => PAYMENT_RECON_RUN_STATUS_LABELS[value] },
    dateTimeColumn('完成时间', 'finishedAt'), { title: '错误', dataIndex: 'error', width: 280 },
  ];
  const adjustmentColumns: ColumnProps<PaymentReconAdjustment>[] = [
    { title: '调整单', dataIndex: 'id', width: 90 }, { title: '案件', dataIndex: 'caseId', width: 90 },
    { title: '金额', dataIndex: 'amount', width: 130, render: renderAmount }, { title: '状态', dataIndex: 'status', width: 110, render: (value: PaymentReconAdjustment['status']) => PAYMENT_RECON_ADJUSTMENT_STATUS_LABELS[value] },
    { title: '依据', dataIndex: 'reason', width: 300 }, { title: '凭证', dataIndex: 'journalId', width: 100 },
    createOperationColumn<PaymentReconAdjustment>({ width: 140, actions: (item) => [{ key: 'workflow', label: '资料与审批', onClick: () => openAdjustment(item) }] }),
  ];
  const entryColumns: ColumnProps<PaymentStatementEntry>[] = [
    { title: '明细 ID', dataIndex: 'id', width: 90 }, { title: '业务标识', dataIndex: 'entryKey', width: 250, render: renderSingleLine },
    { title: '类型', dataIndex: 'type', width: 110, render: (value: PaymentStatementEntry['type']) => PAYMENT_STATEMENT_ENTRY_TYPE_LABELS[value] },
    { title: '订单 / 退款号', key: 'businessNo', width: 260, render: (_: unknown, item) => renderSingleLine(item.merchantRefundNo ?? item.merchantOrderNo ?? item.reference) },
    { title: '金额', dataIndex: 'amount', width: 120, render: renderAmount }, { title: '方向', dataIndex: 'direction', width: 80, render: (value: string) => value === 'in' ? '收入' : '支出' },
    { title: '币种', dataIndex: 'currency', width: 75 }, { title: '来源行', dataIndex: 'lineNo', width: 80 }, dateTimeColumn('发生时间', 'occurredAt'),
  ];
  const taskColumns: ColumnProps<AsyncTask>[] = [
    { title: '任务', dataIndex: 'title', width: 250 }, asyncTaskStatusColumn<AsyncTask>(),
    { title: '进度', key: 'progress', width: 210, render: (_: unknown, item) => <AsyncTaskProgress task={item} /> },
    { title: '执行次数', key: 'attempts', width: 90, render: (_: unknown, item) => `${item.attempts}/${item.maxAttempts}` },
    { title: '错误', dataIndex: 'errorMessage', width: 250 }, createOperationColumn<AsyncTask>({ width: 140, actions: (item) => [
      { key: 'cancel', label: '取消', hidden: !['pending', 'running'].includes(item.status), onClick: async () => { await cancelTask.mutateAsync({ params: { id: item.id } }); void refreshTasks(); } },
      { key: 'resume', label: '恢复', hidden: !['failed', 'cancelled'].includes(item.status), onClick: async () => { await resumeTask.mutateAsync({ params: { id: item.id } }); void refreshTasks(); } },
    ] }),
  ];

  return <div className="page-container payment-recon-page">
    <InstantFilterToolbar primary={<Select aria-label="渠道账户" placeholder="全部渠道账户" optionList={accountOptions} value={accountId} filter showClear style={{ minWidth: 230, maxWidth: '100%' }} onChange={(value) => setAccountId(typeof value === 'number' ? value : undefined)} />}
      onRefresh={() => { invalidatePaymentReconciliation(qc); void refreshTasks(); }} refreshing={summary.isFetching}
      actions={<Space wrap>
        {hasPermission('payment:recon:create') && <Button theme="solid" onClick={downloadModal.openCreate}>下载渠道账单</Button>}
        {hasPermission('payment:recon:import') && <Button onClick={() => { setUploadFile(undefined); importModal.openCreate(); }}>导入账单 / 银行流水</Button>}
        {hasPermission('payment:recon:bank-match') && <Button onClick={bankModal.openCreate}>分配银行到账</Button>}
      </Space>} />
    <StatGrid minItemWidth={140}>
      <StatCard title="待获取 / 等待出账" value={`${summary.data?.expectedPeriods ?? 0} / ${summary.data?.waitingPeriods ?? 0}`} />
      <StatCard title="账单获取失败" value={summary.data?.failedPeriods ?? 0} />
      <StatCard title="待处理 / 挂账案件" value={`${summary.data?.openCases ?? 0} / ${summary.data?.suspendedCases ?? 0}`} />
      <StatCard title="超期案件" value={summary.data?.overdueCases ?? 0} />
      <StatCard title="待审批 / 执行" value={summary.data?.pendingAdjustments ?? 0} />
      <StatCard title="未核验银行 / 结算" value={`${summary.data?.unmatchedBankEntries ?? 0} / ${summary.data?.unmatchedSettlementEntries ?? 0}`} />
    </StatGrid>
    {(summary.data?.differenceAmounts ?? []).length > 0 && (
      <div className="payment-recon-difference">
        {(summary.data?.differenceAmounts ?? []).map((item) => <span key={item.currency}>{item.currency} 未解决差异金额：{formatReconciliationAmount(item.amount)}</span>)}
      </div>
    )}
    <div className="payment-recon-tabs">
    <Tabs activeKey={tab} onChange={setTab} keepDOM={false} collapsible="auto">
      <Tabs.TabPane tab="账期与原件" itemKey="periods"><ListSearchToolbar page={periods} filters={['type', 'status', 'billDate']} overrides={{ billDate: (page) => <DatePicker aria-label="账单日期" placeholder="账单日期" type="date" value={page.bind('billDate').value} onChange={(value) => page.bind('billDate').onChange(value ? formatDateForApi(value as Date) : undefined)} /> }} /><ConfigurableTable columns={periodColumns} columnSettingsKey="payment-recon-periods" {...periods.tableProps} /></Tabs.TabPane>
      <Tabs.TabPane tab="差异案件" itemKey="cases"><ListSearchToolbar page={cases} filters={['type', 'stage', 'status']} /><ConfigurableTable columns={caseColumns} columnSettingsKey="payment-recon-cases" {...cases.tableProps} /></Tabs.TabPane>
      <Tabs.TabPane tab="核对历史" itemKey="runs"><ListSearchToolbar page={runs} filters={['status', 'statementId']} /><ConfigurableTable columns={runColumns} columnSettingsKey="payment-recon-runs" {...runs.tableProps} /></Tabs.TabPane>
      <Tabs.TabPane tab="调整审批" itemKey="adjustments"><ListSearchToolbar page={adjustments} filters={['status', 'caseId']} /><ConfigurableTable columns={adjustmentColumns} columnSettingsKey="payment-recon-adjustments" {...adjustments.tableProps} /></Tabs.TabPane>
      <Tabs.TabPane tab="执行任务" itemKey="tasks"><ConfigurableTable columns={taskColumns} columnSettingsKey="payment-recon-tasks" {...listTableProps({ data: tasks, isFetching: tasksLoading, refetch: refreshTasks })} /></Tabs.TabPane>
      </Tabs>
    </div>

    <EditFormModal modal={downloadModal} title="下载渠道账单" width={600}>{periodFields}<Form.Select field="type" label="账单类型" optionList={PAYMENT_STATEMENT_TYPE_OPTIONS.filter((item) => item.value !== 'bank')} rules={required} style={fullWidth} /></EditFormModal>
    <EditFormModal modal={importModal} title="导入账单 / 银行流水" width={680} header={<Banner type="info" closeIcon={null} description="原件将归档并保留来源。标准 CSV / JSON 金额使用整数分，时间必须带时区。银行到账明细使用 settlement 类型及 in 方向。" />}>
      {periodFields}<Form.Select field="type" label="账单类型" optionList={PAYMENT_STATEMENT_TYPE_OPTIONS} rules={required} style={fullWidth} />
      <Form.Select field="format" label="文件格式" optionList={PAYMENT_STATEMENT_IMPORT_FORMAT_OPTIONS} rules={required} style={fullWidth} />
      <Space wrap><Button onClick={() => downloadBlob(new Blob([serializeReconciliationCsv([])], { type: 'text/csv;charset=utf-8' }), 'payment-statement-template.csv')}>下载标准模板</Button>
        <Upload action="" uploadTrigger="custom" limit={1} accept=".csv,.json,.txt,.zip,.gz" maxSize={PAYMENT_RECON_MAX_FILE_BYTES / 1024}
          onSizeError={() => Toast.error('账单文件不能超过 32 MiB')}
          onChange={({ fileList }) => { const selected = fileList[0]?.fileInstance; setUploadFile(selected && selected.size <= PAYMENT_RECON_MAX_FILE_BYTES ? selected : undefined); }}><Button>选择原始文件</Button></Upload>
      </Space><Typography.Paragraph>{uploadFile?.name ?? '尚未选择文件'}</Typography.Paragraph>
    </EditFormModal>

    <SideSheet visible={periodId !== undefined} title="账单版本与归档原件" width={1060} onCancel={closePeriod}>
      <div className="payment-recon-sheet__toolbar">
        <Select aria-label="账单版本" value={selectedStatementId} optionList={(versions.data ?? []).map((item) => ({ value: item.id, label: `v${item.version} · ${PAYMENT_STATEMENT_SOURCE_LABELS[item.source]} · ${PAYMENT_STATEMENT_STATUS_LABELS[item.status]}` }))} onChange={(value) => setStatementId(Number(value))} style={{ minWidth: 330, maxWidth: '100%' }} />
        {selectedStatementId && hasPermission('payment:recon:create') && <Button disabled={statement.data?.status !== 'validated'} onClick={async () => afterTask(await run.mutateAsync({ params: { id: selectedStatementId } }))}>重新核对</Button>}
      </div>
      {statement.data ? (
        <>
          <section className="payment-recon-sheet__section">
            <div className="payment-recon-sheet__section-title"><span>基本信息</span></div>
            <dl className="payment-recon-sheet__meta">
              <div className="payment-recon-sheet__meta-item"><dt className="payment-recon-sheet__meta-label">来源</dt><dd className="payment-recon-sheet__meta-value">{PAYMENT_STATEMENT_SOURCE_LABELS[statement.data.source]}</dd></div>
              <div className="payment-recon-sheet__meta-item"><dt className="payment-recon-sheet__meta-label">状态</dt><dd className="payment-recon-sheet__meta-value">{PAYMENT_STATEMENT_STATUS_LABELS[statement.data.status]}</dd></div>
              <div className="payment-recon-sheet__meta-item"><dt className="payment-recon-sheet__meta-label">解析器版本</dt><dd className="payment-recon-sheet__meta-value">{renderSingleLine(statement.data.parserVersion)}</dd></div>
              <div className="payment-recon-sheet__meta-item payment-recon-sheet__meta-item--wide"><dt className="payment-recon-sheet__meta-label">内容摘要</dt><dd className="payment-recon-sheet__meta-value payment-recon-sheet__meta-value--mono" title={statement.data.contentHash}>{statement.data.contentHash || '—'}</dd></div>
              <div className="payment-recon-sheet__meta-item payment-recon-sheet__meta-item--wide"><dt className="payment-recon-sheet__meta-label">校验结果</dt><dd className="payment-recon-sheet__meta-value"><pre className="payment-recon-sheet__json">{JSON.stringify(statement.data.verification, null, 2)}</pre></dd></div>
            </dl>
          </section>
          <section className="payment-recon-sheet__section">
            <div className="payment-recon-sheet__section-title"><span>归档原件</span></div>
            <div className="payment-recon-sheet__files">{statement.data.files.map((file) => <Button key={file.id} disabled={!hasPermission('payment:recon:download')} onClick={() => void request.download(urlOf(paymentReconContract.download, { params: { id: file.id } }), file.filename)}>下载 {file.filename} ({file.byteLength} B)</Button>)}</div>
          </section>
          <section className="payment-recon-sheet__section">
            <div className="payment-recon-sheet__table-title"><Typography.Title heading={6}>标准明细</Typography.Title></div>
            <ConfigurableTable columns={entryColumns} columnSettingsKey="payment-recon-entries" {...listTableProps(entries, { pagination: entryPage.buildPagination })} />
          </section>
        </>
      ) : <Empty description="尚无可用账单，查看执行任务了解获取进度" />}
    </SideSheet>

    <SideSheet visible={caseId !== undefined} title="差异调查与处理" width={860} onCancel={closeCase}>
      {caseDetail.data ? <><Descriptions row data={[
        { key: '案件 / 版本', value: `#${caseDetail.data.id} / v${caseDetail.data.version}` }, { key: '差异类型', value: PAYMENT_RECON_CASE_TYPE_LABELS[caseDetail.data.type] },
        { key: '状态', value: PAYMENT_RECON_CASE_STATUS_LABELS[caseDetail.data.status] }, { key: '本地 / 渠道金额', value: `${formatReconciliationAmount(caseDetail.data.localAmount)} / ${formatReconciliationAmount(caseDetail.data.channelAmount)} ${caseDetail.data.currency}` },
        { key: '处理依据', value: caseDetail.data.resolution ?? '—' }, { key: '责任人 / 期限', value: `${caseDetail.data.assignedTo ?? '未分配'} / ${caseDetail.data.dueAt ?? '—'}` },
      ]} /><Space wrap>
        {hasPermission('payment:recon:handle') && <Button onClick={handleModal.openCreate}>追加处理记录</Button>}
        {hasPermission('payment:recon:compensate') && isUnresolvedReconciliationCase(caseDetail.data.status) && <Button onClick={async () => afterTask(await compensate.mutateAsync({ params: { id: caseDetail.data.id } }))}>查单补偿</Button>}
        {hasPermission('payment:recon:adjust') && isUnresolvedReconciliationCase(caseDetail.data.status) && <Button onClick={() => { setSelectedAppId(caseDetail.data.applicationId); adjustmentModal.openCreate(); }}>申请调整</Button>}
      </Space><Typography.Title heading={6}>账单与本地证据</Typography.Title><pre style={textJsonStyle}>{JSON.stringify(caseDetail.data.evidence, null, 2)}</pre>
        <Typography.Title heading={6}>处理历史</Typography.Title>{caseDetail.data.events.map((event) => <Typography.Paragraph key={event.id}>{event.createdAt} · {event.action} · {event.actorId ?? '系统'} · {event.remark}</Typography.Paragraph>)}
        <Typography.Title heading={6}>关联调整</Typography.Title><Space wrap>{caseDetail.data.adjustments.map((item) => <Button key={item.id} onClick={() => openAdjustment(item)}>#{item.id} · {PAYMENT_RECON_ADJUSTMENT_STATUS_LABELS[item.status]}</Button>)}</Space>
      </> : <Spin />}
    </SideSheet>
    <EditFormModal modal={handleModal} title="追加案件处理记录"><Form.Select field="action" label="处理动作" optionList={PAYMENT_RECON_CASE_ACTION_OPTIONS} rules={required} style={fullWidth} /><Form.Select field="assignedTo" label="责任人" optionList={toUserOptions(users.data ?? [])} filter showClear style={fullWidth} /><Form.TextArea field="remark" label="处理依据" rules={required} maxCount={2000} /></EditFormModal>
    <EditFormModal modal={adjustmentModal} title="创建审批调整单" width={680} formProps={{ labelWidth: 240, className: 'payment-recon-adjustment-form' }} header={<Banner type="warning" closeIcon={null} description="调整需要真实渠道已验证账单、明确的本地归属和金额依据；人工上传、沙箱及渠道单边差异先调查，不可直接过账。" />}>
      <PaymentAppField optionList={merchantLookup.appOptions} loading={merchantLookup.appsFetching} onChange={(value) => { setSelectedAppId(value); adjustmentModal.formApi.current?.setValue('channelConfigId', undefined); }} />
      <PaymentMerchantConfigField optionList={merchantLookup.merchantConfigOptions} loading={merchantLookup.channelConfigsQuery.isFetching} />
      <Form.Input field="amount" label={<span style={{ whiteSpace: 'nowrap' }}>金额（整数分）</span>} rules={required} placeholder="例如 100 表示 1.00 元" /><Form.Select field="direction" label="调整方向" optionList={PAYMENT_RECON_DIRECTION_OPTIONS} rules={required} style={fullWidth} /><Form.TextArea field="reason" label="调整依据" rules={required} maxCount={2000} />
    </EditFormModal>
    <EditFormModal modal={reverseModal} title="创建冲正审批草稿"><Form.TextArea field="reason" label="冲正依据" rules={required} maxCount={2000} /></EditFormModal>
    <EditFormModal modal={bankModal} title="分配银行到账" width={820} header={<Banner type="info" closeIcon={null} description="在账单明细中查看银行到账和渠道结算的明细 ID，可添加多行完成拆分或合并。累计分配金额不能超过任一方流水金额。" />}>
      {accountField}<ArrayField field="allocations">{({ arrayFields, add }) => <><Button onClick={() => add()}>增加分配</Button>{arrayFields.map(({ field, key, remove }) => <Space key={key} wrap align="end"><Form.InputNumber field={`${field}.bankEntryId`} label="银行明细 ID" min={1} rules={required} /><Form.InputNumber field={`${field}.settlementEntryId`} label="渠道结算明细 ID" min={1} rules={required} /><Form.Input field={`${field}.amount`} label="金额（整数分）" rules={required} /><Button onClick={remove}>移除</Button></Space>)}</>}</ArrayField>
    </EditFormModal>
    <WorkflowSideSheet visible={!!adjustment} title="调整资料与审批" variant="split" onCancel={() => setAdjustment(undefined)} footerRight={<Space wrap>
      {currentAdjustment?.status === 'draft' && hasPermission('payment:recon:adjust') && <Button theme="solid" disabled={!definitionId || !preview.data?.definition || preview.isError} loading={submitAdjustment.isPending} onClick={async () => { if (!currentAdjustment || !definitionId) return; setAdjustment(await submitAdjustment.mutateAsync({ params: { id: currentAdjustment.id }, body: { definitionId } })); Toast.success('已提交独立审批'); }}>提交审批</Button>}
      {currentAdjustment?.status === 'approved' && hasPermission('payment:recon:execute') && <Button theme="solid" loading={executeAdjustment.isPending} onClick={async () => { if (!currentAdjustment) return; setAdjustment(await executeAdjustment.mutateAsync({ params: { id: currentAdjustment.id } })); Toast.success('调整已执行'); }}>执行已批准调整</Button>}
      {currentAdjustment?.status === 'executed' && hasPermission('payment:recon:adjust') && <Button onClick={reverseModal.openCreate}>申请冲正</Button>}<Button onClick={() => setAdjustment(undefined)}>关闭</Button>
    </Space>}>
      {currentAdjustment && <Suspense fallback={<Spin />}><BusinessWorkflowPanel context={workflow.data} preview={preview.data} loading={workflow.isLoading || preview.isLoading} error={workflow.error ?? preview.error} selectedInstanceId={selectedInstanceId} onSelectInstance={setSelectedInstanceId}
        formContent={<>{currentAdjustment.status === 'draft' && <div style={{ padding: 16 }}><Typography.Paragraph>审批流程</Typography.Paragraph><Select aria-label="调整审批流程" placeholder="选择已发布的业务审批流程" optionList={definitionOptions} value={definitionId} filter style={fullWidth} onChange={(value) => setDefinitionId(typeof value === 'number' ? value : undefined)} /></div>}<ReconAdjustmentDetails adjustment={currentAdjustment} /></>} /></Suspense>}
    </WorkflowSideSheet>
  </div>;
}
