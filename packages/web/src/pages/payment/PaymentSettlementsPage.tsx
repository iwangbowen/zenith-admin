import { useState, useRef } from 'react';
import { formatYuan, PAYMENT_CHANNEL_TAG_COLOR } from '@/utils/payment';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Modal, Select, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { formatDateTime, formatDateForApi } from '@/utils/date';
import { createdAtColumn } from '@/utils/table-columns';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  paymentSettlementKeys,
  useGeneratePaymentSettlement,
  usePaymentSettlementList,
  useUpdatePaymentSettlementStatus,
} from '@/hooks/queries/payment-settlements';
import { PAYMENT_CHANNEL_LABELS, PAYMENT_SETTLEMENT_STATUS_LABELS } from '@zenith/shared';
import type { PaymentChannel, PaymentSettlementBatch, PaymentSettlementStatus } from '@zenith/shared';

const yuan = formatYuan;
const channelOptions = Object.entries(PAYMENT_CHANNEL_LABELS).map(([value, label]) => ({ value, label }));
const STATUS_COLOR = { pending: 'grey', settling: 'blue', settled: 'green', failed: 'red' } as const satisfies Record<PaymentSettlementStatus, string>;

interface SearchParams { channel: string; status: string; }
const defaultSearch: SearchParams = { channel: '', status: '' };

interface GenerateFormValues { channel: PaymentChannel; period: [Date, Date]; remark?: string; }

