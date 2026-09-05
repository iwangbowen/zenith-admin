import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Select, Toast, RadioGroup, Radio, InputNumber } from '@douyinfe/semi-ui';
import { Plus, RefreshCw, Ticket, Wallet } from 'lucide-react';
import { WALLET_TX_TYPE_LABELS, memberSelfContract } from '@zenith/shared/member';
import type { MemberCoupon } from '@zenith/shared/member';
import type { PaymentCashierMethod } from '@zenith/shared/payment';
import { MemberPage } from '../../components/MemberPage';
import { TransactionList } from '../../components/TransactionList';
import { formatYuan } from '../../utils/format';
import { memberKeys, useCreateRechargeOrder, useMemberCouponList, useMemberPaymentOptions, useMemberWallet } from '../../hooks/queries';
import { StatGrid } from '@/components/charts/StatCard';

const QUICK_AMOUNTS = [10, 50, 100, 200, 500];
/** 计算券对当前金额的立减（与后端 payment-coupon.service 口径一致） */
function couponDiscount(mc: MemberCoupon, amountCents: number): number {
  const c = mc.coupon;
  if (!c) return 0;
  if (amountCents < c.threshold) return 0;
  let discount = c.type === 'amount' ? c.faceValue : Math.floor((amountCents * (100 - c.faceValue)) / 100);
  if (c.type === 'percent' && c.maxDiscount != null) discount = Math.min(discount, c.maxDiscount);
  return Math.max(0, Math.min(discount, amountCents - 1));
}

/** 会员前台自有视觉令牌（--m-*）；与后台一致改为分栏细线，不再画卡片盒子 */
function StatCard({ label, value }: Readonly<{ label: React.ReactNode; value: React.ReactNode }>) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--m-text)', letterSpacing: '-0.03em' }}>{value}</div>
      <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginTop: 9, display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
      </div>
    </div>
  );
}

