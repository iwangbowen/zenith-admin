import { useState, useRef } from 'react';
import { formatYuan, PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Modal, Select, Spin, Switch, Tag, Toast } from '@douyinfe/semi-ui';
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
  paymentFeeKeys,
  useDeletePaymentFeeRule,
  usePaymentFeeRuleList,
  useSavePaymentFeeRule,
} from '@/hooks/queries/payment-fee';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_METHOD_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentFeeRule, PaymentMethod } from '@zenith/shared';
import { useDictItems } from '@/hooks/useDictItems';

const yuan = formatYuan;
const channelOptions = Object.entries(PAYMENT_CHANNEL_LABELS).map(([value, label]) => ({ value, label }));
const methodOptions = Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => ({ value, label }));

interface SearchParams { channel: string; status: string; }
const defaultSearch: SearchParams = { channel: '', status: '' };

interface FeeFormValues {
  name: string;
  channel: PaymentChannel;
  payMethod?: PaymentMethod;
  ratePercent?: number;
  fixedYuan?: number;
  minYuan?: number;
  maxYuan?: number;
  priority?: number;
  status?: 'enabled' | 'disabled';
  remark?: string;
}

export default function PaymentFeeRulesPage() {
  const { items: statusItems } = useDictItems('common_status');
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);

  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PaymentFeeRule | null>(null);

  const listQuery = usePaymentFeeRuleList({
    page,
    pageSize,
    channel: submittedParams.channel || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const saveMutation = useSavePaymentFeeRule();
  const toggleMutation = useSavePaymentFeeRule();
  const deleteMutation = useDeletePaymentFeeRule();
  const togglingId = toggleMutation.isPending ? (toggleMutation.variables?.id ?? null) : null;

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentFeeKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearch); setPage(1); setSubmittedParams(defaultSearch); void queryClient.invalidateQueries({ queryKey: paymentFeeKeys.lists }); }

  function openCreate() { setEditing(null); setModalVisible(true); }
  function openEdit(record: PaymentFeeRule) { setEditing(record); setModalVisible(true); }
  function closeModal() { setModalVisible(false); setEditing(null); }

  const formInit: Partial<FeeFormValues> = editing
    ? {
        name: editing.name,
        channel: editing.channel,
        payMethod: editing.payMethod ?? undefined,
        ratePercent: editing.rateBps / 100,
        fixedYuan: editing.fixedFee / 100,
        minYuan: editing.minFee != null ? editing.minFee / 100 : undefined,
        maxYuan: editing.maxFee != null ? editing.maxFee / 100 : undefined,
        priority: editing.priority,
        status: editing.status,
        remark: editing.remark ?? '',
      }
    : { channel: 'wechat', status: 'enabled', priority: 0, ratePercent: 0.6, fixedYuan: 0 };

  async function handleOk() {
    let values: FeeFormValues;
    try { values = (await formApi.current?.validate()) as FeeFormValues; } catch { throw new Error('validation'); }
    const payload = {
      name: values.name,
      channel: values.channel,
      payMethod: values.payMethod || undefined,
      rateBps: Math.round((values.ratePercent ?? 0) * 100),
      fixedFee: Math.round((values.fixedYuan ?? 0) * 100),
      minFee: values.minYuan != null ? Math.round(values.minYuan * 100) : undefined,
      maxFee: values.maxYuan != null ? Math.round(values.maxYuan * 100) : undefined,
      priority: values.priority ?? 0,
      status: values.status,
      remark: values.remark || undefined,
    };
    await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleToggle(record: PaymentFeeRule, checked: boolean) {
    await toggleMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } });
    Toast.success(checked ? '已启用' : '已停用');
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  const columns: ColumnProps<PaymentFeeRule>[] = [
    { title: '名称', dataIndex: 'name', width: 160 },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={PAYMENT_CHANNEL_TAG_COLOR[v]}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '支付方式', dataIndex: 'payMethod', width: 130, render: (v: PaymentMethod | null) => (v ? PAYMENT_METHOD_LABELS[v] : '全部') },
    { title: '费率', dataIndex: 'rateBps', width: 90, render: (v: number) => `${(v / 100).toFixed(2)}%` },
    { title: '固定费', dataIndex: 'fixedFee', width: 100, render: (v: number) => yuan(v) },
    { title: '限额(低/高)', dataIndex: 'minFee', width: 150, render: (_: unknown, r: PaymentFeeRule) => `${yuan(r.minFee)} / ${yuan(r.maxFee)}` },
    { title: '优先级', dataIndex: 'priority', width: 80 },
    createdAtColumn as ColumnProps<PaymentFeeRule>,
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (_: unknown, r: PaymentFeeRule) => (
        <Switch checked={r.status === 'enabled'} loading={togglingId === r.id} disabled={!hasPermission('payment:fee:update')} size="small" onChange={(c) => void handleToggle(r, c)} />
      ),
    },
    createOperationColumn<PaymentFeeRule>({
      width: 120,
      actions: (r) => [
        ...(hasPermission('payment:fee:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(r),
        }] : []),
        ...(hasPermission('payment:fee:delete') ? [{
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

  const renderChannelFilter = () => (
    <Select
      placeholder="全部渠道"
      value={draftParams.channel || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, channel: (v as string) ?? '' }))}
      showClear
      style={{ width: 130 }}
      optionList={channelOptions}
    />
  );

  const renderStatusFilter = () => (
    <Select
      placeholder="全部状态"
      value={draftParams.status || undefined}
      onChange={(v) => setDraftParams((p) => ({ ...p, status: (v as string) ?? '' }))}
      showClear
      style={{ width: 120 }}
      optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderCreateButton = () => hasPermission('payment:fee:create') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderChannelFilter()}
            {renderStatusFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderCreateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderSearchButton()}
            {renderCreateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderChannelFilter()}
            {renderStatusFilter()}
          </>
        )}
        filterTitle="费率规则筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(total)}
      />

      <AppModal title={editing ? '编辑费率规则' : '新增费率规则'} visible={modalVisible} onOk={handleOk} onCancel={closeModal} okButtonProps={{ loading: saveMutation.isPending }} width={700} closeOnEsc>
        <Spin spinning={false} wrapperClassName="modal-spin-wrapper">
          <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} initValues={formInit} labelPosition="left" labelWidth={124}>
            <Form.Input field="name" label="名称" placeholder="如：微信标准费率" rules={[{ required: true, message: '名称不能为空' }]} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
              <Form.Select field="channel" label="渠道" style={{ width: '100%' }} optionList={channelOptions} rules={[{ required: true, message: '请选择渠道' }]} />
              <Form.Select field="payMethod" label="支付方式" style={{ width: '100%' }} optionList={methodOptions} showClear placeholder="留空=全部方式" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
              <Form.InputNumber field="ratePercent" label="费率(%)" min={0} max={100} step={0.01} precision={2} style={{ width: '100%' }} suffix="%" />
              <Form.InputNumber field="fixedYuan" label="固定费(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
              <Form.InputNumber field="minYuan" label="最低手续费(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
              <Form.InputNumber field="maxYuan" label="最高手续费(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 16 }}>
              <Form.InputNumber field="priority" label="优先级" min={0} max={9999} step={1} precision={0} style={{ width: '100%' }} extraText="数值越大越优先匹配" />
              <Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
            </div>
            <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
          </Form>
        </Spin>
      </AppModal>
    </div>
  );
}
