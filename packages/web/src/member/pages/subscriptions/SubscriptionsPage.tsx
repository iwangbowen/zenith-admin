import { useState } from 'react';
import { Button, Empty, Modal, Pagination, Select, Spin, Switch, Tag, Toast } from '@douyinfe/semi-ui';
import { BellRing, CalendarCheck } from 'lucide-react';
import { CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS, type CmsSubscriptionSubjectType } from '@zenith/shared';
import { MemberPage } from '../../components/MemberPage';
import {
  useCancelCmsSubscription,
  useCheckinStatus,
  useMemberCheckin,
  useMyCmsSubscriptions,
  useUpdateCmsSubscription,
} from '../../hooks/queries';

const PAGE_SIZE = 10;

export default function SubscriptionsPage() {
  const [page, setPage] = useState(1);
  const [subjectType, setSubjectType] = useState<CmsSubscriptionSubjectType | undefined>();
  const listQuery = useMyCmsSubscriptions({ page, pageSize: PAGE_SIZE, subjectType });
  const updateMutation = useUpdateCmsSubscription();
  const cancelMutation = useCancelCmsSubscription();
  const checkinQuery = useCheckinStatus();
  const checkinMutation = useMemberCheckin();
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const handleCheckin = async () => {
    const result = await checkinMutation.mutateAsync();
    Toast.success(`签到成功，获得 ${result.points} 积分`);
  };

  const handleCancel = (id: number, label: string) => {
    Modal.confirm({
      title: '取消关注',
      content: `确定取消关注「${label}」吗？取消不会倒扣已获得积分。`,
      onOk: async () => {
        await cancelMutation.mutateAsync(id);
        Toast.success('已取消关注');
      },
    });
  };

  return (
    <MemberPage title="我的关注">
      <section
        aria-label="签到状态"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: 16,
          marginBottom: 16,
          border: '1px solid var(--semi-color-border)',
          borderRadius: 12,
          background: 'var(--semi-color-bg-1)',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <CalendarCheck size={17} />
            每日签到
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
            {checkinQuery.data?.checkedToday
              ? `今日已签到，连续 ${checkinQuery.data.consecutiveDays} 天`
              : `今日签到可得 ${checkinQuery.data?.todayPoints ?? 0} 积分`}
          </div>
        </div>
        <Button
          type="primary"
          disabled={checkinQuery.data?.checkedToday}
          loading={checkinMutation.isPending || checkinQuery.isFetching}
          onClick={() => void handleCheckin()}
        >
          {checkinQuery.data?.checkedToday ? '今日已签到' : '立即签到'}
        </Button>
      </section>

      <div style={{ marginBottom: 14 }}>
        <Select
          aria-label="关注类型"
          placeholder="全部关注类型"
          value={subjectType}
          showClear
          style={{ width: 180 }}
          optionList={Object.entries(CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          onChange={(value) => {
            setSubjectType(value as CmsSubscriptionSubjectType | undefined);
            setPage(1);
          }}
        />
      </div>

      {listQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Spin /></div>
      ) : listQuery.isError ? (
        <Empty
          title="关注列表加载失败"
          description="请检查网络后重试"
          style={{ padding: 40 }}
        >
          <Button onClick={() => void listQuery.refetch()}>重试</Button>
        </Empty>
      ) : list.length === 0 ? (
        <Empty
          title="暂无关注"
          description="可在 CMS 站点、栏目页或内容作者旁点击「关注」"
          style={{ padding: 40 }}
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map((item) => (
            <article
              key={item.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 14,
                border: '1px solid var(--semi-color-border)',
                borderRadius: 10,
                background: 'var(--semi-color-bg-1)',
              }}
            >
              <BellRing size={18} color="var(--m-primary)" aria-hidden />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Tag size="small">{CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS[item.subjectType]}</Tag>
                  <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.subjectLabel}
                  </strong>
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                  {item.siteName ?? `站点 #${item.siteId}`} · 关注于 {item.createdAt}
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                通知
                <Switch
                  size="small"
                  checked={item.notificationEnabled}
                  loading={updateMutation.isPending && updateMutation.variables?.id === item.id}
                  onChange={(notificationEnabled) => {
                    void updateMutation.mutateAsync({ id: item.id, notificationEnabled });
                  }}
                />
              </label>
              <Button theme="borderless" type="danger" size="small" onClick={() => handleCancel(item.id, item.subjectLabel)}>
                取消
              </Button>
            </article>
          ))}
        </div>
      )}
      {total > PAGE_SIZE ? (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 16 }}>
          <Pagination total={total} pageSize={PAGE_SIZE} currentPage={page} onPageChange={setPage} />
        </div>
      ) : null}
    </MemberPage>
  );
}
