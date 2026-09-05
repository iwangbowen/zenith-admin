import { useMemo, useRef, useState } from 'react';
import { formatYuan } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Col, Form, Modal, Row, Select, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { Tabs, TabPane } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ExportButton from '@/components/ExportButton';
import { copyableNoColumn, createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { useListSearch } from '@/hooks/useListSearch';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { usePaymentAppList } from '@/hooks/queries/payment-apps';
import {
  paymentContractKeys,
  useAllDeductPlans,
  useCreatePaymentContract,
  useDeductPaymentContract,
  useDeductPlanList,
  useDeleteDeductPlan,
  usePausePaymentContract,
  usePaymentContractList,
  useResumePaymentContract,
  useRecoverPaymentContract,
  useSaveDeductPlan,
  useTerminatePaymentContract,
} from '@/hooks/queries/payment-contracts';
import { enumValueOf } from '@zenith/shared/core';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_CHANNELS, PAYMENT_CONTRACT_STATUS_LABELS, PAYMENT_CONTRACT_STATUSES, PAYMENT_DEDUCT_PERIOD_LABELS, PAYMENT_DEDUCT_PERIOD_OPTIONS, PAYMENT_CONTRACT_STATUS_OPTIONS, PAYMENT_CHANNEL_OPTIONS } from '@zenith/shared/payment';
import type { CreatePaymentContractInput, CreatePaymentDeductPlanInput, PaymentChannel, PaymentContract, PaymentContractSignResult, PaymentContractStatus, PaymentDeductMethod, PaymentDeductPeriod, PaymentDeductPlan } from '@zenith/shared/payment';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';

import { useUrlTabState } from '@/hooks/useUrlTabState';
const yuan = formatYuan;
const CONTRACT_STATUS_COLOR = { pending: 'grey', unknown: 'orange', signed: 'green', paused: 'orange', terminated: 'red', failed: 'red' } as const satisfies Record<PaymentContractStatus, string>;
const contractStatusOptions = PAYMENT_CONTRACT_STATUS_OPTIONS;
const channelOptions = PAYMENT_CHANNEL_OPTIONS;
const DEDUCT_METHOD_OPTIONS = [
  { value: 'wechat_papay', label: '微信委托代扣' },
  { value: 'alipay_cycle', label: '支付宝周期扣款' },
];

interface PlanFormValues { name: string; period: PaymentDeductPeriod; customDays?: number; amountYuan: number; maxRetries: number; status?: 'enabled' | 'disabled'; remark?: string; }
type PlanPayload = Partial<CreatePaymentDeductPlanInput>;
interface ContractFormValues { applicationId: number; planId: number; payMethod: PaymentDeductMethod; currency: 'CNY'; signerAccount: string; signerName?: string; remark?: string; firstDeductNow?: boolean; }

function describePlanPeriod(p: Pick<PaymentDeductPlan, 'period' | 'customDays'>): string {
  return p.period === 'custom' ? `每 ${p.customDays ?? '-'} 天` : PAYMENT_DEDUCT_PERIOD_LABELS[p.period];
}

interface SearchParams { keyword: string; status?: string; channel?: string }
const defaultSearchParams: SearchParams = { keyword: '', status: undefined, channel: '' };

