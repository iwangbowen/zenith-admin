import { SideSheet, Tag, Descriptions, Divider, Table, Spin, Avatar, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useNavigate } from 'react-router-dom';
import type { MemberPointTransaction, MemberWalletTransaction, MemberLoginLog } from '@zenith/shared/member';
import { MEMBER_STATUS_LABELS, POINT_TX_TYPE_LABELS, WALLET_TX_TYPE_LABELS } from '@zenith/shared/member';
import { useMemberOverview } from '@/hooks/queries/member-admin';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { dateTimeColumn } from '@/utils/table-columns';
import { MEMBER_STATUS_COLORS } from './member-tag-colors';

const { Text } = Typography;

interface Props {
  memberId: number | null;
  onClose: () => void;
}

const POINT_TX_COLORS: Record<string, 'green' | 'red' | 'blue' | 'orange'> = {
  earn: 'green', redeem: 'red', expire: 'grey' as 'red', adjust: 'orange', refund: 'blue',
};
const WALLET_TX_COLORS: Record<string, 'green' | 'red' | 'blue' | 'orange'> = {
  recharge: 'green', consume: 'red', refund: 'blue', adjust: 'orange',
};

const pointTxCols: ColumnProps<MemberPointTransaction>[] = [
  { title: '类型', dataIndex: 'type', width: 100, render: (v: string) => <Tag size="small" color={POINT_TX_COLORS[v] ?? 'blue'}>{POINT_TX_TYPE_LABELS[v as keyof typeof POINT_TX_TYPE_LABELS]}</Tag> },
  { title: '变动', dataIndex: 'amount', width: 80, align: 'right', render: (v: number) => <span style={{ color: v > 0 ? '#07c160' : '#fa5151', fontWeight: 600 }}>{v > 0 ? `+${v}` : v}</span> },
  { title: '余额', dataIndex: 'balanceAfter', width: 80, align: 'right' },
  { title: '备注', dataIndex: 'remark', render: (v: string | null) => <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{v ?? '—'}</Text> },
  dateTimeColumn('时间', 'createdAt'),
];

const walletTxCols: ColumnProps<MemberWalletTransaction>[] = [
  { title: '类型', dataIndex: 'type', width: 80, render: (v: string) => <Tag size="small" color={WALLET_TX_COLORS[v] ?? 'blue'}>{WALLET_TX_TYPE_LABELS[v as keyof typeof WALLET_TX_TYPE_LABELS]}</Tag> },
  { title: '变动(元)', dataIndex: 'amount', width: 90, align: 'right', render: (v: number) => <span style={{ color: v > 0 ? '#07c160' : '#fa5151', fontWeight: 600 }}>{v > 0 ? `+${(v / 100).toFixed(2)}` : (v / 100).toFixed(2)}</span> },
  { title: '余额(元)', dataIndex: 'balanceAfter', width: 90, align: 'right', render: (v: number) => (v / 100).toFixed(2) },
  { title: '备注', dataIndex: 'remark', render: (v: string | null) => <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{v ?? '—'}</Text> },
  dateTimeColumn('时间', 'createdAt'),
];

const loginLogCols: ColumnProps<MemberLoginLog>[] = [
  { title: '状态', dataIndex: 'status', width: 80, render: (v: string) => <Tag size="small" color={v === 'success' ? 'green' : 'red'}>{v === 'success' ? '成功' : '失败'}</Tag> },
  { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string | null) => v ?? '—' },
  { title: '地点', dataIndex: 'location', width: 120, render: (v: string | null) => <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 110 }}>{v ?? '—'}</Text> },
  { title: '浏览器', dataIndex: 'browser', render: (v: string | null) => <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 110 }}>{v ?? '—'}</Text> },
  dateTimeColumn('时间', 'createdAt'),
];