export default function PaymentSettlementsPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canSettle = hasPermission('payment:settlement:settle');
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearch);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearch);

  const [genVisible, setGenVisible] = useState(false);

  const listQuery = usePaymentSettlementList({
    page,
    pageSize,
    channel: submittedParams.channel || undefined,
    status: submittedParams.status || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const generateMutation = useGeneratePaymentSettlement();
  const transitionMutation = useUpdatePaymentSettlementStatus();
  const transitioningId = transitionMutation.isPending ? (transitionMutation.variables?.id ?? null) : null;

  function handleSearch() { setPage(1); setSubmittedParams(draftParams); void queryClient.invalidateQueries({ queryKey: paymentSettlementKeys.lists }); }
  function handleReset() { setDraftParams(defaultSearch); setPage(1); setSubmittedParams(defaultSearch); void queryClient.invalidateQueries({ queryKey: paymentSettlementKeys.lists }); }

  async function handleGenerate() {
    let values: GenerateFormValues;
    try { values = (await formApi.current?.validate()) as GenerateFormValues; } catch { throw new Error('validation'); }
    await generateMutation.mutateAsync({
      channel: values.channel,
      periodStart: formatDateForApi(values.period[0]),
      periodEnd: formatDateForApi(values.period[1]),
      remark: values.remark || undefined,
    });
    Toast.success('生成成功');
    setGenVisible(false);
  }

  async function handleTransition(record: PaymentSettlementBatch, status: PaymentSettlementStatus) {
    await transitionMutation.mutateAsync({ id: record.id, status });
    Toast.success('操作成功');
  }

  const columns: ColumnProps<PaymentSettlementBatch>[] = [
    { title: '批次号', dataIndex: 'batchNo', width: 190, render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} copyable={{ content: v }} style={{ maxWidth: 170 }}>{v}</Typography.Text> },
    { title: '渠道', dataIndex: 'channel', width: 100, render: (v: PaymentChannel) => <Tag color={PAYMENT_CHANNEL_TAG_COLOR[v]}>{PAYMENT_CHANNEL_LABELS[v]}</Tag> },
    { title: '账期', dataIndex: 'periodStart', width: 200, render: (_: unknown, r: PaymentSettlementBatch) => `${r.periodStart} ~ ${r.periodEnd}` },
    { title: '订单数', dataIndex: 'orderCount', width: 80 },
    { title: '收款', dataIndex: 'grossAmount', width: 110, render: (v: number) => yuan(v) },
    { title: '手续费', dataIndex: 'feeAmount', width: 100, render: (v: number) => yuan(v) },
    { title: '退款', dataIndex: 'refundAmount', width: 100, render: (v: number) => yuan(v) },
    { title: '净额', dataIndex: 'netAmount', width: 120, render: (v: number) => <Typography.Text strong type={v < 0 ? 'danger' : 'success'}>{yuan(v)}</Typography.Text> },
    { title: '到账时间', dataIndex: 'settledAt', width: 170, render: (v: string | null) => (v ? formatDateTime(v) : '-') },
    createdAtColumn as ColumnProps<PaymentSettlementBatch>,
    { title: '状态', dataIndex: 'status', width: 90, fixed: 'right', render: (v: PaymentSettlementStatus) => <Tag color={STATUS_COLOR[v]}>{PAYMENT_SETTLEMENT_STATUS_LABELS[v]}</Tag> },
    createOperationColumn<PaymentSettlementBatch>({
      width: 180,
      emptyContent: <Typography.Text type="tertiary">—</Typography.Text>,
      actions: (r) => {
        if (!canSettle || r.status === 'settled' || r.status === 'failed') return [];
        const busy = transitioningId === r.id;
        return [
          ...(r.status === 'pending' ? [{
            key: 'start',
            label: '开始结算',
            loading: busy,
            onClick: () => void handleTransition(r, 'settling'),
          }] : []),
          ...(r.status === 'settling' ? [{
            key: 'settled',
            label: '标记到账',
            loading: busy,
            onClick: () => {
              Modal.confirm({
                title: '确认该批次已到账？',
                onOk: () => handleTransition(r, 'settled'),
              });
            },
          }] : []),
          {
            key: 'failed',
            label: '标记失败',
            danger: true,
            loading: busy,
            onClick: () => {
              Modal.confirm({
                title: '确认标记为结算失败？',
                onOk: () => handleTransition(r, 'failed'),
              });
            },
          },
        ];
      },
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
      optionList={Object.entries(PAYMENT_SETTLEMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderGenerateButton = () => hasPermission('payment:settlement:generate') ? (
    <Button type="primary" icon={<Plus size={14} />} onClick={() => setGenVisible(true)}>生成结算</Button>
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
            {renderGenerateButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderChannelFilter()}
            {renderSearchButton()}
            {renderGenerateButton()}
          </>
        )}
        mobileFilters={(
          <>
            {renderStatusFilter()}
          </>
        )}
        filterTitle="结算批次筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered columns={columns} dataSource={data} loading={listQuery.isFetching} rowKey="id" size="small" empty="暂无数据"
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} pagination={buildPagination(total)}
      />

      <AppModal title="生成结算批次" visible={genVisible} onOk={handleGenerate} onCancel={() => setGenVisible(false)} okButtonProps={{ loading: generateMutation.isPending }} width={520} closeOnEsc>
        <Form key={genVisible ? 'gen' : 'closed'} getFormApi={(api) => { formApi.current = api; }} initValues={{ channel: 'wechat' }} labelPosition="left" labelWidth={90}>
          <Form.Select field="channel" label="渠道" style={{ width: '100%' }} optionList={channelOptions} rules={[{ required: true, message: '请选择渠道' }]} />
          <Form.DatePicker
            field="period"
            label="账期"
            type="dateRange"
            style={{ width: '100%' }}
            rules={[
              { required: true, message: '请选择账期' },
              {
                validator: (_rule: unknown, value: unknown) => {
                  if (!Array.isArray(value) || value.length !== 2) return false;
                  const [start, end] = value as [Date, Date];
                  return start <= end;
                },
                message: '账期开始不能晚于结束',
              },
            ]}
          />
          <Form.TextArea field="remark" label="备注" autosize rows={1} placeholder="可选" />
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginLeft: 90 }}>将聚合该渠道账期内成功订单，净额 = 收款 - 手续费 - 退款</Typography.Text>
        </Form>
      </AppModal>
    </div>
  );
}