export default function WalletPage() {
  const queryClient = useQueryClient();
  const wallet = useMemberWallet().data ?? null;
  const paymentOptionsQuery = useMemberPaymentOptions();
  const paymentOptions = useMemo(() => paymentOptionsQuery.data ?? [], [paymentOptionsQuery.data]);
  const [applicationId, setApplicationId] = useState<number | undefined>(undefined);
  const rechargeMutation = useCreateRechargeOrder();
  const [modalOpen, setModalOpen] = useState(false);
  const [amount, setAmount] = useState<number>(100);
  const [payMethod, setPayMethod] = useState<PaymentCashierMethod>('wechat_h5');
  const [couponId, setCouponId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const couponQuery = useMemberCouponList({ status: 'unused', page: 1, pageSize: 50 });
  const amountCents = Math.round((amount || 0) * 100);
  // 满足门槛且有立减效果的可用券
  const usableCoupons = useMemo(
    () => (couponQuery.data?.list ?? []).filter((mc) => couponDiscount(mc, amountCents) > 0),
    [couponQuery.data, amountCents],
  );
  const selectedCoupon = usableCoupons.find((mc) => mc.id === couponId) ?? null;
  const selectedApplication = paymentOptions.find((option) => option.id === applicationId);
  const availableMethods = useMemo(() => selectedApplication?.cashierMethods ?? [], [selectedApplication]);
  useEffect(() => {
    if (applicationId == null) {
      const first = paymentOptions.find((option) => option.cashierMethods.length > 0);
      if (first) {
        setApplicationId(first.id);
        setPayMethod(first.cashierMethods[0].method);
      }
    } else if (availableMethods.length > 0 && !availableMethods.some((method) => method.method === payMethod)) {
      setPayMethod(availableMethods[0].method);
    }
  }, [applicationId, availableMethods, payMethod, paymentOptions]);
  const discount = selectedCoupon ? couponDiscount(selectedCoupon, amountCents) : 0;
  const payableCents = Math.max(1, amountCents - discount);

  const handleRecharge = async () => {
    if (!amount || amount <= 0) {
      Toast.warning('请输入充值金额');
      return;
    }
    if (applicationId == null || !availableMethods.some((method) => method.method === payMethod)) {
      Toast.warning('请选择当前应用支持的支付方式');
      return;
    }
    const r = await rechargeMutation.mutateAsync({
      body: {
        applicationId,
        amount: amountCents,
        payMethod,
        memberCouponId: selectedCoupon?.id,
      },
    });
    setModalOpen(false);
    setCouponId(null);
    if (r.payUrl) {
      globalThis.location.href = r.payUrl;
      return;
    }
    if (r.formHtml) {
      globalThis.document.open();
      globalThis.document.write(r.formHtml);
      globalThis.document.close();
      return;
    }
    Modal.info({
      title: '充值订单已创建',
      content: `订单号：${r.orderNo}，支付完成后余额将自动到账${discount > 0 ? `（充值满减已抵扣 ${formatYuan(discount)}）` : ''}。`,
    });
  };

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    void queryClient.invalidateQueries({ queryKey: memberKeys.wallet.detail });
    void queryClient.invalidateQueries({ queryKey: memberKeys.wallet.transactions });
  };

  return (
    <MemberPage
      title="我的钱包"
      rightSlot={
        <Button
          theme="borderless"
          size="small"
          icon={<RefreshCw size={14} />}
          onClick={handleRefresh}
        >
          刷新
        </Button>
      }
    >
      <StatGrid minItemWidth={150} gap={16} style={{ marginBottom: 20 }}>
        <StatCard
          label={<><Wallet size={13} color="var(--m-primary)" />账户余额（元）</>}
          value={wallet === null ? '—' : `¥${(wallet.balance / 100).toFixed(2)}`}
        />
        <StatCard
          label="累计充值（元）"
          value={wallet === null ? '—' : `¥${(wallet.totalRecharge / 100).toFixed(2)}`}
        />
        <StatCard
          label="累计消费（元）"
          value={wallet === null ? '—' : `¥${(wallet.totalConsume / 100).toFixed(2)}`}
        />
      </StatGrid>

      <div style={{ marginBottom: 20 }}>
        <Button
          theme="solid"
          icon={<Plus size={15} />}
          onClick={() => setModalOpen(true)}
          style={{ background: 'var(--m-primary)' }}
        >
          充值
        </Button>
      </div>

      <div className="mc-card-title">收支明细</div>
      <TransactionList
        key={refreshKey}
        op={memberSelfContract.walletTransactions}
        typeLabels={WALLET_TX_TYPE_LABELS}
        formatAmount={(n) => formatYuan(n)}
      />

      <Modal
        title="账户充值"
        visible={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={
          <Button theme="solid" loading={rechargeMutation.isPending} onClick={handleRecharge} style={{ background: 'var(--m-primary)' }}>
            确认充值 · 实付 {formatYuan(discount > 0 ? payableCents : amountCents)}
          </Button>
        }
        closeOnEsc
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {QUICK_AMOUNTS.map((a) => (
            <Button
              key={a}
              theme={amount === a ? 'solid' : 'light'}
              onClick={() => setAmount(a)}
              style={amount === a ? { background: 'var(--m-primary)' } : undefined}
            >
              ¥{a}
            </Button>
          ))}
        </div>
        <InputNumber
          prefix="¥"
          min={1}
          max={50000}
          value={amount}
          onChange={(v) => { setAmount(Number(v) || 0); setCouponId(null); }}
          style={{ width: '100%', marginBottom: 16 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Ticket size={15} color="var(--m-primary)" style={{ flexShrink: 0 }} />
          <Select
            placeholder={usableCoupons.length > 0 ? `${usableCoupons.length} 张券可用` : '暂无可用券'}
            value={couponId ?? undefined}
            onChange={(v) => setCouponId((v as number) ?? null)}
            showClear
            disabled={usableCoupons.length === 0}
            style={{ flex: 1 }}
            optionList={usableCoupons.map((mc) => ({
              value: mc.id,
              label: `${mc.coupon?.name ?? '优惠券'} · 立减 ${formatYuan(couponDiscount(mc, amountCents))}`,
            }))}
          />
        </div>
        {discount > 0 && (
          <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginBottom: 16 }}>
            充值 {formatYuan(amountCents)}，立减 <span style={{ color: 'var(--m-primary)', fontWeight: 600 }}>{formatYuan(discount)}</span>，
            实付 <span style={{ color: 'var(--m-primary)', fontWeight: 600 }}>{formatYuan(payableCents)}</span>（到账按充值金额）
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <span style={{ color: 'var(--m-text-secondary)', fontSize: 13, whiteSpace: 'nowrap' }}>支付应用</span>
          <Select
            value={applicationId}
            placeholder="请选择支付应用"
            loading={paymentOptionsQuery.isFetching}
            optionList={paymentOptions.filter((option) => option.cashierMethods.length > 0).map((option) => ({ value: option.id, label: option.name }))}
            onChange={(value) => setApplicationId(value as number)}
            style={{ flex: 1 }}
          />
        </div>
        <RadioGroup value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentCashierMethod)} type="button">
          {availableMethods.map((p) => (
            <Radio key={p.method} value={p.method}>
              {p.label}
            </Radio>
          ))}
        </RadioGroup>
      </Modal>
    </MemberPage>
  );
}
