import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Toast, RadioGroup, Radio, InputNumber } from '@douyinfe/semi-ui';
import { Plus, RefreshCw, Wallet } from 'lucide-react';
import { WALLET_TX_TYPE_LABELS } from '@zenith/shared';
import { MemberPage } from '../../components/MemberPage';
import { TransactionList } from '../../components/TransactionList';
import { formatYuan } from '../../utils/format';
import { memberKeys, useCreateRechargeOrder, useMemberWallet } from '../../hooks/queries';

const QUICK_AMOUNTS = [10, 50, 100, 200, 500];
const PAY_METHODS = [
  { value: 'wechat_h5', label: '微信支付' },
  { value: 'alipay_wap', label: '支付宝' },
];

function StatCard({ label, value }: Readonly<{ label: React.ReactNode; value: React.ReactNode }>) {
  return (
    <div style={{
      flex: 1,
      background: '#fff',
      borderRadius: 10,
      border: '1px solid var(--m-border)',
      padding: '16px 20px',
    }}>
      <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--m-text)' }}>{value}</div>
    </div>
  );
}

export default function WalletPage() {
  const queryClient = useQueryClient();
  const wallet = useMemberWallet().data ?? null;
  const rechargeMutation = useCreateRechargeOrder();
  const [modalOpen, setModalOpen] = useState(false);
  const [amount, setAmount] = useState<number>(100);
  const [payMethod, setPayMethod] = useState('wechat_h5');
  const [refreshKey, setRefreshKey] = useState(0);

  const handleRecharge = async () => {
    if (!amount || amount <= 0) {
      Toast.warning('请输入充值金额');
      return;
    }
    const r = await rechargeMutation.mutateAsync({
      amount: Math.round(amount * 100),
      payMethod,
    });
    setModalOpen(false);
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
      content: `订单号：${r.orderNo}，支付完成后余额将自动到账。`,
    });
  };

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
    void queryClient.invalidateQueries({ queryKey: memberKeys.wallet.all });
    void queryClient.invalidateQueries({ queryKey: memberKeys.transactions.lists });
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
      <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
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
      </div>

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
        fetchUrl="/api/member/wallet/transactions"
        typeLabels={WALLET_TX_TYPE_LABELS}
        formatAmount={(n) => formatYuan(n)}
      />

      <Modal
        title="账户充值"
        visible={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={
          <Button theme="solid" loading={rechargeMutation.isPending} onClick={handleRecharge} style={{ background: 'var(--m-primary)' }}>
            确认充值 ¥{amount || 0}
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
          onChange={(v) => setAmount(Number(v) || 0)}
          style={{ width: '100%', marginBottom: 16 }}
        />
        <RadioGroup value={payMethod} onChange={(e) => setPayMethod(e.target.value)} type="button">
          {PAY_METHODS.map((p) => (
            <Radio key={p.value} value={p.value}>
              {p.label}
            </Radio>
          ))}
        </RadioGroup>
      </Modal>
    </MemberPage>
  );
}