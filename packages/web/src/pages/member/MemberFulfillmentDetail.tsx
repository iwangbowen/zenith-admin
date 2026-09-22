import { Descriptions, SideSheet, Spin, Typography } from '@douyinfe/semi-ui';
import { WALLET_TX_TYPE_LABELS } from '@zenith/shared/member';
import { EntityContextView } from '@/components/entity-relations/EntityRelationButton';
import DateTimeText from '@/components/DateTimeText';
import { useMemberVipRenewalDetail, useMemberWalletTransactionDetail } from '@/hooks/queries/member-fulfillment';

export function MemberWalletTransactionDetail({ id, onClose }: { readonly id: number | null; readonly onClose: () => void }) {
  const query = useMemberWalletTransactionDetail(id);
  const record = query.data;
  return <SideSheet title="钱包流水详情" visible={id !== null} onCancel={onClose} width={720}>
    {query.isLoading ? <Spin /> : record ? <>
      <Descriptions align="left" data={[
        { key: '流水编号', value: record.id }, { key: '会员', value: record.memberName || `会员 #${record.memberId}` },
        { key: '业务类型', value: WALLET_TX_TYPE_LABELS[record.type] }, { key: '变动金额', value: `¥${(record.amount / 100).toFixed(2)}` },
        { key: '入账后余额', value: `¥${(record.balanceAfter / 100).toFixed(2)}` }, { key: '支付单号', value: record.paymentIntentNo || '—' },
        { key: '记录时间', value: <DateTimeText value={record.createdAt} /> }, { key: '备注', value: record.remark || '—' },
      ]} />
      <EntityContextView entityType="member.wallet-transaction" entityKey={String(record.id)} />
    </> : <Typography.Text type="danger">流水不存在或无权查看</Typography.Text>}
  </SideSheet>;
}

export function MemberVipRenewalDetail({ id, onClose }: { readonly id: number | null; readonly onClose: () => void }) {
  const query = useMemberVipRenewalDetail(id);
  const record = query.data;
  return <SideSheet title="VIP 续费履约详情" visible={id !== null} onCancel={onClose} width={720}>
    {query.isLoading ? <Spin /> : record ? <>
      <Descriptions align="left" data={[
        { key: '支付单号', value: record.orderNo }, { key: '会员', value: record.memberName || `会员 #${record.memberId}` },
        { key: '续费金额', value: `¥${(record.amount / 100).toFixed(2)}` }, { key: '签约协议', value: record.contractNo || '—' },
        { key: '续费后到期时间', value: <DateTimeText value={record.vipExpireAfter} /> }, { key: '履约时间', value: <DateTimeText value={record.createdAt} /> },
      ]} />
      <EntityContextView entityType="member.vip-renewal" entityKey={String(record.id)} />
    </> : <Typography.Text type="danger">续费履约不存在或无权查看</Typography.Text>}
  </SideSheet>;
}
