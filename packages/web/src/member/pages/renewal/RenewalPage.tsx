import { useState } from 'react';
import { Button, Modal, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { BadgeCheck, CalendarClock, Repeat, ShieldCheck } from 'lucide-react';
import { MemberPage } from '../../components/MemberPage';
import { formatYuan } from '../../utils/format';
import { useMyRenewal, useRenewalPlans, useRenewNow, useSignRenewal, useTerminateRenewal } from '../../hooks/queries';
import { PAYMENT_CONTRACT_STATUS_LABELS, PAYMENT_DEDUCT_PERIOD_LABELS } from '@zenith/shared';
import type { PaymentDeductPlan } from '@zenith/shared';

function periodText(p: Pick<PaymentDeductPlan, 'period' | 'customDays'>): string {
  return p.period === 'custom' ? `每 ${p.customDays ?? '-'} 天` : PAYMENT_DEDUCT_PERIOD_LABELS[p.period];
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  border: '1px solid var(--m-border)',
  padding: '18px 20px',
  marginBottom: 16,
};

export default function RenewalPage() {
  const renewalQuery = useMyRenewal();
  const plansQuery = useRenewalPlans();
  const signMutation = useSignRenewal();
  const terminateMutation = useTerminateRenewal();
  const renewNowMutation = useRenewNow();
  const [signingPlanId, setSigningPlanId] = useState<number | null>(null);

  const info = renewalQuery.data;
  const plans = plansQuery.data ?? [];
  const contract = info?.contract ?? null;
  const active = contract && (contract.status === 'signed' || contract.status === 'paused');

  const handleSign = (plan: PaymentDeductPlan) => {
    Modal.confirm({
      title: `开通「${plan.name}」自动续费？`,
      content: `${periodText(plan)}自动扣款 ${formatYuan(plan.amount)}，签约后立即扣首期，可随时关闭`,
      okText: '确认开通',
      onOk: async () => {
        setSigningPlanId(plan.id);
        try {
          const res = await signMutation.mutateAsync({ planId: plan.id, payMethod: 'wechat_papay' });
          if (res.firstDeduct?.deductStatus === 'success') Toast.success('开通成功，首期已扣款');
          else if (res.firstDeduct?.deductStatus === 'failed') Toast.warning(`开通成功，首期扣款失败：${res.firstDeduct.failReason ?? '稍后将自动重试'}`);
          else Toast.success('开通成功');
        } finally {
          setSigningPlanId(null);
        }
      },
    });
  };

  const handleTerminate = () => {
    Modal.confirm({
      title: '关闭自动续费？',
      content: '关闭后到期不再自动扣款，已生效的 VIP 权益保留至到期',
      okText: '确认关闭',
      okButtonProps: { type: 'danger' },
      onOk: async () => {
        await terminateMutation.mutateAsync();
        Toast.success('已关闭自动续费');
      },
    });
  };

  const handleRenewNow = () => {
    Modal.confirm({
      title: '立即续费一期？',
      content: contract?.planAmount != null ? `将立即扣款 ${formatYuan(contract.planAmount)} 并顺延有效期` : '将按签约计划立即扣款一期',
      onOk: async () => {
        const res = await renewNowMutation.mutateAsync();
        if (res.deductStatus === 'success') Toast.success('续费成功');
        else if (res.deductStatus === 'processing') Toast.info('扣款受理中，稍后自动到账');
        else Toast.error(`续费失败：${res.failReason ?? '请稍后再试'}`);
      },
    });
  };

  if (renewalQuery.isLoading) {
    return (
      <MemberPage title="自动续费">
        <div className="m-loading-wrap"><Spin size="large" /></div>
      </MemberPage>
    );
  }

  return (
    <MemberPage title="自动续费">
      {/* VIP 状态卡 */}
      <div style={{ ...cardStyle, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--m-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <BadgeCheck size={24} color="#fff" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
            {info?.vipExpireAt ? 'VIP 会员' : '尚未开通 VIP'}
          </div>
          <div style={{ fontSize: 13, color: 'var(--m-text-secondary)' }}>
            {info?.vipExpireAt ? `有效期至 ${info.vipExpireAt}` : '开通自动续费立享 VIP 权益'}
          </div>
        </div>
        {active && contract && (
          <Tag color={contract.status === 'signed' ? 'green' : 'orange'}>
            {PAYMENT_CONTRACT_STATUS_LABELS[contract.status]}
          </Tag>
        )}
      </div>

      {active && contract ? (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            <Repeat size={16} color="var(--m-primary)" />
            当前续费计划
          </div>
          <div style={{ fontSize: 14, lineHeight: 2 }}>
            <div>计划：{contract.planName ?? '-'}（{contract.planPeriod ? PAYMENT_DEDUCT_PERIOD_LABELS[contract.planPeriod] : '-'}）</div>
            <div>每期金额：{contract.planAmount != null ? formatYuan(contract.planAmount) : '-'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <CalendarClock size={14} color="var(--m-text-secondary)" />
              下次扣款：{contract.status === 'signed' ? (contract.nextDeductAt ?? '-') : '已暂停'}
            </div>
            <div>已续费期数：{contract.totalDeductCount}</div>
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
            {contract.status === 'signed' && (
              <Button theme="solid" type="primary" loading={renewNowMutation.isPending} onClick={handleRenewNow}>
                立即续费一期
              </Button>
            )}
            <Button type="danger" theme="light" loading={terminateMutation.isPending} onClick={handleTerminate}>
              关闭自动续费
            </Button>
          </div>
        </div>
      ) : (
        <div style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
            <ShieldCheck size={16} color="var(--m-primary)" />
            选择续费计划
          </div>
          {plansQuery.isLoading ? (
            <div className="m-loading-wrap"><Spin /></div>
          ) : plans.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--m-text-secondary)' }}>暂无可用续费计划</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {plans.map((plan) => (
                <div key={plan.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid var(--m-border)' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{plan.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--m-text-secondary)', marginTop: 2 }}>
                      {periodText(plan)}自动扣款{plan.remark ? ` · ${plan.remark}` : ''}
                    </div>
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--m-primary)' }}>{formatYuan(plan.amount)}</div>
                  <Button theme="solid" type="primary" size="small" loading={signingPlanId === plan.id && signMutation.isPending} onClick={() => handleSign(plan)}>
                    开通
                  </Button>
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 12, color: 'var(--m-text-secondary)', marginTop: 12, lineHeight: 1.6 }}>
            开通即签约代扣协议并扣首期费用；到期前自动扣款续期，可随时关闭。扣款失败将自动重试，多次失败自动暂停。
          </div>
        </div>
      )}

      {/* 续费记录 */}
      {(info?.renewals?.length ?? 0) > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>续费记录</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {info?.renewals.map((r) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--m-border)' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>续费成功 · {formatYuan(r.amount)}</div>
                  <div style={{ fontSize: 12, color: 'var(--m-text-secondary)', marginTop: 2 }}>{r.createdAt}</div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--m-text-secondary)' }}>有效期至 {r.vipExpireAfter}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </MemberPage>
  );
}
