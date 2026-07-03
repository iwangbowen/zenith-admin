import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Form, Toast, Tag } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw, WalletCards, Undo2 } from 'lucide-react';
import type { MemberWalletTransaction } from '@zenith/shared';
import { WALLET_TX_TYPE_LABELS } from '@zenith/shared';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { MemberSelect } from '@/components/MemberSelect';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import {
  memberAdminKeys,
  useAdjustMemberWallet,
  useMemberWalletTransactions,
  useRefundMemberWallet,
} from '@/hooks/queries/member-admin';

const typeOptions = (Object.keys(WALLET_TX_TYPE_LABELS) as (keyof typeof WALLET_TX_TYPE_LABELS)[]).map((v) => ({ value: v, label: WALLET_TX_TYPE_LABELS[v] }));
const TYPE_COLORS: Record<string, string> = { recharge: 'green', consume: 'orange', refund: 'cyan', adjust: 'blue' };
const yuan = (fen: number) => (fen / 100).toFixed(2);

interface SearchParams { memberKeyword?: string; type?: string }

export default function MemberWalletPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [draftParams, setDraftParams] = useState<SearchParams>({});
  const [submittedParams, setSubmittedParams] = useState<SearchParams>({});
  const [modalVisible, setModalVisible] = useState(false);
  const [mode, setMode] = useState<'adjust' | 'refund'>('adjust');
  const listQuery = useMemberWalletTransactions({
    page,
    pageSize,
    memberKeyword: submittedParams.memberKeyword || undefined,
    type: submittedParams.type || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const adjustMutation = useAdjustMemberWallet();
  const refundMutation = useRefundMemberWallet();

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: memberAdminKeys.walletLists });
  };
  const handleReset = () => {
    setDraftParams({});
    setSubmittedParams({});
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: memberAdminKeys.walletLists });
  };

  const openModal = (m: 'adjust' | 'refund') => { setMode(m); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: { memberId: number; amount: number; remark?: string };
    try { values = (await formApi.current!.validate()) as { memberId: number; amount: number; remark?: string }; } catch { throw new Error('validation'); }
    const payload = { memberId: values.memberId, amount: Math.round(values.amount * 100), remark: values.remark };
    await (mode === 'adjust' ? adjustMutation : refundMutation).mutateAsync(payload);
    Toast.success(mode === 'adjust' ? '已调整' : '已退款');
    setModalVisible(false);
  };

  const columns: ColumnProps<MemberWalletTransaction>[] = [
    { title: '会员', dataIndex: 'memberName', width: 140, render: (v?: string, r?: MemberWalletTransaction) => v || `#${r?.memberId}` },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => <Tag color={TYPE_COLORS[v] as 'green'}>{WALLET_TX_TYPE_LABELS[v as keyof typeof WALLET_TX_TYPE_LABELS]}</Tag> },
    { title: '变动(元)', dataIndex: 'amount', width: 110, render: (v: number) => <span style={{ color: v >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)' }}>{v >= 0 ? `+${yuan(v)}` : yuan(v)}</span> },
    { title: '变动后(元)', dataIndex: 'balanceAfter', width: 110, render: (v: number) => yuan(v) },
    { title: '业务类型', dataIndex: 'bizType', width: 130, render: (v: string | null) => v || '-' },
    { title: '备注', dataIndex: 'remark', width: 200, render: renderEllipsis },
    createdAtColumn,
  ];

  const renderKeywordSearch = () => (
    <Input
      prefix={<Search size={14} />}
      placeholder="会员ID/昵称"
      value={draftParams.memberKeyword}
      showClear
      style={{ width: 180 }}
      onChange={(v) => setDraftParams((p) => ({ ...p, memberKeyword: v || undefined }))}
      onEnterPress={handleSearch}
    />
  );

  const renderTypeFilter = () => (
    <Select
      placeholder="全部类型"
      value={draftParams.type}
      style={{ width: 130 }}
      showClear
      onChange={(v) => setDraftParams((p) => ({ ...p, type: v as string | undefined }))}
      optionList={typeOptions}
    />
  );

  const renderSearchButton = () => <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>;
  const renderResetButton = () => <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>;
  const renderAdjustButton = () => hasPermission('member:wallet:adjust') ? (
    <Button type="primary" icon={<WalletCards size={14} />} onClick={() => openModal('adjust')}>调整余额</Button>
  ) : null;
  const renderRefundButton = () => hasPermission('member:wallet:refund') ? (
    <Button type="primary" icon={<Undo2 size={14} />} onClick={() => openModal('refund')}>退款</Button>
  ) : null;

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            {renderKeywordSearch()}
            {renderTypeFilter()}
            {renderSearchButton()}
            {renderResetButton()}
            {renderAdjustButton()}
            {renderRefundButton()}
          </>
        )}
        mobilePrimary={(
          <>
            {renderKeywordSearch()}
            {renderSearchButton()}
            {renderAdjustButton()}
            {renderRefundButton()}
          </>
        )}
        mobileFilters={renderTypeFilter()}
        filterTitle="钱包流水筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered columns={columns} dataSource={data} loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} rowKey="id" size="small"
        pagination={buildPagination(total)} empty="暂无钱包流水" />

      <AppModal title={mode === 'adjust' ? '调整会员余额' : '会员钱包退款'} visible={modalVisible} width={480}
        onCancel={() => setModalVisible(false)} onOk={handleSubmit}>
        <Form key={mode} getFormApi={(api) => { formApi.current = api; }} labelPosition="left" labelWidth={90}>
          <MemberSelect field="memberId" required />
          <Form.InputNumber field="amount" label="金额(元)" style={{ width: '100%' }}
            placeholder={mode === 'adjust' ? '正数增加，负数扣减' : '退款金额（元）'}
            min={mode === 'refund' ? 0.01 : undefined} precision={2}
            rules={[{ required: true, message: '请输入金额' }]} />
          <Form.TextArea field="remark" label="备注" placeholder={mode === 'adjust' ? '调整原因' : '退款原因'} maxCount={256} />
        </Form>
      </AppModal>
    </div>
  );
}
