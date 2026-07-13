import { useState, useRef } from 'react';
import { formatYuan } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, Select, Switch, Tabs, TabPane, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { formatDateTime } from '@/utils/date';
import { createdAtColumn } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  paymentRiskKeys,
  useApprovePaymentRiskReview,
  useDeletePaymentRiskRule,
  usePaymentRiskHitList,
  usePaymentRiskReviewList,
  usePaymentRiskRuleList,
  useRejectPaymentRiskReview,
  useSavePaymentRiskRule,
} from '@/hooks/queries/payment-risk';
import {
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_RISK_ACTION_LABELS,
  PAYMENT_RISK_DIMENSION_LABELS,
  PAYMENT_RISK_REVIEW_STATUS_LABELS,
  PAYMENT_RISK_SCOPE_LABELS,
} from '@zenith/shared';
import type {
  PaymentChannel,
  PaymentRiskAction,
  PaymentRiskDimension,
  PaymentRiskHit,
  PaymentRiskReview,
  PaymentRiskReviewStatus,
  PaymentRiskRule,
  PaymentRiskScope,
} from '@zenith/shared';
import { useDictItems } from '@/hooks/useDictItems';

const yuan = formatYuan;
const channelOptions = Object.entries(PAYMENT_CHANNEL_LABELS).map(([value, label]) => ({ value, label }));
const scopeOptions = Object.entries(PAYMENT_RISK_SCOPE_LABELS).map(([value, label]) => ({ value, label }));
const actionOptions = Object.entries(PAYMENT_RISK_ACTION_LABELS).map(([value, label]) => ({ value, label }));
const dimensionOptions = Object.entries(PAYMENT_RISK_DIMENSION_LABELS).map(([value, label]) => ({ value, label }));
const reviewStatusOptions = Object.entries(PAYMENT_RISK_REVIEW_STATUS_LABELS).map(([value, label]) => ({ value, label }));
const REVIEW_STATUS_COLOR = { pending: 'orange', approved: 'green', rejected: 'red' } as const satisfies Record<PaymentRiskReviewStatus, string>;

interface SearchParams { scope: string; status: string; }
const defaultSearch: SearchParams = { scope: '', status: '' };

interface RiskFormValues {
  name: string;
  scope: PaymentRiskScope;
  channel?: PaymentChannel;
  bizType?: string;
  singleYuan?: number;
  dailyYuan?: number;
  dailyCountLimit?: number;
  blocklist?: string[];
  allowlist?: string[];
  action?: PaymentRiskAction;
  status?: 'enabled' | 'disabled';
  remark?: string;
}

