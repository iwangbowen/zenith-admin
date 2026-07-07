import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Input, Modal, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { Check, CircleCheckBig, ClipboardCheck, FilePlus2, LogOut, Plus, RefreshCw, Search, Send, type LucideIcon } from 'lucide-react';
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import { UserAvatar } from '@/components/UserAvatar';
import WorkflowSummaryLine from '@/components/workflow/WorkflowSummaryLine';
import WorkflowSLATag from '@/components/workflow/WorkflowSLATag';
import WorkflowPriorityTag from '@/components/workflow/WorkflowPriorityTag';
import {
  useApprovalCounts, useApprovalList, useMarkCcRead, useTaskAction,
  type ApprovalListItem, type ApprovalTab,
} from '../lib/queries';
import { useInfiniteSentinel, usePullRefresh } from '../lib/usePullRefresh';

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

const TASK_RESULT_MAP: Record<string, { text: string; color: TagColor }> = {
  approved: { text: '我已同意', color: 'green' },
  rejected: { text: '我已拒绝', color: 'red' },
  skipped: { text: '已跳过', color: 'grey' },
};

const EMPTY_TEXT: Record<ApprovalTab, string> = {
  pending: '没有待办，休息一下 🎉',
  handled: '暂无已办记录',
  mine: '还没有发起过申请',
  cc: '暂无抄送',
};

/** 底部标签栏（主流 App TabBar）：图标 + 文字 + 角标 */
const TAB_ITEMS: { key: ApprovalTab; label: string; icon: LucideIcon }[] = [
  { key: 'pending', label: '待办', icon: ClipboardCheck },
  { key: 'handled', label: '已办', icon: CircleCheckBig },
  { key: 'mine', label: '我的申请', icon: FilePlus2 },
  { key: 'cc', label: '抄送我', icon: Send },
];

interface CardProps {
  item: ApprovalListItem;
  tab: ApprovalTab;
  onOpen: () => void;
  onQuickApprove?: () => void;
  quickApproving?: boolean;
}