export default function PaymentContractsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canManage = hasPermission('payment:contract:manage');
  const canPlan = hasPermission('payment:contract:plan');
  const latestContractResult = useRef<PaymentContractSignResult | null>(null);
  const [activeTab, setActiveTab] = useUrlTabState(['contracts', 'plans'] as const, 'contracts');

  // ── 签约协议 ──
  const {
    page: cPage, pageSize: cPageSize, setPage: setCPage, buildPagination: buildCPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch({ defaults: defaultSearchParams, listKey: paymentContractKeys.lists });

  // ── 扣款计划 ──
  const { page: pPage, pageSize: pPageSize, setPage: setPPage, buildPagination: buildPPagination } = usePagination();
  const [planKeyword, setPlanKeyword] = useState('');
  const [submittedPlanKeyword, setSubmittedPlanKeyword] = useState('');
  const [planPeriod, setPlanPeriod] = useState<PaymentDeductPeriod>('monthly');
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [contractAppId, setContractAppId] = useState<number | null>(null);

  const appsQuery = usePaymentAppList({ page: 1, pageSize: 100, status: 'enabled' });
  const paymentApps = useMemo(() => appsQuery.data?.list ?? [], [appsQuery.data?.list]);
  const appById = useMemo(() => new Map(paymentApps.map((app) => [app.id, app])), [paymentApps]);
  const appOptions = useMemo(
    () => paymentApps.map((app) => ({ value: app.id, label: `${app.name} · ${app.environment === 'sandbox' ? '沙箱' : '生产'}` })),
    [paymentApps],
  );
  const effectiveContractAppId = contractAppId ?? paymentApps[0]?.id;

  const contractQuery = usePaymentContractList({
    applicationId: effectiveContractAppId ?? 0,
    page: cPage,
    pageSize: cPageSize,
    keyword: submittedParams.keyword || undefined,
    status: enumValueOf(PAYMENT_CONTRACT_STATUSES, submittedParams.status),
    channel: enumValueOf(PAYMENT_CHANNELS, submittedParams.channel),
  }, effectiveContractAppId != null);
  const contracts = contractQuery.data?.list ?? [];
  const contractTotal = contractQuery.data?.total ?? 0;
  const planQuery = useDeductPlanList({ page: pPage, pageSize: pPageSize, keyword: submittedPlanKeyword || undefined });
  const plans = planQuery.data?.list ?? [];
  const planTotal = planQuery.data?.total ?? 0;
  const allPlansQuery = useAllDeductPlans();
  const allPlans = allPlansQuery.data ?? [];
  const deductMethodOptions = useMemo(() => {
    const app = selectedAppId == null ? null : appById.get(selectedAppId);
    return DEDUCT_METHOD_OPTIONS.filter((option) => option.value === 'wechat_papay' ? app?.wechatConfigId != null : app?.alipayConfigId != null);
  }, [appById, selectedAppId]);

  const createContractMutation = useCreatePaymentContract();
  const terminateMutation = useTerminatePaymentContract();
  const pauseMutation = usePausePaymentContract();
  const resumeMutation = useResumePaymentContract();
  const deductMutation = useDeductPaymentContract();
  const recoverMutation = useRecoverPaymentContract();
  const planSaveMutation = useSaveDeductPlan();
  const deletePlanMutation = useDeleteDeductPlan();

  const contractSaveMutation = {
    mutateAsync: async ({ values }: { id?: number; values: CreatePaymentContractInput }) => {
      const res = await createContractMutation.mutateAsync({ body: values });
      latestContractResult.current = res;
      setContractAppId(res.contract.appId);
      return res.contract;
    },
    isPending: createContractMutation.isPending,
  };
  const signModal = useEditModal<PaymentContract, ContractFormValues, CreatePaymentContractInput>({
    save: contractSaveMutation,
    defaults: { firstDeductNow: true },
    beforeSave: (values) => ({
      applicationId: values.applicationId,
      planId: values.planId,
      payMethod: values.payMethod,
      currency: values.currency,
      signerAccount: values.signerAccount,
      signerName: values.signerName || undefined,
      remark: values.remark || undefined,
      firstDeductNow: values.firstDeductNow ?? true,
    }),
    successMessage: () => {
      const firstDeduct = latestContractResult.current?.firstDeduct;
      if (firstDeduct?.deductStatus === 'success') return '签约成功，首期扣款已完成';
      if (firstDeduct?.deductStatus === 'failed') return `签约成功，但首期扣款失败：${firstDeduct.failReason ?? '未知原因'}`;
      return '签约成功';
    },
    labelWidth: 110,
  });

  // ── 协议操作 ──

  async function handleTerminate(record: PaymentContract) {
    await terminateMutation.mutateAsync({ params: { id: record.id }, query: { applicationId: record.appId } });
    Toast.success('已解约');
  }

  async function handlePause(record: PaymentContract) {
    await pauseMutation.mutateAsync({ params: { id: record.id }, query: { applicationId: record.appId } });
    Toast.success('已暂停扣款');
  }

  async function handleResume(record: PaymentContract) {
    await resumeMutation.mutateAsync({ params: { id: record.id }, query: { applicationId: record.appId } });
    Toast.success('已恢复，将尽快执行补扣');
  }

  async function handleDeduct(record: PaymentContract) {
    const res = await deductMutation.mutateAsync({ params: { id: record.id }, query: { applicationId: record.appId } });
    if (res.deductStatus === 'success') Toast.success(`扣款成功（订单 ${res.orderNo}）`);
    else if (res.deductStatus === 'processing') Toast.info('渠道受理中，稍后自动同步结果');
    else Toast.error(`扣款失败：${res.failReason ?? '未知原因'}`);
  }

  async function handleRecover(record: PaymentContract) {
    const result = await recoverMutation.mutateAsync({ params: { id: record.id }, query: { applicationId: record.appId } });
    Toast.info(`查询完成：${PAYMENT_CONTRACT_STATUS_LABELS[result.status]}`);
  }

  const planModal = useEditModal<PaymentDeductPlan, PlanFormValues, PlanPayload>({
    entityName: '扣款计划',
    save: planSaveMutation,
    defaults: { name: '', period: 'monthly', amountYuan: 15, maxRetries: 3, status: 'enabled' },
    toValues: (plan) => ({
      name: plan.name,
      period: plan.period,
      customDays: plan.customDays ?? undefined,
      amountYuan: plan.amount / 100,
      maxRetries: plan.maxRetries,
      status: plan.status,
      remark: plan.remark ?? '',
    }),
    beforeSave: (values) => ({
      name: values.name,
      period: values.period,
      customDays: values.period === 'custom' ? (values.customDays ?? null) : null,
      amount: Math.round(values.amountYuan * 100),
      maxRetries: values.maxRetries,
      status: values.status,
      remark: values.remark || undefined,
    }),
    labelWidth: 110,
  });

  // ── 计划操作 ──
  function openCreatePlan() { setPlanPeriod('monthly'); planModal.openCreate(); }
  function openEditPlan(p: PaymentDeductPlan) { setPlanPeriod(p.period); planModal.openEdit(p); }

  async function handleDeletePlan(id: number) {
    await deletePlanMutation.mutateAsync({ params: { id } });
    Toast.success('删除成功');
  }

  // ── 列定义 ──
  const contractColumns: ColumnProps<PaymentContract>[] = [
    copyableNoColumn('协议号', 'contractNo'),
    { title: '支付应用', dataIndex: 'appId', width: 200, render: (value: number) => renderEllipsis(appById.get(value)?.name ?? `应用 #${value}`) },
    { title: '渠道', dataIndex: 'channel', width: 90, render: (v: PaymentChannel) => PAYMENT_CHANNEL_LABELS[v] },
    { title: '扣款计划', dataIndex: 'planName', minWidth: 200, render: (v: string | null, r) => {
      const text = v ? `${v}（${r.planPeriod ? describePlanPeriod({ period: r.planPeriod, customDays: null }) : '-'}）` : '-';
      return <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 180 }}>{text}</Typography.Text>;
    } },
    { title: '每期金额', dataIndex: 'planAmount', width: 100, align: 'right', render: (v: number | null) => (v == null ? '-' : yuan(v)) },
    { title: '签约账号', dataIndex: 'signerAccount', width: 160, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 140 }}>{v}</Typography.Text> },
    { title: '业务', dataIndex: 'bizType', width: 140, render: (v: string, r) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{`${v}:${r.bizId}`}</Typography.Text> },
    { title: '已扣期数', dataIndex: 'totalDeductCount', width: 90, align: 'right' },
    { title: '连续失败', dataIndex: 'failCount', width: 90, align: 'right', render: (v: number) => (v > 0 ? <Tag color="red">{v} 次</Tag> : '0') },
    { title: '币种/版本', width: 100, render: (_: unknown, record: PaymentContract) => `${record.currency} · v${record.version}` },
    dateTimeColumn('下次扣款', 'nextDeductAt'),
    dateTimeColumn('上次扣款', 'lastDeductAt'),
    createdAtColumn as ColumnProps<PaymentContract>,
    { title: '状态', dataIndex: 'status', width: 110, fixed: 'right', render: (v: PaymentContractStatus) => <Tag color={CONTRACT_STATUS_COLOR[v]}>{PAYMENT_CONTRACT_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentContract>({
      width: 210,
      actions: (r) => (canManage ? [
        ...(r.status === 'signed' ? [{
          key: 'deduct',
          label: '补扣',
          onClick: () => {
            Modal.confirm({ title: '立即执行一期扣款？', content: `将按计划金额 ${r.planAmount != null ? yuan(r.planAmount) : ''} 发起代扣`, onOk: () => handleDeduct(r) });
          },
        }, {
          key: 'pause',
          label: '暂停',
          onClick: () => {
            Modal.confirm({ title: '暂停自动扣款？', content: '暂停后可随时恢复', onOk: () => handlePause(r) });
          },
        }] : []),
        ...(r.status === 'paused' ? [{
          key: 'resume',
          label: '恢复',
          onClick: () => {
            Modal.confirm({ title: '恢复自动扣款？', content: '恢复后将尽快执行补扣', onOk: () => handleResume(r) });
          },
        }] : []),
        ...(r.status === 'signed' || r.status === 'paused' ? [{
          key: 'terminate',
          label: '解约',
          danger: true,
          onClick: () => {
            Modal.confirm({ title: '确定要解约吗？', content: '解约后停止扣款，且不可恢复', onOk: () => handleTerminate(r) });
          },
        }] : []),
        ...(r.status === 'pending' || r.status === 'unknown' ? [{
          key: 'recover',
          label: '查单恢复',
          loading: recoverMutation.isPending && recoverMutation.variables?.params.id === r.id,
          onClick: () => { void handleRecover(r); },
        }] : []),
      ] : []),
    }),
  ];

  const planColumns: ColumnProps<PaymentDeductPlan>[] = [
    { title: '计划名称', dataIndex: 'name', minWidth: 200, render: renderEllipsis },
    { title: '扣款周期', dataIndex: 'period', width: 120, render: (_: unknown, p) => describePlanPeriod(p) },
    { title: '每期金额', dataIndex: 'amount', width: 110, align: 'right', render: (v: number) => yuan(v) },
    { title: '重试上限', dataIndex: 'maxRetries', width: 100 },
    { title: '签约数', dataIndex: 'contractCount', width: 90, align: 'right', render: (v: number | undefined) => v ?? 0 },
    { title: '备注', dataIndex: 'remark', width: 200, render: renderEllipsis },
    createdAtColumn as ColumnProps<PaymentDeductPlan>,
    { title: '状态', dataIndex: 'status', width: 80, fixed: 'right', render: (v: 'enabled' | 'disabled') => (v === 'enabled' ? <Tag color="green">启用</Tag> : <Tag color="grey">停用</Tag>) },
    createOperationColumn<PaymentDeductPlan>({
      width: 150,
      actions: (p) => (canPlan ? [{
        key: 'edit',
        label: '编辑',
        onClick: () => openEditPlan(p),
      }, {
        key: 'delete',
        label: '删除',
        danger: true,
        onClick: () => {
          confirmDelete({ content: '仅无签约协议引用的计划可删除', onOk: () => handleDeletePlan(p.id) });
        },
      }] : []),
    }),
  ];

  // ── 搜索 ──
  const handlePlanSearch = () => {
    setPPage(1);
    setSubmittedPlanKeyword(planKeyword);
    void queryClient.invalidateQueries({ queryKey: paymentContractKeys.planLists });
  };
  const handlePlanReset = () => {
    setPlanKeyword('');
    setPPage(1);
    setSubmittedPlanKeyword('');
    void queryClient.invalidateQueries({ queryKey: paymentContractKeys.planLists });
  };

  const exportQuery = {
    applicationId: effectiveContractAppId,
    keyword: submittedParams.keyword || undefined,
    status: submittedParams.status || undefined,
    channel: submittedParams.channel || undefined,
  };

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="协议号/签约账号/业务ID..." value={draftParams.keyword} onChange={(v) => setDraftParams((p) => ({ ...p, keyword: v }))} onSearch={handleSearch} />
  );
  const renderAppFilter = () => (
    <Select
      placeholder="支付应用"
      value={effectiveContractAppId}
      onChange={(value) => {
        setContractAppId(value as number);
        setCPage(1);
      }}
      optionList={appOptions}
      filter
      loading={appsQuery.isFetching}
      style={{ width: 180 }}
    />
  );
  const renderStatusFilter = () => (
    <StatusSelect items={contractStatusOptions} value={draftParams.status} onChange={(v) => setDraftParams((p) => ({ ...p, status: v }))} />
  );
  const renderChannelFilter = () => (
    <FilterSelect
      placeholder="全部渠道"
      items={channelOptions}
      value={draftParams.channel}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: v }))}
    />
  );
  const renderSearchButton = () => <SearchButton onClick={handleSearch} disabled={effectiveContractAppId == null} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const renderCreateContract = () => canManage ? (
    <CreateButton onClick={() => { setSelectedAppId(null); signModal.openCreate(); }}>新增签约</CreateButton>
  ) : null;
  const renderExportButtons = () => <ExportButton entity="payment.contracts" query={exportQuery} />;

  const renderPlanKeywordSearch = () => (
    <KeywordInput placeholder="计划名称..." value={planKeyword} onChange={setPlanKeyword} onSearch={handlePlanSearch} width={200} />
  );
  const renderPlanSearchButton = () => <SearchButton onClick={handlePlanSearch} />;
  const renderPlanResetButton = () => <ResetButton onClick={handlePlanReset} />;
  const renderCreatePlan = () => canPlan ? (
    <CreateButton onClick={openCreatePlan} />
  ) : null;

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as 'contracts' | 'plans')} type="line" lazyRender keepDOM={false}>
        <TabPane tab="签约协议" itemKey="contracts">
          <SearchToolbar
            primary={(
              <>
                {renderKeywordSearch()}
                {renderAppFilter()}
                {renderStatusFilter()}
                {renderChannelFilter()}
                {renderSearchButton()}
                {renderResetButton()}
                {renderExportButtons()}
                {renderCreateContract()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderKeywordSearch()}
                {renderSearchButton()}
                {renderCreateContract()}
              </>
            )}
            mobileFilters={(
              <>
                {renderStatusFilter()}
                {renderChannelFilter()}
              </>
            )}
            filterTitle="签约协议筛选"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
            mobileActions={<ExportButton entity="payment.contracts" query={exportQuery} variant="flat" />}
          />
          <ConfigurableTable
            bordered columns={contractColumns} dataSource={contracts} loading={appsQuery.isFetching || contractQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void contractQuery.refetch()} refreshLoading={contractQuery.isFetching} pagination={buildCPagination(contractTotal)}
          />
        </TabPane>
        <TabPane tab="扣款计划" itemKey="plans">
          <SearchToolbar
            primary={(
              <>
                {renderPlanKeywordSearch()}
                {renderPlanSearchButton()}
                {renderPlanResetButton()}
                {renderCreatePlan()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderPlanKeywordSearch()}
                {renderPlanSearchButton()}
                {renderCreatePlan()}
              </>
            )}
          />
          <ConfigurableTable
            bordered columns={planColumns} dataSource={plans} loading={planQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void planQuery.refetch()} refreshLoading={planQuery.isFetching} pagination={buildPPagination(planTotal)}
          />
        </TabPane>
      </Tabs>

      <AppModal {...planModal.modalProps} width={660}>
        <Form key={planModal.formKey} {...planModal.formProps}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="计划名称" placeholder="如：连续包月 VIP" rules={[{ required: true, message: '计划名称不能为空' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="period" label="扣款周期" style={{ width: '100%' }} optionList={PAYMENT_DEDUCT_PERIOD_OPTIONS} onChange={(v) => setPlanPeriod(v as PaymentDeductPeriod)} rules={[{ required: true, message: '请选择周期' }]} />
            </Col>
          </Row>
          {planPeriod === 'custom' && (
            <Row gutter={16}>
              <Col span={12}>
                <Form.InputNumber field="customDays" label="周期天数" min={1} max={3650} style={{ width: '100%' }} rules={[{ required: true, message: '自定义周期必须填写天数' }]} />
              </Col>
            </Row>
          )}
          <Row gutter={16}>
            <Col span={12}>
              <Form.InputNumber field="amountYuan" label="每期金额(元)" min={0.01} step={0.01} precision={2} style={{ width: '100%' }} rules={[{ required: true, message: '每期金额不能为空' }]} />
            </Col>
            <Col span={12}>
              <Form.InputNumber field="maxRetries" label="失败重试上限" min={0} max={10} style={{ width: '100%' }} extraText="连续扣款失败达到上限后协议自动暂停" />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
            </Col>
          </Row>
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>

      <AppModal {...signModal.modalProps} title="新增签约（演示/测试）" width={660}>
        <Form key={signModal.formKey} {...signModal.formProps} initValues={{ ...signModal.formProps.initValues, currency: 'CNY' }}>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="applicationId" label="支付应用" style={{ width: '100%' }} optionList={appOptions} filter loading={appsQuery.isFetching}
                onChange={(value) => { setSelectedAppId((value as number | undefined) ?? null); signModal.formApi.current?.setValue('payMethod', undefined); }} rules={[{ required: true, message: '请选择支付应用' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="planId" label="扣款计划" style={{ width: '100%' }} rules={[{ required: true, message: '请选择扣款计划' }]}
                optionList={allPlans.map((p) => ({ value: p.id, label: `${p.name}（${describePlanPeriod(p)} ${yuan(p.amount)}）` }))} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="payMethod" label="代扣方式" style={{ width: '100%' }} optionList={deductMethodOptions} disabled={selectedAppId == null} rules={[{ required: true, message: '请选择代扣方式' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="currency" label="币种" style={{ width: '100%' }} optionList={[{ value: 'CNY', label: 'CNY · 人民币' }]} disabled rules={[{ required: true, message: '请选择币种' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="signerAccount" label="签约账号" placeholder="微信 openid / 支付宝账号" rules={[{ required: true, message: '签约账号不能为空' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="signerName" label="签约人" placeholder="可选" />
            </Col>
          </Row>
          <Form.Switch field="firstDeductNow" label="立即首扣" extraText="签约成功后立即执行首期扣款（沙箱渠道即时成功）" />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>
    </div>
  );
}
