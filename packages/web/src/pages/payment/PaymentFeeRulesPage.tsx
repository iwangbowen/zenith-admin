import type { CSSProperties } from 'react';
import { formatYuan } from '@/utils/payment';
import { Form, Spin } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { AppModal } from '@/components/AppModal';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import {
  paymentFeeKeys,
  useDeletePaymentFeeRule,
  usePaymentFeeRuleList,
  useSavePaymentFeeRule,
} from '@/hooks/queries/payment-fee';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import { PAYMENT_CASHIER_METHODS, PAYMENT_CHANNELS, PAYMENT_METHOD_LABELS, PAYMENT_CHANNEL_OPTIONS, PAYMENT_METHOD_OPTIONS } from '@zenith/shared/payment';
import type { CreatePaymentFeeRuleInput, PaymentChannel, PaymentFeeRule, PaymentMethod } from '@zenith/shared/payment';
import { useDictItems } from '@/hooks/useDictItems';
import { useListSearch } from '@/hooks/useListSearch';
import { CreateButton } from '@/components/toolbar-controls';
import { FilterSelect, StatusSelect } from '@/components/search-filters';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import { PaymentChannelTag, paymentMoneyColumn } from './payment-display';

const yuan = formatYuan;
const channelOptions = PAYMENT_CHANNEL_OPTIONS;
// 费率规则只接受收银台支付方式（服务端 createPaymentFeeRuleSchema），代扣 / 预授权方式不参与计费
const methodOptions = PAYMENT_METHOD_OPTIONS.filter((option) => enumValueOf(PAYMENT_CASHIER_METHODS, option.value) !== undefined);

interface SearchParams { channel?: string; status?: string; }
const defaultSearch: SearchParams = { channel: undefined, status: '' };

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
  const {
    page, pageSize, buildPagination,
    draftParams, setField, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearch, listKey: paymentFeeKeys.lists });

  const listQuery = usePaymentFeeRuleList({
    page,
    pageSize,
    channel: enumValueOf(PAYMENT_CHANNELS, submittedParams.channel),
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  });
  const saveMutation = useSavePaymentFeeRule();
  const toggleMutation = useSavePaymentFeeRule();
  const deleteMutation = useDeletePaymentFeeRule();

  const modal = useEditModal<PaymentFeeRule, FeeFormValues, Partial<CreatePaymentFeeRuleInput>>({
    entityName: '费率规则',
    save: saveMutation,
    defaults: { channel: 'wechat', status: 'enabled', priority: 0, ratePercent: 0.6, fixedYuan: 0 },
    toValues: (record) => ({
      name: record.name,
      channel: record.channel,
      payMethod: record.payMethod ?? undefined,
      ratePercent: record.rateBps / 100,
      fixedYuan: record.fixedFee / 100,
      minYuan: record.minFee != null ? record.minFee / 100 : undefined,
      maxYuan: record.maxFee != null ? record.maxFee / 100 : undefined,
      priority: record.priority,
      status: record.status,
      remark: record.remark ?? '',
    }),
    beforeSave: (values) => ({
      name: values.name,
      channel: values.channel,
      payMethod: enumValueOf(PAYMENT_CASHIER_METHODS, values.payMethod),
      rateBps: Math.round((values.ratePercent ?? 0) * 100),
      fixedFee: Math.round((values.fixedYuan ?? 0) * 100),
      minFee: values.minYuan != null ? Math.round(values.minYuan * 100) : undefined,
      maxFee: values.maxYuan != null ? Math.round(values.maxYuan * 100) : undefined,
      priority: values.priority ?? 0,
      status: values.status,
      remark: values.remark || undefined,
    }),
    labelWidth: 124,
  });

  const status = useStatusToggle<PaymentFeeRule>({
    toggle: (record, checked) => toggleMutation.mutateAsync({ id: record.id, values: { status: checked ? 'enabled' : 'disabled' } }),
    disabled: !hasPermission('payment:fee:update'),
  });

  const columns: ColumnProps<PaymentFeeRule>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 180, render: renderEllipsis },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <PaymentChannelTag channel={v} /> },
    { title: '支付方式', dataIndex: 'payMethod', width: 160, render: (v: PaymentMethod | null) => (v ? PAYMENT_METHOD_LABELS[v] : '全部') },
    { title: '费率', dataIndex: 'rateBps', width: 90, align: 'right', render: (v: number) => `${(v / 100).toFixed(2)}%` },
    { ...paymentMoneyColumn<PaymentFeeRule>('固定费', 'fixedFee'), width: 100 },
    { title: '限额(低/高)', dataIndex: 'minFee', width: 150, align: 'right', render: (_: unknown, r: PaymentFeeRule) => `${yuan(r.minFee)} / ${yuan(r.maxFee)}` },
    { title: '优先级', dataIndex: 'priority', width: 80 },
    createdAtColumn as ColumnProps<PaymentFeeRule>,
    status.column(),
    createOperationColumn<PaymentFeeRule>({
      width: 150,
      actions: (r) => [
        ...(hasPermission('payment:fee:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => modal.openEdit(r),
        }] : []),
        deleteAction({
          hidden: !hasPermission('payment:fee:delete'),
          title: '确定要删除吗？',
          content: '删除后不可恢复',
          run: () => deleteMutation.mutateAsync([r.id]),
        }),
      ],
    }),
  ];

  const renderChannelFilter = () => (
    <FilterSelect
      placeholder="全部渠道"
      items={channelOptions}
      value={draftParams.channel}
      onChange={setField('channel')}
    />
  );

  const renderStatusFilter = () => (
    <StatusSelect
      items={statusItems}
      value={draftParams.status}
      onChange={setField('status')}
    />
  );

  const renderCreateButton = () => hasPermission('payment:fee:create') ? (
    <CreateButton onClick={modal.openCreate} />
  ) : null;

  return (
    <div className="page-container">
      <ListSearchToolbar
        filters={(
          <>
            {renderChannelFilter()}
            {renderStatusFilter()}
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={renderCreateButton()}
        filterTitle="费率规则筛选"
      />

      <ConfigurableTable<PaymentFeeRule>
        columns={columns}
        empty="暂无数据"
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <AppModal {...modal.modalProps} width={700}>
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            <Form.Input field="name" label="名称" placeholder="如：微信标准费率" rules={[{ required: true, message: '名称不能为空' }]} />
            <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
              <Form.Select field="channel" label="渠道" style={{ width: '100%' }} optionList={channelOptions} rules={[{ required: true, message: '请选择渠道' }]} />
              <Form.Select field="payMethod" label="支付方式" style={{ width: '100%' }} optionList={methodOptions} showClear placeholder="留空=全部方式" />
            </div>
            <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
              <Form.InputNumber field="ratePercent" label="费率(%)" min={0} max={100} step={0.01} precision={2} style={{ width: '100%' }} suffix="%" />
              <Form.InputNumber field="fixedYuan" label="固定费(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} />
            </div>
            <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
              <Form.InputNumber field="minYuan" label="最低手续费(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
              <Form.InputNumber field="maxYuan" label="最高手续费(元)" min={0} step={0.01} precision={2} style={{ width: '100%' }} placeholder="可选" />
            </div>
            <div className="auto-grid" style={{ ['--auto-grid-min']: '220px', ['--auto-grid-cols']: 2 } as CSSProperties}>
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
