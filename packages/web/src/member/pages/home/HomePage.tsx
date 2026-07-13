import { useNavigate } from 'react-router-dom';
import { Avatar } from '@douyinfe/semi-ui';
import { Coins, Wallet, Ticket, Crown, Repeat } from 'lucide-react';
import { useMemberAuth } from '../../hooks/useMemberAuth';
import { MemberPage } from '../../components/MemberPage';
import { formatYuan } from '../../utils/format';
import { useMemberCouponList, useMemberPointAccount, useMemberWallet, useMyRenewal } from '../../hooks/queries';

export default function HomePage() {
  const navigate = useNavigate();
  const { member } = useMemberAuth();
  const pointsQuery = useMemberPointAccount();
  const walletQuery = useMemberWallet();
  const couponQuery = useMemberCouponList({ status: 'unused', page: 1, pageSize: 1 });
  const renewalQuery = useMyRenewal();
  const points = pointsQuery.data?.balance ?? null;
  const wallet = walletQuery.data?.balance ?? null;
  const couponCount = couponQuery.data?.total ?? null;
  const vipExpireAt = renewalQuery.data?.vipExpireAt ?? null;

  return (
    <MemberPage title="会员概览">
      {/* 欢迎横幅 */}
      <div className="mc-welcome-banner">
        <Avatar size="large" src={member?.avatar ?? undefined} style={{ background: 'rgba(255,255,255,0.3)', flexShrink: 0 }}>
          {member?.nickname?.[0] ?? 'U'}
        </Avatar>
        <div className="mc-welcome-text">
          <h3>欢迎回来，{member?.nickname ?? '会员'}！</h3>
          <p>
            {member?.levelName ? (
              <>
                <Crown size={12} style={{ display: 'inline', marginRight: 4 }} />
                {member.levelName}
                {member.growthValue !== undefined ? `  · 成长值 ${member.growthValue}` : ''}
              </>
            ) : '普通会员'}
          </p>
        </div>
      </div>

      {/* 资产统计 */}
      <div className="mc-stat-row">
        <button type="button" className="mc-stat-card" onClick={() => navigate('/points')}>
          <div className="mc-stat-label">
            <Coins size={14} color="var(--m-primary)" />
            我的积分
          </div>
          <div className="mc-stat-value">{points ?? '—'}</div>
        </button>
        <button type="button" className="mc-stat-card" onClick={() => navigate('/wallet')}>
          <div className="mc-stat-label">
            <Wallet size={14} color="var(--m-primary)" />
            账户余额
          </div>
          <div className="mc-stat-value">{wallet === null ? '—' : formatYuan(wallet)}</div>
        </button>
        <button type="button" className="mc-stat-card" onClick={() => navigate('/coupons')}>
          <div className="mc-stat-label">
            <Ticket size={14} color="var(--m-primary)" />
            可用卡券
          </div>
          <div className="mc-stat-value">{couponCount ?? '—'}</div>
        </button>
        <button type="button" className="mc-stat-card" onClick={() => navigate('/renewal')}>
          <div className="mc-stat-label">
            <Repeat size={14} color="var(--m-primary)" />
            自动续费
          </div>
          <div className="mc-stat-value" style={{ fontSize: vipExpireAt ? 13 : undefined }}>
            {vipExpireAt ? `VIP 至 ${vipExpireAt.slice(0, 10)}` : '未开通'}
          </div>
        </button>
      </div>
    </MemberPage>
  );
}
