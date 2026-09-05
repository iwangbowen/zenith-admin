import { useState } from 'react';
import { Button, Empty, Modal, Pagination, Select, Spin, Switch, Tag, Toast } from '@douyinfe/semi-ui';
import { BellRing } from 'lucide-react';
import { CMS_SUBSCRIPTION_SUBJECT_TYPE_LABELS, CMS_SUBSCRIPTION_SUBJECT_TYPE_OPTIONS } from '@zenith/shared/cms';
import type { CmsSubscriptionSubjectType } from '@zenith/shared/cms';
import { MemberPage } from '../../components/MemberPage';
import {
  useCancelCmsSubscription,
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
  const list = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;

  const handleCancel = (id: number, label: string) => {
    Modal.confirm({
      title: '取消关注',
      content: `确定取消关注「${label}」吗？取消不会倒扣已获得积分。`,
      onOk: async () => {
        await cancelMutation.mutateAsync({ params: { id } });
        Toast.success('已取消关注');
      },
    });
  };

  return (
    <MemberPage title="我的关注">
      <div style={{ marginBottom: 14 }}>
        <Select
          aria-label="关注类型"
          placeholder="全部关注类型"
          value={subjectType}
          showClear
          style={{ width: 180 }}
          optionList={CMS_SUBSCRIPTION_SUBJECT_TYPE_OPTIONS}
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
                  loading={updateMutation.isPending && updateMutation.variables?.params.id === item.id}
                  onChange={(notificationEnabled) => {
                    void updateMutation.mutateAsync({ params: { id: item.id }, body: { notificationEnabled } });
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
