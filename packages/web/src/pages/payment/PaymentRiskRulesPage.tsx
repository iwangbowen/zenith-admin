import { useState, useRef } from 'react';
import { formatYuan } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Modal, Select, Switch, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { createdAtColumn } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  paymentRiskKeys,
  useDeletePaymentRiskRule,
  usePaymentRiskRuleList,
  useSavePaymentRiskRule,
} from '@/hooks/queries/payment-risk';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_RISK_SCOPE_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentRiskRule, PaymentRiskScope } from '@zenith/shared';

const yuan = formatYuan;
const channelOptions = Object.entries(PAYMENT_CHANNEL_LABELS).map(([value, label]) => ({ value, label }));
const scopeOptions = Object.entries(PAYMENT_RISK_SCOPE_LABELS).map(([value, label]) => ({ value, label }));

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
  status?: 'enabled' | 'disabled';
  remark?: string;
}

export default function PaymentRiskRulesPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PaymentRiskRule | null>(null);
  const [scopeWatch, setScopeWatch] = useState<PaymentRiskScope>('global');

  const listQuery = usePaymentRiskRuleList({
    page,
    pageSize,
    scope: submittedParams.scope || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const saveMutation = useSavePaymentRiskRule();
  const toggleMutation = useSavePaymentRiskRule();
  const deleteMutation = useDeletePaymentRiskRule();
  const togglingId = toggleMutation.isPending ? (toggleMutation.variables?.id ?? null) : null;

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentRiskKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearch); setPage(1); setSubmittedParams(defaultSearch); void queryClient.invalidateQueries({ queryKey: paymentRiskKeys.lists }); }

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
        status: editing.status,
        remark: editing.remark ?? '',
      }
    : { scope: 'global', status: 'enabled', blocklist: [] };

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

  const columns: ColumnProps<PaymentRiskRule>[] = [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '作用域', dataIndex: 'scope', width: 110, render: (v: PaymentRiskScope) => PAYMENT_RISK_SCOPE_LABELS[v] },
    { title: '范围', dataIndex: 'channel', width: 120, render: (_: unknown, r: PaymentRiskRule) => (r.scope === 'channel' ? (r.channel ? PAYMENT_CHANNEL_LABELS[r.channel] : '-') : r.scope === 'bizType' ? (r.bizType || '-') : '全局') },
    { title: '单笔上限', dataIndex: 'singleLimit', width: 110, render: (v: number | null) => yuan(v) },
    { title: '当日限额', dataIndex: 'dailyLimit', width: 110, render: (v: number | null) => yuan(v) },
    { title: '当日笔数', dataIndex: 'dailyCountLimit', width: 100, render: (v: number | null) => (v == null ? '-' : v) },
    { title: '黑名单', dataIndex: 'blocklist', width: 90, render: (v: string[]) => (v.length ? <Tag color="red">{v.length} 项</Tag> : '-') },
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

  const renderScopeFilter = () => (
    <Select
      placeholder="全部作用域"
      value={draftParams.scope || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, scope: (v as string) ?? '' }))}
      showClear
      style={{ width: 130 }}
      optionList={scopeOptions}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => hasPermission('payment:risk:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  return (
    <div className="page-container">
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
        mobileFilters={(
          <>
            {renderStatusFilter()}
          </>
        )}
        filterTitle="风控规则筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(total)}
      />

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
            <Form.InputNumber field="singleYuan" label="单笔上限(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
            <Form.InputNumber field="dailyYuan" label="当日累计(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
            <Form.InputNumber field="dailyCountLimit" label="当日笔数" min={0} step={1} precision={0} style={{ width: '100%' }} placeholder="可选" />
            <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={[{ value: 'enabled', label: '启用' }, { value: 'disabled', label: '停用' }]} />
          </div>
          <Form.TagInput field="blocklist" label="黑名单" placeholder="输入 openId / userId 后回车" />
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', margin: '-8px 0 8px 100px' }}>命中黑名单的 openId / userId 将被拦截下单</Typography.Text>
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
        </Form>
      </AppModal>
    </div>
  );
}
