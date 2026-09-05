import { POINT_TX_TYPE_LABELS, memberSelfContract } from '@zenith/shared/member';
import { Coins } from 'lucide-react';
import { MemberPage } from '../../components/MemberPage';
import { TransactionList } from '../../components/TransactionList';
import { useMemberPointAccount } from '../../hooks/queries';
import { StatGrid } from '@/components/charts/StatCard';

/** 会员前台自有视觉令牌（--m-*）；与后台一致改为分栏细线，不再画卡片盒子 */
function StatCard({ label, value, accent }: Readonly<{ label: React.ReactNode; value: React.ReactNode; accent?: boolean }>) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 26, fontWeight: 700, color: accent ? 'var(--m-primary)' : 'var(--m-text)', letterSpacing: '-0.03em' }}>
        {value}
      </div>
      <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', marginTop: 9, display: 'flex', alignItems: 'center', gap: 6 }}>
        {label}
      </div>
    </div>
  );
}

export default function PointsPage() {
  const account = useMemberPointAccount().data ?? null;

  return (
    <MemberPage title="我的积分" showBack noTabbar>
      <StatGrid minItemWidth={150} gap={16} style={{ marginBottom: 20 }}>
        <StatCard
          label={<><Coins size={13} color="var(--m-primary)" />当前积分</>}
          value={account?.balance ?? '—'}
          accent
        />
        <StatCard label="累计获得" value={account?.totalEarned ?? '—'} />
        <StatCard label="累计消耗" value={account?.totalSpent ?? '—'} />
      </StatGrid>

      <div className="mc-card-title">积分明细</div>
      <TransactionList
        op={memberSelfContract.pointTransactions}
        typeLabels={POINT_TX_TYPE_LABELS}
        formatAmount={(n) => String(n)}
      />
    </MemberPage>
  );
}
