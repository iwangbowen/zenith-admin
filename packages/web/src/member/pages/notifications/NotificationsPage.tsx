import { useState } from 'react';
import { Button, Pagination, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import { BellRing, CheckCheck } from 'lucide-react';
import type { MemberNotification } from '@zenith/shared';
import { MemberPage } from '../../components/MemberPage';
import { useMarkAllNotificationsRead, useMarkNotificationRead, useMyNotifications } from '../../hooks/queries';

const TYPE_LABELS: Record<string, { label: string; color: 'green' | 'orange' | 'blue' | 'red' | 'purple' }> = {
  birthday: { label: '生日礼', color: 'green' },
  birthday_coupon: { label: '生日礼', color: 'green' },
  coupon_expiring: { label: '到期提醒', color: 'orange' },
  point_adjust: { label: '积分变动', color: 'blue' },
  wallet_adjust: { label: '余额变动', color: 'blue' },
  invite_reward: { label: '邀请奖励', color: 'purple' },
  system: { label: '系统', color: 'red' },
};

function NotificationItem({ item, onRead }: Readonly<{ item: MemberNotification; onRead: (id: number) => void }>) {
  const meta = TYPE_LABELS[item.type] ?? { label: '通知', color: 'blue' as const };
  const unread = !item.readAt;
  return (
    <button
      type="button"
      onClick={() => unread && onRead(item.id)}
      style={{
        display: 'block', width: '100%', textAlign: 'left', cursor: unread ? 'pointer' : 'default',
        background: '#fff', border: '1px solid var(--m-border)', borderRadius: 12,
        padding: '14px 16px', marginBottom: 10,
        opacity: unread ? 1 : 0.65,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        {unread && <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--m-danger, #fa5151)', flexShrink: 0 }} />}
        <Tag color={meta.color} size="small">{meta.label}</Tag>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--m-text)' }}>{item.title}</span>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--m-text-tertiary, #9ca3af)' }}>{item.createdAt}</span>
      </div>
      {item.content && <div style={{ fontSize: 13, color: 'var(--m-text-secondary)', lineHeight: 1.6 }}>{item.content}</div>}
    </button>
  );
}

export default function NotificationsPage() {
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const listQuery = useMyNotifications({ page, pageSize });
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const handleMarkAll = async () => {
    await markAllRead.mutateAsync();
    Toast.success('已全部标为已读');
  };

  return (
    <MemberPage title="消息中心">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Button theme="borderless" icon={<CheckCheck size={14} />} loading={markAllRead.isPending} onClick={handleMarkAll}>
          全部已读
        </Button>
      </div>
      {listQuery.isFetching && list.length === 0 ? (
        <div className="m-loading-wrap"><Spin /></div>
      ) : list.length === 0 ? (
        <div className="m-empty">
          <BellRing size={28} style={{ opacity: 0.4, marginBottom: 8 }} />
          <div>暂无消息</div>
        </div>
      ) : (
        <>
          {list.map((n) => (
            <NotificationItem key={n.id} item={n} onRead={(id) => void markRead.mutateAsync(id)} />
          ))}
          {total > pageSize && (
            <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 8 }}>
              <Pagination total={total} pageSize={pageSize} currentPage={page} onChange={setPage} />
            </div>
          )}
        </>
      )}
    </MemberPage>
  );
}
