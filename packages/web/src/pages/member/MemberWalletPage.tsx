import { useRef, useState } from 'react';
import { Button, Form, Toast, Tag, Banner } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { WalletCards, Undo2 } from 'lucide-react';
import type { MemberWalletTransaction } from '@zenith/shared/member';
import { MEMBER_BIZ_TYPE_LABELS, WALLET_TX_TYPES, WALLET_TX_TYPE_LABELS } from '@zenith/shared/member';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { MemberSelect } from '@/components/MemberSelect';
import { createdAtColumn, renderEllipsis } from '../../utils/table-columns';
import {
  memberAdminKeys,
  useAdjustMemberWallet,
  useMemberWalletTransactions,
  useRefundMemberWallet,
} from '@/hooks/queries/member-admin';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { abortSubmit } from '@/lib/abort-submit';

const typeOptions = (Object.keys(WALLET_TX_TYPE_LABELS) as (keyof typeof WALLET_TX_TYPE_LABELS)[]).map((v) => ({ value: v, label: WALLET_TX_TYPE_LABELS[v] }));
const TYPE_COLORS: Record<string, string> = { recharge: 'green', consume: 'orange', refund: 'cyan', adjust: 'blue' };
const yuan = (fen: number) => (fen / 100).toFixed(2);

interface SearchParams { memberKeyword?: string; type?: string }

export default function MemberWalletPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset, applySearch,
  } = useListSearch<SearchParams>({ defaults: {}, listKey: memberAdminKeys.walletLists });
  // 会员详情等入口的深链筛选（?memberKeyword=，消费后即从 URL 移除）
  useListDeepLink(['memberKeyword'], (p) => applySearch({ memberKeyword: p.memberKeyword }));
  const [modalVisible, setModalVisible] = useState(false);
  const [mode, setMode] = useState<'adjust' | 'refund'>('adjust');
  const listQuery = useMemberWalletTransactions({
    page,
    pageSize,
    memberKeyword: submittedParams.memberKeyword || undefined,
    type: enumValueOf(WALLET_TX_TYPES, submittedParams.type),
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const adjustMutation = useAdjustMemberWallet();
  const refundMutation = useRefundMemberWallet();

  const openModal = (m: 'adjust' | 'refund') => { setMode(m); setModalVisible(true); };

  const handleSubmit = async () => {
    let values: { memberId: number; amount: number; remark?: string; bizId?: string };
    try { values = (await formApi.current!.validate()) as { memberId: number; amount: number; remark?: string; bizId?: string }; } catch { abortSubmit('validation'); }
    const amount = Math.round(values.amount * 100);
    if (mode === 'adjust') {
      await adjustMutation.mutateAsync({ body: { memberId: values.memberId, amount, remark: values.remark } });
    } else {
      // 退款原因必填由服务端校验兜底，表单 rules 已保证非空
      await refundMutation.mutateAsync({ body: { memberId: values.memberId, amount, remark: values.remark ?? '', ...(values.bizId ? { bizId: values.bizId } : {}) } });
    }
    Toast.success(mode === 'adjust' ? '已调整' : '已退款');
    setModalVisible(false);
  };

  const columns: ColumnProps<MemberWalletTransaction>[] = [
    { title: '会员', dataIndex: 'memberName', width: 140, render: (v?: string, r?: MemberWalletTransaction) => v || `#${r?.memberId}` },
    { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => <Tag color={TYPE_COLORS[v] as 'green'}>{WALLET_TX_TYPE_LABELS[v as keyof typeof WALLET_TX_TYPE_LABELS]}</Tag> },
    { title: '变动(元)', dataIndex: 'amount', width: 110, align: 'right', render: (v: number) => <span style={{ color: v >= 0 ? 'var(--semi-color-success)' : 'var(--semi-color-danger)' }}>{v >= 0 ? `+${yuan(v)}` : yuan(v)}</span> },
    { title: '变动后(元)', dataIndex: 'balanceAfter', width: 110, align: 'right', render: (v: number) => yuan(v) },
    { title: '业务类型', dataIndex: 'bizType', width: 130, render: (v: string | null) => (v ? (MEMBER_BIZ_TYPE_LABELS[v] ?? v) : '-') },
    { title: '备注', dataIndex: 'remark', width: 200, render: renderEllipsis },
    createdAtColumn,
  ];

  const renderKeywordSearch = () => (
    <KeywordInput placeholder="会员ID/昵称" value={draftParams.memberKeyword} onChange={(v) => setDraftParams((p) => ({ ...p, memberKeyword: v }))} onSearch={handleSearch} width={180} />
  );

  const renderTypeFilter = () => (
    <FilterSelect
      placeholder="全部类型"
      items={typeOptions}
      value={draftParams.type}
      onChange={(v) => setDraftParams((p) => ({ ...p, type: v as string | undefined }))}
    />
  );

  const renderSearchButton = () => <SearchButton onClick={handleSearch} />;
  const renderResetButton = () => <ResetButton onClick={handleReset} />;
  const buildExportQuery = () => ({
    ...(submittedParams.memberKeyword ? { memberKeyword: submittedParams.memberKeyword } : {}),
    ...(submittedParams.type ? { type: submittedParams.type } : {}),
  });
  const renderExportButton = (variant?: 'flat') => hasPermission('member:wallet:list') ? (
    <ExportButton entity="member.wallet-transactions" query={buildExportQuery()} variant={variant} />
  ) : null;
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
            {renderExportButton()}
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
        mobileActions={renderExportButton('flat')}
        filterTitle="钱包流水筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable bordered columns={columns} dataSource={data} loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()} refreshLoading={listQuery.isFetching} rowKey="id" size="small"
        pagination={buildPagination(total)} empty="暂无钱包流水" />

      <AppModal title={mode === 'adjust' ? '调整会员余额' : '会员钱包退款'} visible={modalVisible} width={480}
        onCancel={() => setModalVisible(false)} onOk={handleSubmit}>
        {mode === 'refund' && (
          <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }}
            description="退款为入账操作：金额将增加到会员钱包余额（如订单/充值退款退回钱包），不会从钱包扣款。" />
        )}
        <Form key={mode} getFormApi={(api) => { formApi.current = api; }} labelPosition="left" labelWidth={90}>
          <MemberSelect field="memberId" required />
          <Form.InputNumber field="amount" label="金额(元)" style={{ width: '100%' }}
            placeholder={mode === 'adjust' ? '正数增加，负数扣减' : '退款金额（元）'}
            min={mode === 'refund' ? 0.01 : undefined} precision={2}
            rules={[{ required: true, message: '请输入金额' }]} />
          {mode === 'refund' && (
            <Form.Input field="bizId" label="业务单号" placeholder="关联的支付/退款单号（可选，便于审计追溯）" maxLength={64} />
          )}
          <Form.TextArea field="remark" label="备注" placeholder={mode === 'adjust' ? '调整原因' : '退款原因（必填）'} maxCount={256}
            rules={mode === 'refund' ? [{ required: true, message: '请填写退款原因' }] : undefined} />
        </Form>
      </AppModal>
    </div>
  );
}
