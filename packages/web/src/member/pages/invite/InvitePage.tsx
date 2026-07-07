import { Button, Spin, Table, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Copy, Gift, UserPlus, Users } from 'lucide-react';
import { MemberPage } from '../../components/MemberPage';
import { useInviteSummary } from '../../hooks/queries';

function StatBlock({ icon, label, value }: Readonly<{ icon: React.ReactNode; label: string; value: React.ReactNode }>) {
  return (
    <div style={{ flex: 1, minWidth: 160, background: '#fff', border: '1px solid var(--m-border)', borderRadius: 12, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ color: 'var(--m-primary)' }}>{icon}</div>
      <div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{value}</div>
        <div style={{ fontSize: 12, color: 'var(--m-text-secondary)' }}>{label}</div>
      </div>
    </div>
  );
}

export default function InvitePage() {
  const summaryQuery = useInviteSummary();
  const summary = summaryQuery.data ?? null;

  const inviteLink = summary
    ? `${window.location.origin}${window.location.pathname}#/?invite=${summary.inviteCode}`
    : '';

  const copy = async (text: string, tip: string) => {
    await navigator.clipboard.writeText(text);
    Toast.success(tip);
  };

  const columns: ColumnProps<{ id: number; nickname: string; createdAt: string }>[] = [
    { title: '昵称', dataIndex: 'nickname' },
    { title: '注册时间', dataIndex: 'createdAt', width: 180 },
  ];

  if (summaryQuery.isFetching && !summary) {
    return <MemberPage title="邀请有礼"><div className="m-loading-wrap"><Spin /></div></MemberPage>;
  }

  return (
    <MemberPage title="邀请有礼">
      {/* 邀请码卡片 */}
      <div
        style={{
          background: 'linear-gradient(135deg, var(--m-primary) 0%, var(--m-primary-dark) 100%)',
          borderRadius: 12, padding: '22px 24px', color: '#fff', marginBottom: 16,
        }}
      >
        <div style={{ fontSize: 13, opacity: 0.85, marginBottom: 6 }}>我的邀请码</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: 4, fontFamily: 'monospace' }}>{summary?.inviteCode}</span>
          <Button size="small" icon={<Copy size={13} />} onClick={() => summary && void copy(summary.inviteCode, '邀请码已复制')}>
            复制
          </Button>
          <Button size="small" theme="solid" style={{ background: 'rgba(255,255,255,0.22)' }}
            onClick={() => void copy(inviteLink, '邀请链接已复制')}>
            复制邀请链接
          </Button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 10 }}>
          好友通过你的邀请码注册成功后，奖励自动到账。
        </div>
      </div>

      {/* 统计 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <StatBlock icon={<Users size={22} />} label="已邀请好友" value={summary?.invitedCount ?? 0} />
        <StatBlock icon={<Gift size={22} />} label="累计奖励积分" value={summary?.totalRewardPoints ?? 0} />
      </div>

      {/* 邀请记录 */}
      <div style={{ background: '#fff', border: '1px solid var(--m-border)', borderRadius: 12, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
          <UserPlus size={16} color="var(--m-primary)" />
          最近邀请
        </div>
        <Table
          columns={columns}
          dataSource={summary?.recentInvitees ?? []}
          rowKey="id"
          size="small"
          pagination={false}
          empty="还没有邀请记录，快去分享你的邀请码吧"
        />
      </div>
    </MemberPage>
  );
}
