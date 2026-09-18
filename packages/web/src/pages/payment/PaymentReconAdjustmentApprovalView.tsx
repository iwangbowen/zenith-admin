import { Descriptions, Empty, Spin, Typography } from '@douyinfe/semi-ui';
import { formatReconciliationAmount, PAYMENT_RECON_ADJUSTMENT_STATUS_LABELS, PAYMENT_RECON_DIRECTION_LABELS, type PaymentReconAdjustment } from '@zenith/shared/payment';
import type { WorkflowBusinessFormProps } from '@/components/workflow/BusinessFormHost';
import { usePaymentReconApprovalDetail } from '@/hooks/queries/payment-recon';

export function ReconAdjustmentDetails({ adjustment }: Readonly<{ adjustment: PaymentReconAdjustment }>) {
  return <div style={{ padding: 16 }}>
    <Descriptions row data={[
      { key: '调整单', value: `#${adjustment.id}` }, { key: '案件 / 证据版本', value: `#${adjustment.caseId} / v${adjustment.caseVersion}` },
      { key: '状态', value: PAYMENT_RECON_ADJUSTMENT_STATUS_LABELS[adjustment.status] },
      { key: '方向', value: PAYMENT_RECON_DIRECTION_LABELS[adjustment.direction] },
      { key: '金额', value: formatReconciliationAmount(adjustment.amount) },
      { key: '支付应用 / 商户配置', value: `#${adjustment.applicationId} / #${adjustment.channelConfigId}` },
      { key: '申请人 / 审批人', value: `#${adjustment.applicantId} / ${adjustment.approverId ?? '待审批'}` },
      { key: '凭证', value: adjustment.journalId ? `#${adjustment.journalId}` : '尚未过账' },
      { key: '冲正原单', value: adjustment.reversalOfId ?? '—' }, { key: '调整依据', value: adjustment.reason },
    ]} />
    <Typography.Title heading={6}>冻结证据</Typography.Title>
    <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12 }}>{JSON.stringify(adjustment.evidence, null, 2)}</pre>
  </div>;
}

/** external 审批入口只读取本轮冻结资料，由服务端验证流程参与者和租户。 */
export default function PaymentReconAdjustmentApprovalView({ bizId, instanceId }: Readonly<WorkflowBusinessFormProps>) {
  const detail = usePaymentReconApprovalDetail(bizId ? Number(bizId) : undefined, instanceId ?? undefined);
  if (detail.isLoading) return <Spin />;
  if (!detail.data) return <Empty description={detail.error?.message ?? '无法加载本轮调整资料'} />;
  return <ReconAdjustmentDetails adjustment={detail.data} />;
}