export default function PaymentRiskRulesPage() {
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canReview = hasPermission('payment:risk:review');
  const formApi = useRef<FormApi | null>(null);
  const [activeTab, setActiveTab] = useState<'rules' | 'hits' | 'reviews'>('rules');

  // ── 规则 ──
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PaymentRiskRule | null>(null);
  const [scopeWatch, setScopeWatch] = useState<PaymentRiskScope>('global');

  // ── 拦截记录 ──
  const { page: hPage, pageSize: hPageSize, setPage: setHPage, buildPagination: buildHPagination } = usePagination();
  const [hitKeyword, setHitKeyword] = useState('');
  const [hitAction, setHitAction] = useState('');
  const [hitDimension, setHitDimension] = useState('');
  const [submittedHitParams, setSubmittedHitParams] = useState({ keyword: '', action: '', dimension: '' });

  // ── 审核队列 ──
  const { page: rPage, pageSize: rPageSize, setPage: setRPage, buildPagination: buildRPagination } = usePagination();
  const [reviewKeyword, setReviewKeyword] = useState('');
  const [reviewStatus, setReviewStatus] = useState('');
  const [submittedReviewParams, setSubmittedReviewParams] = useState({ keyword: '', status: '' });

  const listQuery = usePaymentRiskRuleList({
    page,
    pageSize,
    scope: submittedParams.scope || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const hitQuery = usePaymentRiskHitList({
    page: hPage,
    pageSize: hPageSize,
    keyword: submittedHitParams.keyword || undefined,
    action: submittedHitParams.action || undefined,
    dimension: submittedHitParams.dimension || undefined,
  });
  const hits = hitQuery.data?.list ?? [];
  const hitTotal = hitQuery.data?.total ?? 0;
  const reviewQuery = usePaymentRiskReviewList({
    page: rPage,
    pageSize: rPageSize,
    keyword: submittedReviewParams.keyword || undefined,
    status: submittedReviewParams.status || undefined,
  });
  const reviews = reviewQuery.data?.list ?? [];
  const reviewTotal = reviewQuery.data?.total ?? 0;

  const saveMutation = useSavePaymentRiskRule();
  const toggleMutation = useSavePaymentRiskRule();
  const deleteMutation = useDeletePaymentRiskRule();
  const approveMutation = useApprovePaymentRiskReview();
  const rejectMutation = useRejectPaymentRiskReview();
  const togglingId = toggleMutation.isPending ? (toggleMutation.variables?.id ?? null) : null;

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentRiskKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearch); setPage(1); setSubmittedParams(defaultSearch); void queryClient.invalidateQueries({ queryKey: paymentRiskKeys.lists }); }
  function handleHitSearch() { setHPage(1); setSubmittedHitParams({ keyword: hitKeyword, action: hitAction, dimension: hitDimension }); void queryClient.invalidateQueries({ queryKey: paymentRiskKeys.hitLists }); }
  function handleHitReset() { setHitKeyword(''); setHitAction(''); setHitDimension(''); setHPage(1); setSubmittedHitParams({ keyword: '', action: '', dimension: '' }); void queryClient.invalidateQueries({ queryKey: paymentRiskKeys.hitLists }); }
  function handleReviewSearch() { setRPage(1); setSubmittedReviewParams({ keyword: reviewKeyword, status: reviewStatus }); void queryClient.invalidateQueries({ queryKey: paymentRiskKeys.reviewLists }); }
  function handleReviewReset() { setReviewKeyword(''); setReviewStatus(''); setRPage(1); setSubmittedReviewParams({ keyword: '', status: '' }); void queryClient.invalidateQueries({ queryKey: paymentRiskKeys.reviewLists }); }

  function openCreate() { setEditing(null); setScopeWatch('global'); setModalVisible(true); }
  function openEdit(record: PaymentRiskRule) { setEditing(record); setScopeWatch(record.scope); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const formInit: Partial<RiskFormValues> = editing
    ? {
        name: editing.name,
        scope: editing.scope,
        channel: editing.channel ?? undefined,
        bizType: editing.bizType ?? undefined,
        singleYuan: editing.singleLimit != null ? editing.singleLimit / 100 : undefined,
        dailyYuan: editing.dailyLimit != null ? editing.dailyLimit / 100 : undefined,
        dailyCountLimit: editing.dailyCountLimit ?? undefined,
        blocklist: editing.blocklist ?? [],
        allowlist: editing.allowlist ?? [],
        action: editing.action,
        status: editing.status,
        remark: editing.remark ?? '',
      }
    : { scope: 'global', status: 'enabled', action: 'block', blocklist: [], allowlist: [] };

  async function handleOk() {
    let values: RiskFormValues;
    try { values = (await formApi.current?.validate()) as RiskFormValues; } catch { throw new Error('validation'); }
    const payload = {
      name: values.name,
      scope: values.scope,
      channel: values.scope === 'channel' ? values.channel : undefined,
      bizType: values.scope === 'bizType' ? values.bizType : undefined,
      singleLimit: values.singleYuan != null ? Math.round(values.singleYuan * 100) : undefined,
      dailyLimit: values.dailyYuan != null ? Math.round(values.dailyYuan * 100) : undefined,
      dailyCountLimit: values.dailyCountLimit ?? undefined,
      blocklist: values.blocklist ?? [],
      allowlist: values.allowlist ?? [],
      action: values.action ?? 'block',
      status: values.status,
      remark: values.remark || undefined,
    };
    await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleToggle(record: PaymentRiskRule, checked: boolean) {
    await toggleMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } });
    Toast.success(checked ? '已启用' : '已停用');
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  function handleApprove(r: PaymentRiskReview) {
    Modal.confirm({
      title: '放行该交易？',
      content: `审核单 ${r.reviewNo}（${yuan(r.amount)}），放行后用户重新发起支付即可继续`,
      onOk: async () => {
        await approveMutation.mutateAsync({ id: r.id });
        Toast.success('已放行');
      },
    });
  }

  function handleReject(r: PaymentRiskReview) {
    Modal.confirm({
      title: '拒绝该交易？',
      content: `审核单 ${r.reviewNo}（${yuan(r.amount)}），拒绝后挂起订单将被关闭`,
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        await rejectMutation.mutateAsync({ id: r.id });
        Toast.success('已拒绝');
      },
    });
  }

  const columns: ColumnProps<PaymentRiskRule>[] = [
    { title: '名称', dataIndex: 'name', width: 150 },
    { title: '作用域', dataIndex: 'scope', width: 100, render: (v: PaymentRiskScope) => PAYMENT_RISK_SCOPE_LABELS[v] },
    { title: '范围', dataIndex: 'channel', width: 150, render: (_: unknown, r: PaymentRiskRule) => {
      const text = r.scope === 'channel' ? (r.channel ? PAYMENT_CHANNEL_LABELS[r.channel] : '-') : r.scope === 'bizType' ? (r.bizType || '-') : '全局';
      return <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 130 }}>{text}</Typography.Text>;
    } },
    { title: '命中动作', dataIndex: 'action', width: 100, render: (v: PaymentRiskAction) => (v === 'review' ? <Tag color="orange">人工审核</Tag> : <Tag color="red">直接拦截</Tag>) },
    { title: '单笔上限', dataIndex: 'singleLimit', width: 110, render: (v: number | null) => yuan(v) },
    { title: '当日限额', dataIndex: 'dailyLimit', width: 110, render: (v: number | null) => yuan(v) },
    { title: '当日笔数', dataIndex: 'dailyCountLimit', width: 95, render: (v: number | null) => (v == null ? '-' : v) },
    { title: '黑名单', dataIndex: 'blocklist', width: 85, render: (v: string[]) => (v.length ? <Tag color="red">{v.length} 项</Tag> : '-') },
    { title: '白名单', dataIndex: 'allowlist', width: 85, render: (v: string[]) => (v.length ? <Tag color="green">{v.length} 项</Tag> : '-') },
    createdAtColumn as ColumnProps<PaymentRiskRule>,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, r: PaymentRiskRule) => (
        <Switch checked={r.status === 'enabled'} loading={togglingId === r.id} disabled={!hasPermission('payment:risk:update')} size="small" onChange={(c) => void handleToggle(r, c)} />
      ),
    },
    createOperationColumn<PaymentRiskRule>({
      width: 120,
      actions: (r) => [
        ...(hasPermission('payment:risk:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(r),
        }] : []),
        ...(hasPermission('payment:risk:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除吗？',
              content: '删除后不可恢复',
              onOk: () => handleDelete(r.id),
            });
          },
        }] : []),
      ],
    }),
  ];

  const hitColumns: ColumnProps<PaymentRiskHit>[] = [
    { title: '命中规则', dataIndex: 'ruleName', width: 140 },
    { title: '动作', dataIndex: 'action', width: 90, render: (v: PaymentRiskAction) => (v === 'review' ? <Tag color="orange">送审</Tag> : <Tag color="red">拦截</Tag>) },
    { title: '命中维度', dataIndex: 'dimension', width: 110, render: (v: PaymentRiskDimension) => PAYMENT_RISK_DIMENSION_LABELS[v] },
    { title: '命中详情', dataIndex: 'dimensionValue', width: 180, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{v || '-'}</Typography.Text> },
    { title: '渠道', dataIndex: 'channel', width: 90, render: (v: PaymentChannel) => PAYMENT_CHANNEL_LABELS[v] },
    { title: '业务', dataIndex: 'bizType', width: 140, render: (v: string, r) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{`${v}:${r.bizId}`}</Typography.Text> },
    { title: '金额', dataIndex: 'amount', width: 100, render: (v: number) => yuan(v) },
    { title: '订单号', dataIndex: 'orderNo', width: 180, render: (v: string | null) => (v ? <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 160 }}>{v}</Typography.Text> : '-') },
    { title: 'IP', dataIndex: 'clientIp', width: 120, render: (v: string | null) => v || '-' },
    { title: '命中时间', dataIndex: 'createdAt', width: 170, fixed: 'right', render: (v: string) => formatDateTime(v) },
  ];

  const reviewColumns: ColumnProps<PaymentRiskReview>[] = [
    { title: '审核单号', dataIndex: 'reviewNo', width: 180, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 160 }}>{v}</Typography.Text> },
    { title: '订单号', dataIndex: 'orderNo', width: 180, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 160 }}>{v}</Typography.Text> },
    { title: '渠道', dataIndex: 'channel', width: 90, render: (v: PaymentChannel) => PAYMENT_CHANNEL_LABELS[v] },
    { title: '业务', dataIndex: 'bizType', width: 140, render: (v: string, r) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{`${v}:${r.bizId}`}</Typography.Text> },
    { title: '金额', dataIndex: 'amount', width: 100, render: (v: number) => yuan(v) },
    { title: '触发原因', dataIndex: 'reason', width: 220, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>{v}</Typography.Text> },
    { title: '审核人', dataIndex: 'reviewerName', width: 100, render: (v: string | null) => v || '-' },
    { title: '审核时间', dataIndex: 'reviewedAt', width: 170, render: (v: string | null) => (v ? formatDateTime(v) : '-') },
    createdAtColumn as ColumnProps<PaymentRiskReview>,
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentRiskReviewStatus) => <Tag color={REVIEW_STATUS_COLOR[v]}>{PAYMENT_RISK_REVIEW_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentRiskReview>({
      width: 130,
      actions: (r) => (canReview && r.status === 'pending' ? [{
        key: 'approve',
        label: '放行',
        onClick: () => handleApprove(r),
      }, {
        key: 'reject',
        label: '拒绝',
        danger: true,
        onClick: () => handleReject(r),
      }] : []),
    }),
  ];

  const renderScopeFilter = () => (
    <Select placeholder="全部作用域" value={draftParams.scope || undefined} onChange={(v) => setDraftParams((p) => ({ ...p, scope: (v as string) ?? '' }))} showClear style={{ width: 130 }} optionList={scopeOptions} />
  );
  const renderStatusFilter = () => (
    <Select placeholder="全部状态" value={draftParams.status || undefined} onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))} showClear style={{ width: 120 }} optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
  );
  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => hasPermission('payment:risk:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  const renderHitKeyword = () => (
    <Input prefix={<Search size={14} />} placeholder="规则名/订单号/业务ID..." value={hitKeyword} onChange={setHitKeyword} showClear style={{ width: 220 }} onEnterPress={handleHitSearch} />
  );
  const renderHitActionFilter = () => (
    <Select placeholder="全部动作" value={hitAction || undefined} onChange={(v) => setHitAction((v as string) ?? '')} showClear style={{ width: 120 }} optionList={actionOptions} />
  );
  const renderHitDimensionFilter = () => (
    <Select placeholder="全部维度" value={hitDimension || undefined} onChange={(v) => setHitDimension((v as string) ?? '')} showClear style={{ width: 140 }} optionList={dimensionOptions} />
  );

  const renderReviewKeyword = () => (
    <Input prefix={<Search size={14} />} placeholder="审核单号/订单号/业务ID..." value={reviewKeyword} onChange={setReviewKeyword} showClear style={{ width: 220 }} onEnterPress={handleReviewSearch} />
  );
  const renderReviewStatusFilter = () => (
    <Select placeholder="全部状态" value={reviewStatus || undefined} onChange={(v) => setReviewStatus((v as string) ?? '')} showClear style={{ width: 120 }} optionList={reviewStatusOptions} />
  );

  return (
    <div className="page-container page-tabs-page">
      <Tabs activeKey={activeTab} onChange={(k) => setActiveTab(k as 'rules' | 'hits' | 'reviews')} type="line" lazyRender keepDOM={false}>
        <TabPane tab="限额规则" itemKey="rules">
          <SearchToolbar
            primary={(
              <>
                {renderScopeFilter()}
                {renderStatusFilter()}
                {renderSearchButton()}
                {renderResetButton()}
                {renderCreateButton()}
              </>
            )}
            mobilePrimary={(
              <>
                {renderScopeFilter()}
                {renderSearchButton()}
                {renderCreateButton()}
              </>
            )}
            mobileFilters={renderStatusFilter()}
            filterTitle="风控规则筛选"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
          />
          <ConfigurableTable
            bordered columns={columns} dataSource={data} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(total)}
          />
        </TabPane>

        <TabPane tab="拦截记录" itemKey="hits">
          <SearchToolbar
            primary={(
              <>
                {renderHitKeyword()}
                {renderHitActionFilter()}
                {renderHitDimensionFilter()}
                <Button type="primary" icon={<Search size={14} />} onClick={handleHitSearch}>查询</Button>
                <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleHitReset}>重置</Button>
              </>
            )}
            mobilePrimary={(
              <>
                {renderHitKeyword()}
                <Button type="primary" icon={<Search size={14} />} onClick={handleHitSearch}>查询</Button>
              </>
            )}
            mobileFilters={(
              <>
                {renderHitActionFilter()}
                {renderHitDimensionFilter()}
              </>
            )}
            filterTitle="拦截记录筛选"
            onFilterApply={handleHitSearch}
            onFilterReset={handleHitReset}
          />
          <ConfigurableTable
            bordered columns={hitColumns} dataSource={hits} loading={hitQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void hitQuery.refetch()} refreshLoading={hitQuery.isFetching} pagination={buildHPagination(hitTotal)}
          />
        </TabPane>

        <TabPane tab="审核队列" itemKey="reviews">
          <SearchToolbar
            primary={(
              <>
                {renderReviewKeyword()}
                {renderReviewStatusFilter()}
                <Button type="primary" icon={<Search size={14} />} onClick={handleReviewSearch}>查询</Button>
                <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReviewReset}>重置</Button>
              </>
            )}
            mobilePrimary={(
              <>
                {renderReviewKeyword()}
                <Button type="primary" icon={<Search size={14} />} onClick={handleReviewSearch}>查询</Button>
              </>
            )}
            mobileFilters={renderReviewStatusFilter()}
            filterTitle="审核队列筛选"
            onFilterApply={handleReviewSearch}
            onFilterReset={handleReviewReset}
          />
          <ConfigurableTable
            bordered columns={reviewColumns} dataSource={reviews} loading={reviewQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void reviewQuery.refetch()} refreshLoading={reviewQuery.isFetching} pagination={buildRPagination(reviewTotal)}
          />
        </TabPane>
      </Tabs>

      <AppModal title={editing ? '编辑风控规则' : '新增风控规则'} visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: saveMutation.isPending }} width={700} closeOnEsc>
        <Form
          key={editing?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInit}
          labelPosition="left"
          labelWidth={100}
          onValueChange={(v) => { if (v.scope && v.scope !== scopeWatch) setScopeWatch(v.scope as PaymentRiskScope); }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
            <Form.Input field="name" label="名称" placeholder="如：大额交易拦截" rules={[{ required: true, message: '名称不能为空' }]} />
            <Form.Select field="scope" label="作用域" style={{ width: '100%' }} optionList={scopeOptions} rules={[{ required: true, message: '请选择作用域' }]} />
          </div>
          {scopeWatch === 'channel' && <Form.Select field="channel" label="渠道" style={{ width: '100%' }} optionList={channelOptions} rules={[{ required: true, message: '请选择渠道' }]} />}
          {scopeWatch === 'bizType' && <Form.Input field="bizType" label="业务类型" placeholder="如：membership" rules={[{ required: true, message: '请输入业务类型' }]} />}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
            <Form.Select field="action" label="命中动作" style={{ width: '100%' }} optionList={actionOptions} rules={[{ required: true, message: '请选择命中动作' }]} />
            <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
          </div>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', margin: '-8px 0 8px 100px' }}>直接拦截=命中即拒绝下单；人工审核=订单挂起进入审核队列，放行后可继续支付</Typography.Text>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
            <Form.InputNumber field="singleYuan" label="单笔上限(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
            <Form.InputNumber field="dailyYuan" label="当日累计(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
          </div>
          <Form.InputNumber field="dailyCountLimit" label="当日笔数" min={0} step={1} precision={0} style={{ width: '100%' }} placeholder="可选" />
          <Form.TagInput field="blocklist" label="黑名单" placeholder="输入 openid / 用户ID / IP 后回车" />
          <Form.TagInput field="allowlist" label="白名单" placeholder="输入 openid / 用户ID / IP 后回车" />
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', margin: '-8px 0 8px 100px' }}>黑名单命中执行规则动作；白名单命中跳过本规则全部检查</Typography.Text>
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>
    </div>
  );
}