export function MemberDetailDrawer({ memberId, onClose }: Readonly<Props>) {
  const navigate = useNavigate();
  const overviewQuery = useMemberOverview(memberId, !!memberId);
  const overview = overviewQuery.data ?? null;
  const m = overview?.member;

  // 跳转到目标页并按会员 ID 精确筛选（memberKeyword 纯数字 = 按会员 ID 匹配），同时关闭抽屉
  const goTo = (path: string) => {
    if (!memberId) return;
    onClose();
    navigate(`${path}?memberKeyword=${memberId}`);
  };

  const sectionTitle = (label: string, path: string) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--semi-color-text-0)' }}>{label}</span>
      <Typography.Text link size="small" onClick={() => goTo(path)}>查看全部</Typography.Text>
    </div>
  );

  return (
    <SideSheet
      title={m ? `会员详情 · ${m.nickname}` : '会员详情'}
      visible={!!memberId}
      onCancel={onClose}
      width={680}
      bodyStyle={{ padding: 0, overflow: 'auto' }}
    >
      <Spin spinning={overviewQuery.isFetching}>
        {overview && (
          <div style={{ padding: '20px 24px' }}>
            {/* 会员头像 + 昵称：与订单详情一致的无卡片形态 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <Avatar size="default" src={m?.avatar ?? undefined} style={{ flexShrink: 0, background: '#07c160' }}>
                {!m?.avatar && (m?.nickname?.charAt(0) ?? '?')}
              </Avatar>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
                <span style={{ fontSize: 16, fontWeight: 600 }}>{m?.nickname}</span>
                <Tag color={MEMBER_STATUS_COLORS[m?.status ?? 'inactive']} size="small">
                  {MEMBER_STATUS_LABELS[m?.status as keyof typeof MEMBER_STATUS_LABELS]}
                </Tag>
                {m?.levelName && <Tag color="amber" size="small">{m.levelName}</Tag>}
                {m?.tags?.map((t) => <Tag key={t.id} size="small" color={(t.color || 'blue') as 'blue'}>{t.name}</Tag>)}
                {overview.mpFans.map((f) => (
                  <Tag key={`fan-${f.id}`} size="small" color="lime">公众号粉丝 · {f.nickname || f.openid.slice(0, 8)}</Tag>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <Divider align="left" style={{ margin: '12px 0 10px' }}>基本信息</Divider>
              <Descriptions
                layout="horizontal"
                column={2}
                size="small"
                data={[
                  { key: '用户名', value: m?.username ?? '—' },
                  { key: '手机', value: m?.phone ?? '—' },
                  { key: '邮箱', value: <Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 220 }}>{m?.email ?? '—'}</Text> },
                  { key: '注册来源', value: m?.registerSource ?? '—' },
                  { key: '最后登录', value: m?.lastLoginAt ?? '—' },
                  { key: '成长值', value: `${m?.growthValue ?? 0}（经验 ${m?.experience ?? 0}）` },
                  { key: '邀请人', value: overview.inviter ? `${overview.inviter.nickname} #${overview.inviter.id}` : '—' },
                  { key: '邀请码', value: overview.inviteCode ?? '—' },
                  { key: '已邀请', value: `${overview.invitedCount} 人` },
                ]}
              />
            </div>

            {/* 核心数据卡片：点击跳到对应管理页并按当前会员筛选 */}
            <StatGrid minItemWidth={150} style={{ marginBottom: 20 }}>
              <StatCard title="积分余额" value={overview.points.balance} sub={`累计 ${overview.points.totalEarned}`} onClick={() => goTo('/member/points')} />
              <StatCard title="钱包余额(元)" value={(overview.wallet.balance / 100).toFixed(2)} sub={`累计充值 ${(overview.wallet.totalRecharge / 100).toFixed(2)} 元`} onClick={() => goTo('/member/wallets')} />
              <StatCard title="可用卡券" value={overview.activeCouponCount} onClick={() => goTo('/member/coupon-records')} />
              <StatCard title="累计签到" value={overview.checkinTotal} sub={`登录 ${overview.loginLogCount} 次`} onClick={() => goTo('/member/checkin-logs')} />
            </StatGrid>

            {/* 最近积分流水 */}
            <div style={{ marginBottom: 20 }}>
              {sectionTitle('最近积分记录', '/member/points')}
              <Table
                columns={pointTxCols}
                dataSource={overview.recentPointTxs}
                rowKey="id"
                size="small"
                bordered
                pagination={false}
                empty={<div style={{ textAlign: 'center', padding: '16px 0', color: '#9ca3af' }}>暂无记录</div>}
              />
            </div>

            {/* 最近钱包流水 */}
            <div style={{ marginBottom: 20 }}>
              {sectionTitle('最近钱包记录', '/member/wallets')}
              <Table
                columns={walletTxCols}
                dataSource={overview.recentWalletTxs}
                rowKey="id"
                size="small"
                bordered
                pagination={false}
                empty={<div style={{ textAlign: 'center', padding: '16px 0', color: '#9ca3af' }}>暂无记录</div>}
              />
            </div>

            {/* 最近登录记录 */}
            <div>
              {sectionTitle('最近登录记录', '/member/login-logs')}
              <Table
                columns={loginLogCols}
                dataSource={overview.recentLoginLogs}
                rowKey="id"
                size="small"
                bordered
                pagination={false}
                empty={<div style={{ textAlign: 'center', padding: '16px 0', color: '#9ca3af' }}>暂无记录</div>}
              />
            </div>
          </div>
        )}
      </Spin>
    </SideSheet>
  );
}
