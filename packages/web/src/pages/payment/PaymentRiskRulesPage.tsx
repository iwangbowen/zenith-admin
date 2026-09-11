import type { CSSProperties } from 'react';
import { useState } from 'react';
import { formatYuan } from '@/utils/payment';
import { Banner, Form, Space, Tabs, TabPane, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { AppModal } from '@/components/AppModal';
import { copyableNoColumn, createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import {
  paymentRiskKeys,
  useApprovePaymentRiskReview,
  useDeletePaymentRiskRules,
  usePaymentRiskHitList,
  usePaymentRiskReviewList,
  usePaymentRiskRuleList,
  useRejectPaymentRiskReview,
  useSavePaymentRiskRule,
} from '@/hooks/queries/payment-risk';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_RISK_ACTIONS, PAYMENT_RISK_DIMENSION_LABELS, PAYMENT_RISK_HIT_QUERY_DIMENSIONS, PAYMENT_RISK_REVIEW_STATUS_LABELS, PAYMENT_RISK_REVIEW_STATUSES, PAYMENT_RISK_SCOPE_LABELS, PAYMENT_RISK_SCOPES, PAYMENT_CHANNEL_OPTIONS, PAYMENT_RISK_SCOPE_OPTIONS, PAYMENT_RISK_ACTION_OPTIONS, PAYMENT_RISK_DIMENSION_OPTIONS, PAYMENT_RISK_REVIEW_STATUS_OPTIONS } from '@zenith/shared/payment';
import type { CreatePaymentRiskRuleInput, PaymentChannel, PaymentRiskAction, PaymentRiskDimension, PaymentRiskHit, PaymentRiskReview, PaymentRiskReviewStatus, PaymentRiskRule, PaymentRiskScope } from '@zenith/shared/payment';
import { useDictItems } from '@/hooks/useDictItems';
import { useRuleListList } from '@/hooks/queries/rules';
import { useListSearch } from '@/hooks/useListSearch';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { deleteAction, useStatusToggle, ListSearchToolbar, listTableProps } from '@/components/list-page';

import { useUrlTabState } from '@/hooks/useUrlTabState';
const yuan = formatYuan;
const channelOptions = PAYMENT_CHANNEL_OPTIONS;
const scopeOptions = PAYMENT_RISK_SCOPE_OPTIONS;
const actionOptions = PAYMENT_RISK_ACTION_OPTIONS;
// 命中记录只支持按规则维度筛选（服务端 hits 查询不接受 decision）
const dimensionOptions = PAYMENT_RISK_DIMENSION_OPTIONS.filter((option) => enumValueOf(PAYMENT_RISK_HIT_QUERY_DIMENSIONS, option.value) !== undefined);
const reviewStatusOptions = PAYMENT_RISK_REVIEW_STATUS_OPTIONS;
const REVIEW_STATUS_COLOR = { pending: 'orange', approved: 'green', rejected: 'red' } as const satisfies Record<PaymentRiskReviewStatus, string>;

interface SearchParams { scope?: string; status?: string; }
const defaultSearch: SearchParams = { scope: undefined, status: undefined };

interface RiskFormValues {
  name: string;
  scope: PaymentRiskScope;
  channel?: PaymentChannel;
  bizType?: string;
  singleYuan?: number;
  dailyYuan?: number;
  dailyCountLimit?: number;
  blockListKeys?: string[];
  allowListKeys?: string[];
  action?: PaymentRiskAction;
  status?: 'enabled' | 'disabled';
  remark?: string;
}

type ReviewDecision = 'approve' | 'reject';

export default function PaymentRiskRulesPage() {
  const { items: statusItems, options: statusOptions } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const canReview = hasPermission('payment:risk:review');
  const canReadRuleLists = hasPermission('rule:list:list');
  const [activeTab, setActiveTab] = useUrlTabState(['rules', 'hits', 'reviews'] as const, 'rules');
  const [reviewTarget, setReviewTarget] = useState<PaymentRiskReview | null>(null);
  const [reviewDecision, setReviewDecision] = useState<ReviewDecision | null>(null);
  const [reviewRemark, setReviewRemark] = useState('');

  // ── 规则 ──
  const {
    page, pageSize, buildPagination,
    bind, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentRiskKeys.lists });
  const [scopeWatch, setScopeWatch] = useState<PaymentRiskScope>('global');

  // ── 拦截记录 / 审核队列：各自独立的搜索 + 分页 ──
  const hitSearch = useListSearch<{ keyword: string; action?: string; dimension?: string }>({ defaults: { keyword: '' }, listKey: paymentRiskKeys.hitLists });
  const reviewSearch = useListSearch<{ keyword: string; status?: string }>({ defaults: { keyword: '' }, listKey: paymentRiskKeys.reviewLists });
  const submittedHitParams = hitSearch.submittedParams;
  const submittedReviewParams = reviewSearch.submittedParams;

  const listQuery = usePaymentRiskRuleList({
    page,
    pageSize,
    scope: enumValueOf(PAYMENT_RISK_SCOPES, submittedParams.scope),
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  });
  const hitQuery = usePaymentRiskHitList({
    page: hitSearch.page,
    pageSize: hitSearch.pageSize,
    keyword: submittedHitParams.keyword || undefined,
    action: enumValueOf(PAYMENT_RISK_ACTIONS, submittedHitParams.action),
    dimension: enumValueOf(PAYMENT_RISK_HIT_QUERY_DIMENSIONS, submittedHitParams.dimension),
  });
  const hits = hitQuery.data?.list ?? [];
  const hitTotal = hitQuery.data?.total ?? 0;
  const reviewQuery = usePaymentRiskReviewList({
    page: reviewSearch.page,
    pageSize: reviewSearch.pageSize,
    keyword: submittedReviewParams.keyword || undefined,
    status: enumValueOf(PAYMENT_RISK_REVIEW_STATUSES, submittedReviewParams.status),
  });
  const reviews = reviewQuery.data?.list ?? [];
  const reviewTotal = reviewQuery.data?.total ?? 0;

  const saveMutation = useSavePaymentRiskRule();
  const toggleMutation = useSavePaymentRiskRule();
  const deleteMutation = useDeletePaymentRiskRules();
  const approveMutation = useApprovePaymentRiskReview();
  const rejectMutation = useRejectPaymentRiskReview();
  const status = useStatusToggle<PaymentRiskRule>({
    toggle: (record, checked) => toggleMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } }),
    disabled: !hasPermission('payment:risk:update'),
  });

  // 名单库下拉源（黑名单字段可选 black/grey，白名单字段仅 white）
  const ruleListsQuery = useRuleListList({ page: 1, pageSize: 100 }, canReadRuleLists);
  const allRuleLists = ruleListsQuery.data?.list ?? [];
  const blockListOptions = allRuleLists.filter((l) => l.type !== 'white').map((l) => ({ value: l.key, label: `${l.name}（${l.key}）` }));
  const allowListOptions = allRuleLists.filter((l) => l.type === 'white').map((l) => ({ value: l.key, label: `${l.name}（${l.key}）` }));


  const modal = useEditModal<PaymentRiskRule, RiskFormValues, Partial<CreatePaymentRiskRuleInput>>({
    entityName: '风控规则',
    save: saveMutation,
    defaults: { scope: 'global', status: 'enabled', action: 'block', blockListKeys: [], allowListKeys: [] },
    toValues: (record) => ({
      name: record.name,
      scope: record.scope,
      channel: record.channel ?? undefined,
      bizType: record.bizType ?? undefined,
      singleYuan: record.singleLimit != null ? record.singleLimit / 100 : undefined,
      dailyYuan: record.dailyLimit != null ? record.dailyLimit / 100 : undefined,
      dailyCountLimit: record.dailyCountLimit ?? undefined,
      blockListKeys: record.blockListKeys ?? [],
      allowListKeys: record.allowListKeys ?? [],
      action: record.action,
      status: record.status,
      remark: record.remark ?? '',
    }),
    beforeSave: (values, { editing }) => ({
      name: values.name,
      scope: values.scope,
      channel: values.scope === 'channel' ? values.channel : undefined,
      bizType: values.scope === 'bizType' ? values.bizType : undefined,
      singleLimit: values.singleYuan != null ? Math.round(values.singleYuan * 100) : undefined,
      dailyLimit: values.dailyYuan != null ? Math.round(values.dailyYuan * 100) : undefined,
      dailyCountLimit: values.dailyCountLimit ?? undefined,
      blockListKeys: canReadRuleLists ? (values.blockListKeys ?? []) : (editing?.blockListKeys ?? []),
      allowListKeys: canReadRuleLists ? (values.allowListKeys ?? []) : (editing?.allowListKeys ?? []),
      action: values.action ?? 'block',
      status: values.status,
      remark: values.remark || undefined,
    }),
    labelWidth: 100,
  });

  function openCreate() { setScopeWatch('global'); modal.openCreate(); }
  function openEdit(record: PaymentRiskRule) { setScopeWatch(record.scope); modal.openEdit(record); }

  function openReviewDecision(r: PaymentRiskReview, decision: ReviewDecision) {
    setReviewTarget(r);
    setReviewDecision(decision);
    setReviewRemark('');
  }

  function closeReviewDecision() {
    setReviewTarget(null);
    setReviewDecision(null);
    setReviewRemark('');
  }

  async function submitReviewDecision() {
    if (!reviewTarget || !reviewDecision) return;
    const remark = reviewRemark.trim();
    if (!remark) {
      Toast.warning('请填写审核意见');
      return;
    }
    if (reviewDecision === 'approve') {
      await approveMutation.mutateAsync({ params: { id: reviewTarget.id }, body: { remark } });
      Toast.success('已放行');
    } else {
      await rejectMutation.mutateAsync({ params: { id: reviewTarget.id }, body: { remark } });
      Toast.success('已拒绝');
    }
    closeReviewDecision();
  }

  const columns: ColumnProps<PaymentRiskRule>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 220, render: renderEllipsis },
    { title: '作用域', dataIndex: 'scope', width: 100, render: (v: PaymentRiskScope) => PAYMENT_RISK_SCOPE_LABELS[v] },
    { title: '范围', dataIndex: 'channel', width: 150, render: (_: unknown, r: PaymentRiskRule) => {
      const text = r.scope === 'channel' ? (r.channel ? PAYMENT_CHANNEL_LABELS[r.channel] : '-') : r.scope === 'bizType' ? (r.bizType || '-') : '全局';
      return <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 130 }}>{text}</Typography.Text>;
    } },
    { title: '命中动作', dataIndex: 'action', width: 100, render: (v: PaymentRiskAction) => (v === 'review' ? <Tag color="orange">人工审核</Tag> : <Tag color="red">直接拦截</Tag>) },
    { title: '单笔上限', dataIndex: 'singleLimit', width: 110, align: 'right', render: (v: number | null) => yuan(v) },
    { title: '当日限额', dataIndex: 'dailyLimit', width: 110, align: 'right', render: (v: number | null) => yuan(v) },
    { title: '当日笔数', dataIndex: 'dailyCountLimit', width: 95, align: 'right', render: (v: number | null) => (v == null ? '-' : v) },
    { title: '黑名单', dataIndex: 'blockListKeys', width: 150, render: (v: string[]) => (v?.length ? <Space spacing={4} wrap>{v.map((k) => <Tag key={k} size="small" color="red">{k}</Tag>)}</Space> : '-') },
    { title: '白名单', dataIndex: 'allowListKeys', width: 150, render: (v: string[]) => (v?.length ? <Space spacing={4} wrap>{v.map((k) => <Tag key={k} size="small" color="green">{k}</Tag>)}</Space> : '-') },
    createdAtColumn as ColumnProps<PaymentRiskRule>,
    status.column(),
    createOperationColumn<PaymentRiskRule>({
      width: 150,
      actions: (r) => [
        ...(hasPermission('payment:risk:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(r),
        }] : []),
        deleteAction({
          hidden: !hasPermission('payment:risk:delete'),
          title: '确定要删除吗？',
          content: '删除后不可恢复',
          run: () => deleteMutation.mutateAsync([r.id]),
        }),
      ],
    }),
  ];

  const hitColumns: ColumnProps<PaymentRiskHit>[] = [
    { title: '命中规则', dataIndex: 'ruleName', minWidth: 200, render: renderEllipsis },
    { title: '动作', dataIndex: 'action', width: 90, render: (v: PaymentRiskAction) => (v === 'review' ? <Tag color="orange">送审</Tag> : <Tag color="red">拦截</Tag>) },
    { title: '命中维度', dataIndex: 'dimension', width: 110, render: (v: PaymentRiskDimension) => PAYMENT_RISK_DIMENSION_LABELS[v] },
    { title: '命中详情', dataIndex: 'dimensionValue', width: 180, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 160 }}>{v || '-'}</Typography.Text> },
    { title: '渠道', dataIndex: 'channel', width: 90, render: (v: PaymentChannel) => PAYMENT_CHANNEL_LABELS[v] },
    { title: '业务', dataIndex: 'bizType', width: 140, render: (v: string, r) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{`${v}:${r.bizId}`}</Typography.Text> },
    { title: '金额', dataIndex: 'amount', width: 100, align: 'right', render: (v: number) => yuan(v) },
    copyableNoColumn('订单号', 'orderNo'),
    { title: 'IP', dataIndex: 'clientIp', width: 150, render: renderEllipsis },
    dateTimeColumn('命中时间', 'createdAt', { fixed: 'right' }),
  ];

  const reviewColumns: ColumnProps<PaymentRiskReview>[] = [
    copyableNoColumn('审核单号', 'reviewNo'),
    copyableNoColumn('订单号', 'orderNo'),
    { title: '渠道', dataIndex: 'channel', width: 90, render: (v: PaymentChannel) => PAYMENT_CHANNEL_LABELS[v] },
    { title: '业务', dataIndex: 'bizType', width: 140, render: (v: string, r) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{`${v}:${r.bizId}`}</Typography.Text> },
    { title: '金额', dataIndex: 'amount', width: 100, align: 'right', render: (v: number) => yuan(v) },
    { title: '触发原因', dataIndex: 'reason', minWidth: 220, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>{v}</Typography.Text> },
    { title: '审核人', dataIndex: 'reviewerName', width: 120, render: renderEllipsis },
    { title: '审核意见', dataIndex: 'reviewRemark', width: 220, render: renderEllipsis },
    dateTimeColumn('审核时间', 'reviewedAt'),
    createdAtColumn as ColumnProps<PaymentRiskReview>,
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentRiskReviewStatus) => <Tag color={REVIEW_STATUS_COLOR[v]}>{PAYMENT_RISK_REVIEW_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentRiskReview>({
      width: 150,
      actions: (r) => (canReview && r.status === 'pending' ? [{
        key: 'approve',
        label: '放行',
        onClick: () => openReviewDecision(r, 'approve'),
      }, {
        key: 'reject',
        label: '拒绝',
        danger: true,
        onClick: () => openReviewDecision(r, 'reject'),
      }] : []),
    }),
  ];

  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as 'rules' | 'hits' | 'reviews')} type="line" lazyRender keepDOM={false}>
        <TabPane tab="限额规则" itemKey="rules">
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 8 }}>
            两层裁决：规则中心决策表 <Typography.Text code size="small">payment_risk</Typography.Text> 发布后优先接管（输出 block / review / pass，未命中回退本页规则）；名单统一引用规则中心名单库
          </Typography.Text>
          <ListSearchToolbar
            keyword={(
              <FilterSelect
                placeholder="全部作用域"
                items={scopeOptions}
                {...bind('scope')}
                width={140}
              />
            )}
            filters={<StatusSelect items={statusItems} {...bind('status')} />}
            onSearch={handleSearch}
            onReset={handleReset}
            create={(
              hasPermission('payment:risk:create') ? (
                <CreateButton onClick={openCreate} />
              ) : null
            )}
            filterTitle="风控规则筛选"
          />
          <ConfigurableTable
 columns={columns} empty="暂无数据"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />
        </TabPane>

        <TabPane tab="拦截记录" itemKey="hits">
          <ListSearchToolbar
            keyword={<KeywordInput placeholder="规则名/订单号/业务ID..." {...hitSearch.bindKeyword('keyword')} />}
            filters={(
              <>
                <FilterSelect placeholder="全部动作" items={actionOptions} {...hitSearch.bind('action')} />
                <FilterSelect
                  placeholder="全部维度"
                  items={dimensionOptions}
                  {...hitSearch.bind('dimension')}
                />
              </>
            )}
            onSearch={hitSearch.handleSearch}
            onReset={hitSearch.handleReset}
            filterTitle="拦截记录筛选"
          />
          <ConfigurableTable
            bordered columns={hitColumns} dataSource={hits} loading={hitQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void hitQuery.refetch()} refreshLoading={hitQuery.isFetching} pagination={hitSearch.buildPagination(hitTotal)}
          />
        </TabPane>

        <TabPane tab="审核队列" itemKey="reviews">
          <ListSearchToolbar
            keyword={<KeywordInput placeholder="审核单号/订单号/业务ID..." {...reviewSearch.bindKeyword('keyword')} />}
            filters={<StatusSelect items={reviewStatusOptions} {...reviewSearch.bind('status')} />}
            onSearch={reviewSearch.handleSearch}
            onReset={reviewSearch.handleReset}
            filterTitle="审核队列筛选"
          />
          <ConfigurableTable
            bordered columns={reviewColumns} dataSource={reviews} loading={reviewQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
            onRefresh={() => void reviewQuery.refetch()} refreshLoading={reviewQuery.isFetching} pagination={reviewSearch.buildPagination(reviewTotal)}
          />
        </TabPane>
      </Tabs>

      <AppModal {...modal.modalProps} width={700}>
        <Form
          key={modal.formKey} {...modal.formProps}
          onValueChange={(v) => { if (v.scope && v.scope !== scopeWatch) setScopeWatch(v.scope as PaymentRiskScope); }}
        >
          <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
            <Form.Input field="name" label="名称" placeholder="如：大额交易拦截" rules={[{ required: true, message: '名称不能为空' }]} />
            <Form.Select field="scope" label="作用域" style={{ width: '100%' }} optionList={scopeOptions} rules={[{ required: true, message: '请选择作用域' }]} />
          </div>
          {scopeWatch === 'channel' && <Form.Select field="channel" label="渠道" style={{ width: '100%' }} optionList={channelOptions} rules={[{ required: true, message: '请选择渠道' }]} />}
          {scopeWatch === 'bizType' && <Form.Input field="bizType" label="业务类型" placeholder="如：membership" rules={[{ required: true, message: '请输入业务类型' }]} />}
          <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
            <Form.Select field="action" label="命中动作" style={{ width: '100%' }} optionList={actionOptions} rules={[{ required: true, message: '请选择命中动作' }]} />
            <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} />
          </div>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', margin: '-8px 0 8px 100px' }}>直接拦截=命中即拒绝下单；人工审核=订单挂起进入审核队列，放行后可继续支付</Typography.Text>
          <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
            <Form.InputNumber field="singleYuan" label="单笔上限(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
            <Form.InputNumber field="dailyYuan" label="当日累计(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
          </div>
          <Form.InputNumber field="dailyCountLimit" label="当日笔数" min={0} step={1} precision={0} style={{ width: '100%' }} placeholder="可选" />
          {canReadRuleLists ? (
            <>
              <Form.Select
                field="blockListKeys" label="黑名单" multiple filter showClear style={{ width: '100%' }}
                placeholder="选择规则中心名单库（黑/灰名单）" optionList={blockListOptions}
              />
              <Form.Select
                field="allowListKeys" label="白名单" multiple filter showClear style={{ width: '100%' }}
                placeholder="选择规则中心名单库（白名单）" optionList={allowListOptions}
              />
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', margin: '-8px 0 8px 100px' }}>
                名单引用自规则中心名单库（条目、过期与批量导入在<Typography.Text link={{ href: '/rules/lists' }} size="small">名单库</Typography.Text>统一管理）；黑名单命中执行规则动作，白名单命中跳过本规则全部检查
              </Typography.Text>
            </>
          ) : (
            <Banner
              type="warning"
              closeIcon={null}
              style={{ marginBottom: 12 }}
              description="当前账号无规则中心名单库查看权限，不能选择或修改名单引用；编辑时将保留原有名单配置。"
            />
          )}
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>

      <AppModal
        title={reviewDecision === 'reject' ? '拒绝风险审核' : '放行风险审核'}
        visible={!!reviewTarget}
        onCancel={closeReviewDecision}
        onOk={submitReviewDecision}
        okText={reviewDecision === 'reject' ? '确认拒绝' : '确认放行'}
        okButtonProps={{
          loading: approveMutation.isPending || rejectMutation.isPending,
          ...(reviewDecision === 'reject' ? { type: 'danger' as const, theme: 'solid' as const } : {}),
        }}
        width={520}
        closeOnEsc
      >
        {reviewTarget && (
          <Form labelPosition="left" labelWidth={100}>
            <Form.Slot label="审核单号">{reviewTarget.reviewNo}</Form.Slot>
            <Form.Slot label="交易金额"><Typography.Text type="danger">{yuan(reviewTarget.amount)}</Typography.Text></Form.Slot>
            <Form.Slot label="处理影响">
              {reviewDecision === 'reject' ? '拒绝后挂起订单将被关闭' : '放行后用户可重新发起支付'}
            </Form.Slot>
            <Form.Slot label="审核意见">
              <TextArea
                value={reviewRemark}
                onChange={setReviewRemark}
                autosize
                rows={3}
                maxCount={256}
                placeholder="请填写判断依据和处理意见（必填）"
              />
            </Form.Slot>
          </Form>
        )}
      </AppModal>
    </div>
  );
}
