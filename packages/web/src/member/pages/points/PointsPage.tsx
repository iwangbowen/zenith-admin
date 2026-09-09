import { POINT_TX_TYPE_LABELS, memberSelfContract } from '@zenith/shared/member';
import { Coins } from 'lucide-react';
import { MemberPage } from '../../components/MemberPage';
import { StatCard } from '../../components/StatCard';
import { TransactionList } from '../../components/TransactionList';
import { useMemberPointAccount } from '../../hooks/queries';
import { StatGrid } from '@/components/charts/StatCard';

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
