import { useMemo, useRef, useState } from 'react';
import { Button, Form, Toast, Banner } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { WalletCards, Undo2 } from 'lucide-react';
import type { MemberWalletTransaction } from '@zenith/shared/member';
import { WALLET_TX_TYPES, WALLET_TX_TYPE_LABELS } from '@zenith/shared/member';
import { enumValueOf } from '@zenith/shared/core';
import { usePermission } from '@/hooks/usePermission';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { listTableProps } from '@/components/list-page';
import { MemberSelect } from '@/components/MemberSelect';
import {
  memberAdminKeys,
  useAdjustMemberWallet,
  useMemberWalletTransactions,
  useRefundMemberWallet,
} from '@/hooks/queries/member-admin';
import { abortSubmit } from '@/lib/abort-submit';
import { compactParams } from '@/lib/query';
import { signedYuanChange } from './member-admin-display';
import {
  MemberLedgerToolbar,
  ledgerMemberColumn,
  ledgerTailColumns,
  ledgerTypeColumn,
  ledgerTypeOptions,
  useMemberLedgerSearch,
} from './member-ledger';

const typeOptions = ledgerTypeOptions(WALLET_TX_TYPE_LABELS);
const TYPE_COLORS: Record<string, string> = { recharge: 'green', consume: 'orange', refund: 'cyan', adjust: 'blue' };
const yuan = (fen: number) => (fen / 100).toFixed(2);

export default function MemberWalletPage() {
  const { hasPermission } = usePermission();
  // useEditModal 例外：钱包调整 / 退款动作表单（针对既有会员的资金操作，非实体新增 / 编辑）
  const formApi = useRef<FormApi | null>(null);
  const search = useMemberLedgerSearch(memberAdminKeys.walletLists);
  const { page, pageSize, buildPagination, submittedParams } = search;
  const [modalVisible, setModalVisible] = useState(false);
  const [mode, setMode] = useState<'adjust' | 'refund'>('adjust');
  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    memberKeyword: submittedParams.memberKeyword,
    type: enumValueOf(WALLET_TX_TYPES, submittedParams.type),
  }), [submittedParams]);
  const listQuery = useMemberWalletTransactions({
    page,
    pageSize,
    ...filterQuery,
  });
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
    ledgerMemberColumn<MemberWalletTransaction>(),
    ledgerTypeColumn<MemberWalletTransaction>(WALLET_TX_TYPE_LABELS, TYPE_COLORS),
    { title: '变动(元)', dataIndex: 'amount', width: 110, align: 'right', render: signedYuanChange },
    { title: '变动后(元)', dataIndex: 'balanceAfter', width: 110, align: 'right', render: (v: number) => yuan(v) },
    ...ledgerTailColumns<MemberWalletTransaction>(),
  ];

  return (
    <div className="page-container">
      <MemberLedgerToolbar
        search={search}
        typeOptions={typeOptions}
        exportEntity="member.wallet-transactions"
        exportPermission="member:wallet:list"
        filterTitle="钱包流水筛选"
        create={<>{hasPermission('member:wallet:adjust') ? (
          <Button type="primary" icon={<WalletCards size={14} />} onClick={() => openModal('adjust')}>调整余额</Button>
        ) : null}{hasPermission('member:wallet:refund') ? (
          <Button type="primary" icon={<Undo2 size={14} />} onClick={() => openModal('refund')}>退款</Button>
        ) : null}</>}
      />

      <ConfigurableTable<MemberWalletTransaction> columns={columns} {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无钱包流水' })} />

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
