import { SideSheet, Tag, Descriptions, Table, Spin, Avatar, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { MemberPointTransaction, MemberWalletTransaction, MemberLoginLog } from '@zenith/shared';
import { MEMBER_STATUS_LABELS, POINT_TX_TYPE_LABELS, WALLET_TX_TYPE_LABELS } from '@zenith/shared';
import { useMemberOverview } from '@/hooks/queries/member-admin';

const { Text } = Typography;

interface Props {
  memberId: number | null;
  onClose: () => void;
}

const STATUS_COLORS: Record<string, 'green' | 'grey' | 'red'> = { active: 'green', inactive: 'grey', banned: 'red' };
const POINT_TX_COLORS: Record<string, 'green' | 'red' | 'blue' | 'orange'> = {
  earn: 'green', redeem: 'red', expire: 'grey' as 'red', adjust: 'orange', refund: 'blue',
};
const WALLET_TX_COLORS: Record<string, 'green' | 'red' | 'blue' | 'orange'> = {
  recharge: 'green', consume: 'red', refund: 'blue', adjust: 'orange',
};

const pointTxCols: ColumnProps<MemberPointTransaction>[] = [
  { title: '类型', dataIndex: 'type', width: 80, render: (v: string) => <Tag size="small" color={POINT_TX_COLORS[v] ?? 'blue'}>{POINT_TX_TYPE_LABELS[v as keyof typeof POINT_TX_TYPE_LABELS]}</Tag> },
  { title: '变动', dataIndex: 'amount', width: 80, render: (v: number) => <span style={{ color: v > 0 ? '#07c160' : '#fa5151', fontWeight: 600 }}>{v > 0 ? `+${v}` : v}</span> },
  { title: '余额', dataIndex: 'balanceAfter', width: 80 },
  { title: '备注', dataIndex: 'remark', render: (v: string | null) => <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{v ?? '—'}</Text> },
  { title: '时间', dataIndex: 'createdAt', width: 180 },
];

const walletTxCols: ColumnProps<MemberWalletTransaction>[] = [
  { title: '类型', dataIndex: 'type', width: 80, render: (v: string) => <Tag size="small" color={WALLET_TX_COLORS[v] ?? 'blue'}>{WALLET_TX_TYPE_LABELS[v as keyof typeof WALLET_TX_TYPE_LABELS]}</Tag> },
  { title: '变动(元)', dataIndex: 'amount', width: 90, render: (v: number) => <span style={{ color: v > 0 ? '#07c160' : '#fa5151', fontWeight: 600 }}>{v > 0 ? `+${(v / 100).toFixed(2)}` : (v / 100).toFixed(2)}</span> },
  { title: '余额(元)', dataIndex: 'balanceAfter', width: 90, render: (v: number) => (v / 100).toFixed(2) },
  { title: '备注', dataIndex: 'remark', render: (v: string | null) => <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{v ?? '—'}</Text> },
  { title: '时间', dataIndex: 'createdAt', width: 180 },
];

const loginLogCols: ColumnProps<MemberLoginLog>[] = [
  { title: '状态', dataIndex: 'status', width: 70, render: (v: string) => <Tag size="small" color={v === 'success' ? 'green' : 'red'}>{v === 'success' ? '成功' : '失败'}</Tag> },
  { title: 'IP', dataIndex: 'ip', width: 130, render: (v: string | null) => v ?? '—' },
  { title: '地点', dataIndex: 'location', width: 120, render: (v: string | null) => <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 110 }}>{v ?? '—'}</Text> },
  { title: '浏览器', dataIndex: 'browser', render: (v: string | null) => <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 110 }}>{v ?? '—'}</Text> },
  { title: '时间', dataIndex: 'createdAt', width: 180 },
];

function StatCard({ label, value, sub }: Readonly<{ label: string; value: React.ReactNode; sub?: string }>) {
  return (
    <div style={{ flex: 1, background: 'var(--semi-color-fill-0)', borderRadius: 8, padding: '12px 16px', minWidth: 0 }}>
      <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--semi-color-text-0)', lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--semi-color-text-3)', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

export function MemberDetailDrawer({ memberId, onClose }: Readonly<Props>) {
  const overviewQuery = useMemberOverview(memberId, !!memberId);
  const overview = overviewQuery.data ?? null;
  const m = overview?.member;

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
            {/* 会员头像 + 基本信息 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, padding: '16px 20px', background: 'var(--semi-color-fill-0)', borderRadius: 10 }}>
              <Avatar size="large" src={m?.avatar ?? undefined} style={{ flexShrink: 0, background: '#07c160', fontSize: 18 }}>
                {!m?.avatar && (m?.nickname?.charAt(0) ?? '?')}
              </Avatar>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                  <span style={{ fontSize: 18, fontWeight: 700 }}>{m?.nickname}</span>
                  <Tag color={STATUS_COLORS[m?.status ?? 'inactive']} size="small">
                    {MEMBER_STATUS_LABELS[m?.status as keyof typeof MEMBER_STATUS_LABELS]}
                  </Tag>
                  {m?.levelName && <Tag color="amber" size="small">{m.levelName}</Tag>}
                </div>
                <Descriptions row size="small" data={[
                  { key: '手机', value: m?.phone ?? '—' },
                  { key: '邮箱', value: <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 180 }}>{m?.email ?? '—'}</Text> },
                  { key: '注册来源', value: m?.registerSource },
                  { key: '最后登录', value: m?.lastLoginAt ?? '—' },
                ]} />
              </div>
            </div>

            {/* 核心数据卡片 */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
              <StatCard label="积分余额" value={overview.points.balance} sub={`累计 ${overview.points.totalEarned}`} />
              <StatCard label="钱包余额(元)" value={(overview.wallet.balance / 100).toFixed(2)} sub={`累计充值 ${(overview.wallet.totalRecharge / 100).toFixed(2)} 元`} />
              <StatCard label="可用卡券" value={overview.activeCouponCount} />
              <StatCard label="登录次数" value={overview.loginLogCount} />
            </div>

            {/* 最近积分流水 */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--semi-color-text-0)' }}>最近积分记录</div>
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
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--semi-color-text-0)' }}>最近钱包记录</div>
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
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--semi-color-text-0)' }}>最近登录记录</div>
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