function TaskCard({ item, tab, onOpen, onQuickApprove, quickApproving }: Readonly<CardProps>) {
  const status = STATUS_MAP[item.status];
  const myResult = tab === 'handled' && item.myTaskStatus ? TASK_RESULT_MAP[item.myTaskStatus] : null;
  const ccUnread = tab === 'cc' && item.ccTaskId != null && !item.ccReadAt;
  // 极速同意：无需签名/加签选人时展示（意见必填等由服务端校验兜底，失败引导进详情）
  const canQuick = tab === 'pending' && onQuickApprove != null
    && !item.requiresIndividual && !item.pendingSignatureRequired;

  return (
    <div
      className="ap-card"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
    >
      <div className="ap-card__title-row">
        {ccUnread && <span className="ap-dot" aria-label="未读" />}
        <span className="ap-card__title">{item.title}</span>
        {(item.priority === 'high' || item.priority === 'urgent') && <WorkflowPriorityTag priority={item.priority} />}
        {myResult
          ? <Tag size="small" color={myResult.color} style={{ flexShrink: 0 }}>{myResult.text}</Tag>
          : status && <Tag size="small" color={status.color} style={{ flexShrink: 0 }}>{status.text}</Tag>}
      </div>
      <WorkflowSummaryLine items={item.summary} />
      <div className="ap-card__meta">
        <UserAvatar name={item.initiatorName ?? '—'} avatar={item.initiatorAvatar ?? undefined} size={18} semiSize="extra-extra-small" />
        <span>{item.initiatorName ?? '—'}</span>
        <span>·</span>
        <span>{item.definitionName ?? '—'}</span>
        <span>·</span>
        <span>{tab === 'handled' && item.myActionAt ? formatDateTime(item.myActionAt) : formatDateTime(item.createdAt)}</span>
      </div>
      {tab === 'pending' && (
        <div className="ap-card__footer">
          <WorkflowSLATag level={item.slaLevel} overdueSec={item.slaOverdueSec} deadline={item.slaDeadline} />
          <span style={{ flex: 1 }} />
          {canQuick && (
            <Button
              size="small"
              theme="light"
              type="primary"
              icon={<Check size={13} />}
              loading={quickApproving}
              onClick={(e) => { e.stopPropagation(); onQuickApprove(); }}
            >
              极速同意
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TaskListPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<ApprovalTab>('pending');
  const [size, setSize] = useState(10);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const listQuery = useApprovalList(tab, size, keyword);
  const countsQuery = useApprovalCounts();
  const markCcRead = useMarkCcRead();
  const quickAction = useTaskAction();
  const [quickTaskId, setQuickTaskId] = useState<number | null>(null);

  const data = listQuery.data;
  const list = data?.list ?? [];
  const total = data?.total ?? 0;
  const hasMore = list.length < total;

  const refetch = useCallback(async () => {
    await Promise.all([listQuery.refetch(), countsQuery.refetch()]);
  }, [listQuery, countsQuery]);
  const { scrollRef, pull, refreshing } = usePullRefresh(refetch);
  const sentinelRef = useInfiniteSentinel(hasMore, listQuery.isFetching, () => setSize((s) => s + 10));

  const switchTab = (k: ApprovalTab) => {
    setTab(k);
    setSize(10);
    setKeywordDraft('');
    setKeyword('');
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    Toast.info('已退出移动审批');
    navigate('/login', { replace: true });
  };

  const openItem = (item: ApprovalListItem) => {
    if (tab === 'cc' && item.ccTaskId != null && !item.ccReadAt) {
      markCcRead.mutate(item.ccTaskId);
    }
    if (tab === 'pending' && item.pendingTaskId) {
      navigate(`/detail/${item.id}/${item.pendingTaskId}`);
    } else {
      navigate(`/detail/${item.id}`);
    }
  };

  const quickApprove = (item: ApprovalListItem) => {
    const pendingTaskId = item.pendingTaskId;
    if (!pendingTaskId) return;
    Modal.confirm({
      title: '极速同意',
      content: `确认同意「${item.title}」？`,
      okText: '同意',
      onOk: async () => {
        setQuickTaskId(pendingTaskId);
        try {
          await quickAction.mutateAsync({ taskId: pendingTaskId, action: 'approve', body: { comment: '' } });
          const rest = Math.max(0, (countsQuery.data?.pending ?? total) - 1);
          Toast.success(rest > 0 ? `已同意，还剩 ${rest} 条待办` : '已同意，待办清零 🎉');
        } catch (err) {
          // 意见必填 / 必传附件 / 下游选人等场景由服务端拦截，引导进详情处理
          const msg = err instanceof Error ? err.message : '';
          Toast.info(msg ? `${msg}，请进入详情处理` : '请进入详情处理');
          navigate(`/detail/${item.id}/${pendingTaskId}`);
        } finally {
          setQuickTaskId(null);
        }
      },
    });
  };

  const tabCounts: Partial<Record<ApprovalTab, number | undefined>> = {
    pending: countsQuery.data?.pending,
    cc: countsQuery.data?.ccUnread,
  };

  return (
    <div className="ap-page">
      <div className="ap-header">
        <span className="ap-header__title">移动审批</span>
        <Button
          theme="borderless"
          icon={<RefreshCw size={16} />}
          loading={listQuery.isFetching && !refreshing}
          onClick={() => void refetch()}
          aria-label="刷新"
        />
        <Button theme="solid" type="primary" size="small" icon={<Plus size={14} />} onClick={() => navigate('/launch')}>
          发起
        </Button>
        <Button theme="borderless" icon={<LogOut size={16} />} onClick={logout} aria-label="退出" />
      </div>
      <div className="ap-search">
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索标题 / 流程名称"
          value={keywordDraft}
          onChange={setKeywordDraft}
          onEnterPress={() => { setKeyword(keywordDraft.trim()); setSize(10); }}
          onClear={() => { setKeywordDraft(''); setKeyword(''); setSize(10); }}
          showClear
        />
      </div>
      <div className="ap-body" ref={scrollRef}>
        {(pull > 0 || refreshing) && (
          <div className="ap-pull-indicator" style={{ height: pull }}>
            {refreshing ? <Spin size="small" /> : <span>{pull >= 56 ? '松开刷新' : '下拉刷新'}</span>}
          </div>
        )}
        {list.map((item) => (
          <TaskCard
            key={`${item.id}-${item.pendingTaskId ?? item.ccTaskId ?? 0}`}
            item={item}
            tab={tab}
            onOpen={() => openItem(item)}
            onQuickApprove={tab === 'pending' ? () => quickApprove(item) : undefined}
            quickApproving={quickTaskId === item.pendingTaskId && quickAction.isPending}
          />
        ))}
        {!listQuery.isFetching && list.length === 0 && (
          <div className="ap-empty">{keyword ? '没有匹配的结果' : EMPTY_TEXT[tab]}</div>
        )}
        {hasMore && (
          <div ref={sentinelRef} className="ap-load-sentinel">
            <Spin size="small" />
            <span>加载中…</span>
          </div>
        )}
        {!hasMore && list.length > 0 && (
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', textAlign: 'center', margin: '8px 0' }}>
            共 {total} 条 · 已全部加载
          </Typography.Text>
        )}
      </div>
      <nav className="ap-tabbar" role="tablist" aria-label="审批分类">
        {TAB_ITEMS.map(({ key, label, icon: Icon }) => {
          const count = tabCounts[key] ?? 0;
          const active = tab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              className={`ap-tabbar__item${active ? ' ap-tabbar__item--active' : ''}`}
              onClick={() => switchTab(key)}
            >
              <span className="ap-tabbar__icon">
                <Icon size={22} strokeWidth={active ? 2.1 : 1.7} />
                {count > 0 && <span className="ap-tabbar__badge">{count > 99 ? '99+' : count}</span>}
              </span>
              <span className="ap-tabbar__label">{label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
