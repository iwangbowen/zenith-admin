import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, TabPane, Tabs, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { LogOut, Plus, RefreshCw } from 'lucide-react';
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import WorkflowSummaryLine from '@/components/workflow/WorkflowSummaryLine';
import WorkflowSLATag from '@/components/workflow/WorkflowSLATag';
import WorkflowPriorityTag from '@/components/workflow/WorkflowPriorityTag';
import { useApprovalList, type ApprovalListItem, type ApprovalTab } from '../lib/queries';

type TagColor = 'amber' | 'blue' | 'green' | 'grey' | 'orange' | 'purple' | 'red';

const STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  draft: { text: '草稿', color: 'grey' },
  running: { text: '审批中', color: 'blue' },
  suspended: { text: '已挂起', color: 'amber' },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red' },
  withdrawn: { text: '已撤回', color: 'orange' },
  cancelled: { text: '已取消', color: 'purple' },
};

const TABS: Array<{ key: ApprovalTab; label: string }> = [
  { key: 'pending', label: '待办' },
  { key: 'handled', label: '已办' },
  { key: 'mine', label: '我的申请' },
];

function TaskCard({ item, tab, onOpen }: Readonly<{ item: ApprovalListItem; tab: ApprovalTab; onOpen: () => void }>) {
  const status = STATUS_MAP[item.status];
  return (
    <div
      className="ap-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      <div className="ap-card__title-row">
        <span className="ap-card__title">{item.title}</span>
        {(item.priority === 'high' || item.priority === 'urgent') && <WorkflowPriorityTag priority={item.priority} />}
        {status && <Tag size="small" color={status.color} style={{ flexShrink: 0 }}>{status.text}</Tag>}
      </div>
      <WorkflowSummaryLine items={item.summary} />
      <div className="ap-card__meta">
        {tab === 'pending' && <WorkflowSLATag level={item.slaLevel} overdueSec={item.slaOverdueSec} deadline={item.slaDeadline} />}
        <span>{item.definitionName ?? '—'}</span>
        <span>·</span>
        <span>{item.initiatorName ?? '—'}</span>
        <span>·</span>
        <span>{formatDateTime(item.createdAt)}</span>
      </div>
    </div>
  );
}

export default function TaskListPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ApprovalTab>('pending');
  const [size, setSize] = useState(10);
  const listQuery = useApprovalList(tab, size);
  const data = listQuery.data;
  const total = data?.total ?? 0;
  const hasMore = (data?.list ?? []).length < total;

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    Toast.info('已退出移动审批');
    navigate('/login', { replace: true });
  };

  const openItem = (item: ApprovalListItem) => {
    if (tab === 'pending' && item.pendingTaskId) {
      navigate(`/detail/${item.id}/${item.pendingTaskId}`);
    } else {
      navigate(`/detail/${item.id}`);
    }
  };

  return (
    <div className="ap-page">
      <div className="ap-header">
        <span className="ap-header__title">移动审批</span>
        <Button
          theme="borderless"
          icon={<RefreshCw size={16} />}
          loading={listQuery.isFetching}
          onClick={() => void listQuery.refetch()}
          aria-label="刷新"
        />
        <Button theme="solid" type="primary" size="small" icon={<Plus size={14} />} onClick={() => navigate('/launch')}>
          发起
        </Button>
        <Button theme="borderless" icon={<LogOut size={16} />} onClick={logout} aria-label="退出" />
      </div>
      <Tabs
        type="line"
        activeKey={tab}
        onChange={(k) => { setTab(k as ApprovalTab); setSize(10); }}
        tabPaneMotion={false}
        style={{ padding: '0 12px', background: 'var(--semi-color-bg-1)' }}
      >
        {TABS.map((t) => <TabPane key={t.key} tab={t.label} itemKey={t.key} />)}
      </Tabs>
      <div className="ap-body">
        {(data?.list ?? []).map((item) => (
          <TaskCard key={`${item.id}-${item.pendingTaskId ?? 0}`} item={item} tab={tab} onOpen={() => openItem(item)} />
        ))}
        {!listQuery.isFetching && (data?.list ?? []).length === 0 && (
          <div className="ap-empty">{tab === 'pending' ? '没有待办，休息一下 🎉' : '暂无数据'}</div>
        )}
        {hasMore && (
          <Button block theme="light" loading={listQuery.isFetching} onClick={() => setSize((s) => s + 10)}>
            加载更多（{(data?.list ?? []).length}/{total}）
          </Button>
        )}
        {(data?.list ?? []).length > 0 && (
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', textAlign: 'center', marginTop: 8 }}>
            共 {total} 条
          </Typography.Text>
        )}
      </div>
    </div>
  );
}
