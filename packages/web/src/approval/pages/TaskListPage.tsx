import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, Button, Checkbox, Modal, Select, SideSheet, Spin, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import { BarChart2, Bell, Check, CheckCheck, CircleCheckBig, ClipboardCheck, FilePlus2, ListChecks, LogOut, Plus, Send, UserRoundCog, type LucideIcon } from 'lucide-react';
import { type SignatureInput } from '@zenith/shared/core';
import { authContract } from '@zenith/shared/identity';
import { api } from '@/lib/contract-query';
import { clearApprovalSession } from '../lib/session';
import { canViewApprovalStatistics } from '../lib/statistics';
import { ApiError } from '@/lib/query';
import type { WorkflowBatchActionResponse, WorkflowInstancePriority } from '@zenith/shared/workflow';
import type { InAppMessage } from '@zenith/shared/messaging';
import { SignatureClientProvider } from '@/components/signature/SignatureClientContext';
import WorkflowBatchResults from '@/components/workflow/WorkflowBatchResults';
import { approvalRequest } from '../lib/approval-request';
import { formatDateTime } from '@/utils/date';
import { UserAvatar } from '@/components/UserAvatar';
import WorkflowSummaryLine from '@/components/workflow/WorkflowSummaryLine';
import WorkflowSLATag from '@/components/workflow/WorkflowSLATag';
import WorkflowPriorityTag from '@/components/workflow/WorkflowPriorityTag';
import WorkflowHandledTaskTag from '@/components/workflow/WorkflowHandledTaskTag';
import {
  useApprovalCounts, useApprovalDefinitionOptions, useApprovalDelegations, useApprovalList, useApprovalMe, useApprovalNotificationUnreadCount, useApprovalNotifications, useApprovalUsers, useBatchApprove, useCreateApprovalDelegation, useDeleteApprovalDelegation, useMarkApprovalNotificationRead, useMarkCcRead, useTaskAction,
  type ApprovalListItem, type ApprovalTab,
} from '../lib/queries';
import { useInfiniteSentinel, usePullRefresh } from '../lib/usePullRefresh';
import { INSTANCE_STATUS_MAP as STATUS_MAP } from '@/components/workflow/workflow-runtime';
import { KeywordInput } from '@/components/search-filters';

const SignatureField = lazy(() => import('@/components/signature/SignatureField'));

const EMPTY_TEXT: Record<ApprovalTab, string> = {
  pending: '没有待办，休息一下 🎉',
  handled: '暂无已办记录',
  mine: '还没有发起过申请',
  cc: '暂无抄送',
};

type ApprovalFilters = {
  definitionId: number | null;
  priority: WorkflowInstancePriority | null;
  overdue: boolean;
};
type ApplicationStatus = 'draft' | 'returned' | 'running' | 'approved' | 'rejected' | 'withdrawn';

const EMPTY_FILTERS: ApprovalFilters = { definitionId: null, priority: null, overdue: false };

/** 将管理后台工作流通知深链转换为移动审批路由；其它业务通知留在通知面板中。 */
function mobileApprovalLink(link: string | null): string | null {
  if (!link) return null;
  const [path, query = ''] = link.split('?', 2);
  if (!['/workflow/applications', '/workflow/pending', '/workflow/cc'].includes(path)) return null;
  const params = new URLSearchParams(query);
  const instanceId = Number(params.get('instanceId'));
  if (!Number.isFinite(instanceId) || instanceId <= 0) return null;
  const taskId = Number(params.get('taskId'));
  return path === '/workflow/pending' && Number.isFinite(taskId) && taskId > 0
    ? `/detail/${instanceId}/${taskId}`
    : `/detail/${instanceId}`;
}

/** 底部标签栏（主流 App TabBar）：图标 + 文字 + 角标，中间为凸起「发起」按钮 */
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
  batchMode?: boolean;
  checked?: boolean;
}

/** 现场手写、下游自选和必填附件逐条处理；个人签名可显式确认后批量使用。 */
function isBatchable(item: ApprovalListItem): boolean {
  return item.canBatchApprove === true && item.pendingTaskId != null;
}

/** 列表快捷同意没有签名确认步骤，只适用于无需签名的节点。 */
function isQuickable(item: ApprovalListItem): boolean {
  return item.canQuickApprove === true && isBatchable(item);
}

function TaskCard({ item, tab, onOpen, onQuickApprove, quickApproving, batchMode, checked }: Readonly<CardProps>) {
  const status = STATUS_MAP[item.status];
  const handledTask = tab === 'handled' ? item.handledTask : undefined;
  const ccUnread = tab === 'cc' && item.ccTaskId != null && !item.ccReadAt;
  const quickable = tab === 'pending' && isQuickable(item);
  const batchable = tab === 'pending' && isBatchable(item);
  // 列表快捷同意：无需签名/加签选人时展示（意见必填等由服务端校验兜底，失败引导进详情）
  const canQuick = quickable && onQuickApprove != null && !batchMode;
  const dim = batchMode && !batchable;
  // SLA 未配置时不占位；footer 只有在有实质内容（代办/时限/签名/快捷操作）时才渲染，避免空分割线。
  const hasSla = item.slaLevel != null && item.slaLevel !== 'none' && item.slaOverdueSec != null;
  const hasFooterContent = tab === 'pending' && (
    item.pendingDelegatedFromName != null || hasSla
    || item.pendingSignaturePolicy === 'reusable' || item.pendingSignaturePolicy === 'handwritten'
    || canQuick
  );

  return (
    <div
      className={`ap-card${checked ? ' ap-card--checked' : ''}${dim ? ' ap-card--dim' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${item.title}${item.pendingDelegatedFromName ? `，代${item.pendingDelegatedFromName}审批` : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
    >
      <div className="ap-card__title-row">
        {batchMode && batchable && <Checkbox checked={checked} className="ap-card__check" aria-label="选择" />}
        {ccUnread && <span className="ap-dot" aria-label="未读" />}
        <span className="ap-card__title">{item.title}</span>
        {(item.priority === 'high' || item.priority === 'urgent') && <WorkflowPriorityTag priority={item.priority} />}
        {handledTask
          ? <WorkflowHandledTaskTag task={handledTask} />
          : status && <Tag size="small" color={status.color} style={{ flexShrink: 0 }}>{status.text}</Tag>}
      </div>
      {handledTask && (
        <div className="ap-card__meta">{handledTask.nodeName} · 第 {handledTask.round} 轮{handledTask.decision?.targetNodeName ? ` · 退回至 ${handledTask.decision.targetNodeName}` : ''}</div>
      )}
      {tab === 'pending' && <div className="ap-card__meta">{item.pendingTaskNodeName} · {item.pendingTaskKind === 'suggestion' ? '待提交建议' : '待我处理'}</div>}
      <WorkflowSummaryLine items={item.summary} />
      <div className="ap-card__meta">
        <UserAvatar name={item.initiatorName ?? '—'} avatar={item.initiatorAvatar ?? undefined} size={18} semiSize="extra-extra-small" />
        <span>{item.initiatorName ?? '—'}</span>
        <span>·</span>
        <span>{item.definitionName ?? '—'}</span>
        <span>·</span>
        <span>{tab === 'handled' && item.myActionAt ? formatDateTime(item.myActionAt) : formatDateTime(item.createdAt)}</span>
      </div>
      {hasFooterContent && (
        <div className="ap-card__footer">
          {item.pendingDelegatedFromName && (
            <Tag size="small" color={item.pendingDelegationMode === 'suggest' ? 'orange' : 'violet'}>
              {item.pendingDelegationMode === 'suggest' ? `建议代${item.pendingDelegatedFromName}审批` : `代${item.pendingDelegatedFromName}审批`}
            </Tag>
          )}
          <WorkflowSLATag level={item.slaLevel} overdueSec={item.slaOverdueSec} deadline={item.slaDeadline} />
          {item.pendingSignaturePolicy === 'reusable' && <Tag size="small" color="blue">需签名</Tag>}
          {item.pendingSignaturePolicy === 'handwritten' && <Tag size="small" color="amber">需现场手写</Tag>}
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
              同意
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function TaskListPage() {
  return <SignatureClientProvider client={approvalRequest}><TaskListContent /></SignatureClientProvider>;
}

function TaskListContent() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const me = useApprovalMe();
  const can = (permission: string) => !!me.data?.permissions?.some(p => p === '*' || p === permission);
  const canHandle = can('workflow:task:handle');
  const canList = can('workflow:instance:list');
  const canCreate = can('workflow:instance:create');
  const [tab, setTab] = useState<ApprovalTab>(() => { const value = searchParams.get('tab'); return value && ['pending', 'handled', 'mine', 'cc'].includes(value) ? value as ApprovalTab : canHandle ? 'pending' : 'mine'; });
  const [size, setSize] = useState(10);
  const [keywordDraft, setKeywordDraft] = useState(() => searchParams.get('keyword') ?? '');
  const [keyword, setKeyword] = useState(() => searchParams.get('keyword') ?? '');
  const countsQuery = useApprovalCounts();
  const markCcRead = useMarkCcRead();
  const quickAction = useTaskAction();
  const [quickTaskId, setQuickTaskId] = useState<number | null>(null);
  // 批量审批模式（对标钉钉批量同意）：勾选集合为 pendingTaskId
  const [batchMode, setBatchMode] = useState(false);
  const [checkedIds, setCheckedIds] = useState<Set<number>>(new Set());
  const batchApprove = useBatchApprove();
  const batchSubmitting = batchApprove.isPending;
  const [batchConfirm, setBatchConfirm] = useState<'approve' | 'signedApprove' | null>(null);
  const [batchComment, setBatchComment] = useState('');
  const [batchSignature, setBatchSignature] = useState<SignatureInput | null>(null);
  const [batchResult, setBatchResult] = useState<{ result: WorkflowBatchActionResponse; titles: Record<number, string>; instances: Record<number, number> } | null>(null);
  const [ccReadingAll, setCcReadingAll] = useState(false);
  const [filters, setFilters] = useState<ApprovalFilters>(() => ({ definitionId: Number(searchParams.get('definitionId')) || null, priority: searchParams.get('priority') as ApprovalFilters['priority'], overdue: searchParams.get('overdue') === 'true' }));
  const [instanceStatus, setInstanceStatus] = useState<ApplicationStatus | undefined>(() => (searchParams.get('status') || undefined) as ApplicationStatus | undefined);
  const tabAllowed = tab === 'pending' || tab === 'handled' ? canHandle : canList || (tab === 'mine' && instanceStatus === 'draft' && canCreate);
  useEffect(() => { if (!canHandle && !canList && canCreate && instanceStatus !== 'draft') navigate('/launch', { replace: true }); }, [canHandle, canList, canCreate, instanceStatus, navigate]);
  const listQuery = useApprovalList(tab, size, keyword, tabAllowed || (tab === 'mine' && instanceStatus === 'draft' && canCreate), { ...filters, status: instanceStatus });
  const definitionsQuery = useApprovalDefinitionOptions(canHandle, canCreate);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [notificationsVisible, setNotificationsVisible] = useState(false);
  const [delegationsVisible, setDelegationsVisible] = useState(false);
  const [delegationTarget, setDelegationTarget] = useState<number | undefined>();
  const [delegationMode, setDelegationMode] = useState<'full' | 'suggest'>('full');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [unreadRetry, setUnreadRetry] = useState<number[]>([]);
  const notificationsQuery = useApprovalNotifications(notificationsVisible);
  const notificationUnreadQuery = useApprovalNotificationUnreadCount();
  const markNotificationRead = useMarkApprovalNotificationRead();
  const delegationsQuery = useApprovalDelegations(delegationsVisible);
  const delegationUsersQuery = useApprovalUsers(delegationsVisible);
  const createDelegation = useCreateApprovalDelegation();
  const deleteDelegation = useDeleteApprovalDelegation();

  useEffect(() => {
    const setOnlineState = () => setOnline(navigator.onLine);
    window.addEventListener('online', setOnlineState);
    window.addEventListener('offline', setOnlineState);
    return () => {
      window.removeEventListener('online', setOnlineState);
      window.removeEventListener('offline', setOnlineState);
    };
  }, []);

  const data = listQuery.data;
  const list = useMemo(() => data?.list ?? [], [data?.list]);
  const total = data?.total ?? 0;
  const filteredList = list;
  const filtersActive = filters.definitionId != null || filters.priority != null || filters.overdue;
  const displayTotal = total;
  const hasMore = listQuery.hasNextPage;
  const definitionOptions = useMemo(
    () => (definitionsQuery.data ?? []).map(d => ({ value: d.id, label: d.name })),
    [definitionsQuery.data],
  );

  const refetch = useCallback(async () => {
    await Promise.all([listQuery.refetch(), countsQuery.refetch()]);
  }, [listQuery, countsQuery]);
  const { scrollRef, pull, refreshing } = usePullRefresh(refetch);
  const restoredScroll = useRef(false);
  useEffect(() => {
    restoredScroll.current = false;
  }, [tab, keyword, instanceStatus, filters]);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const storageKey = `approval-scroll:${me.data?.id}:${tab}:${keyword}:${instanceStatus ?? ''}:${JSON.stringify(filters)}`;
    if (!restoredScroll.current && list.length) { element.scrollTop = Number(sessionStorage.getItem(storageKey)) || 0; restoredScroll.current = true; }
    const save = () => sessionStorage.setItem(storageKey, String(element.scrollTop));
    element.addEventListener('scroll', save, { passive: true });
    return () => element.removeEventListener('scroll', save);
  }, [scrollRef, me.data?.id, tab, keyword, instanceStatus, filters, list.length]);
  useEffect(() => {
    const params = new URLSearchParams({ tab });
    if (keyword) params.set('keyword', keyword);
    if (instanceStatus) params.set('status', instanceStatus);
    if (filters.definitionId) params.set('definitionId', String(filters.definitionId));
    if (filters.priority) params.set('priority', filters.priority);
    if (filters.overdue) params.set('overdue', 'true');
    setSearchParams(params, { replace: true });
  }, [tab, keyword, instanceStatus, filters, setSearchParams]);
  const sentinelRef = useInfiniteSentinel(hasMore, listQuery.isFetching, () => { void listQuery.fetchNextPage(); });

  const switchTab = (k: ApprovalTab) => {
    setTab(k);
    setInstanceStatus(undefined);
    setSearchParams({ tab: k }, { replace: true });
    setSize(10);
    setKeywordDraft('');
    setKeyword('');
    setFilters(EMPTY_FILTERS);
    setFiltersVisible(false);
    setBatchMode(false);
    setCheckedIds(new Set());
  };

  const logout = async () => {
    try { await api(authContract.logout, { client: approvalRequest, silent: true, skipAuth: true }); }
    finally { clearApprovalSession(); navigate('/login', { replace: true }); }
  };

  const openItem = (item: ApprovalListItem) => {
    if (batchMode) {
      if (!isBatchable(item)) {
        Toast.info('该条需现场手写、上传附件或选择下一审批人，请进入详情逐条处理');
        return;
      }
      const id = item.pendingTaskId;
      if (id == null) return;
      setCheckedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
      return;
    }
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
      title: '同意',
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
    pending: countsQuery.data?.pending ?? undefined,
    cc: countsQuery.data?.ccUnread ?? undefined,
  };

  // 批量审批：可勾选集合 / 全选 / 提交 / 退出
  const batchableIds = tab === 'pending'
    ? filteredList.filter(isBatchable).map((i) => i.pendingTaskId as number)
    : [];
  const selectedSignatureCount = filteredList.filter((item) => item.pendingTaskId != null && checkedIds.has(item.pendingTaskId) && item.pendingSignaturePolicy === 'reusable').length;
  const allChecked = batchableIds.length > 0 && batchableIds.every((id) => checkedIds.has(id));
  const toggleAll = () => {
    setCheckedIds(allChecked ? new Set() : new Set(batchableIds));
  };
  const exitBatch = () => {
    setBatchMode(false);
    setCheckedIds(new Set());
    setBatchConfirm(null);
    setBatchSignature(null);
  };
  const openBatchConfirm = () => {
    setBatchSignature(null);
    setBatchComment('');
    setBatchConfirm(selectedSignatureCount > 0 ? 'signedApprove' : 'approve');
  };
  const submitBatch = async () => {
    const ids = [...checkedIds];
    if (ids.length === 0 || batchSubmitting || !batchConfirm) return;
    if (batchConfirm === 'signedApprove' && batchSignature?.source !== 'saved') { Toast.warning('请确认本次使用的个人签名'); return; }
    try {
      const result = await batchApprove.mutateAsync({
        taskIds: ids, comment: batchComment.trim() || undefined,
        signature: batchConfirm === 'signedApprove' && batchSignature?.source === 'saved' ? batchSignature : undefined,
      });
      const selected = filteredList.filter((item) => item.pendingTaskId != null && checkedIds.has(item.pendingTaskId));
      setBatchResult({ result,
        titles: Object.fromEntries(selected.map((item) => [item.pendingTaskId!, item.title])),
        instances: Object.fromEntries(selected.map((item) => [item.pendingTaskId!, item.id])),
      });
      exitBatch();
    } catch { /* 请求层提示失败；保留勾选和签名，允许重新确认。 */ }
  };

  // 抄送一键已读：标记当前已加载列表中的未读项
  const markAllCcRead = async () => {
    const unread = filteredList.filter((i) => i.ccTaskId != null && !i.ccReadAt);
    if (unread.length === 0) return;
    setCcReadingAll(true);
    const results = await Promise.allSettled(unread.map((i) => markCcRead.mutateAsync(i.ccTaskId as number)));
    setCcReadingAll(false);
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed) Toast.warning(`已处理 ${results.length - failed} 条，${failed} 条失败，请重试`); else Toast.success('当前已加载的抄送已标记已读');
  };

  const openNotification = async (item: InAppMessage) => {
    setNotificationsVisible(false);
    const target = mobileApprovalLink(item.link);
    if (target) navigate(target);
    else Toast.info(item.link ? '请在管理后台打开该通知' : item.title);
    if (!item.isRead) {
      try { await markNotificationRead.mutateAsync(item.id); }
      catch (error) {
        if (error instanceof ApiError && error.code === 401) return;
        setUnreadRetry(ids => [...new Set([...ids, item.id])]);
        Toast.warning('未能标记消息已读，可在通知列表重试');
      }
    }
  };

  const saveDelegation = async () => {
    if (delegationTarget == null) {
      Toast.warning('请选择代理人');
      return;
    }
    try {
      await createDelegation.mutateAsync({ delegateId: delegationTarget, mode: delegationMode, enabled: true, definitionId: null, startAt: null, endAt: null, reason: null });
      setDelegationTarget(undefined);
      Toast.success('审批代理已保存');
    } catch { /* 请求层提示失败 */ }
  };

  return (
    <div className="ap-page">
      <div className="ap-header">
        <span className="ap-header__title">移动审批</span>
        {canViewApprovalStatistics(me.data?.permissions) && <Button theme="borderless" icon={<BarChart2 size={17} />} onClick={() => navigate('/statistics')} aria-label="审批统计" />}
        <Button
          theme="borderless"
          className="ap-header__notification"
          icon={<Bell size={17} />}
          onClick={() => setNotificationsVisible(true)}
          aria-label={`通知${(notificationUnreadQuery.data?.count ?? 0) > 0 ? `，${notificationUnreadQuery.data?.count} 条未读` : ''}`}
        >
          {(notificationUnreadQuery.data?.count ?? 0) > 0 && (
            <span className="ap-header__notification-badge" aria-hidden="true">
              {(notificationUnreadQuery.data?.count ?? 0) > 99 ? '99+' : notificationUnreadQuery.data?.count}
            </span>
          )}
        </Button>
        <Button
          theme="borderless"
          icon={<UserRoundCog size={17} />}
          onClick={() => setDelegationsVisible(true)}
          aria-label="审批代理"
        />
        <Button theme="borderless" icon={<LogOut size={16} />} onClick={() => void logout()} aria-label="退出" />
      </div>
      {!online && <Banner className="ap-offline-banner" type="warning" closeIcon={null} description="当前处于离线状态，网络恢复后可重试未完成操作。" />}
      {unreadRetry.length > 0 && <Banner type="warning" closeIcon={null} description={<>有 {unreadRetry.length} 条通知未能标记已读。<Button loading={markNotificationRead.isPending} onClick={() => { void Promise.allSettled(unreadRetry.map(id => markNotificationRead.mutateAsync(id).then(() => setUnreadRetry(ids => ids.filter(value => value !== id))))); }}>重试已读</Button></>} />}
      <div className="ap-workbench" aria-label="审批工作台概览">
        <button type="button" className="ap-workbench__item" onClick={() => switchTab('pending')}>
          <span>待办</span><strong>{countsQuery.data?.pending ?? '—'}</strong>
        </button>
        <button type="button" className="ap-workbench__item" onClick={() => { switchTab('mine'); setInstanceStatus('draft'); setSearchParams({ tab: 'mine', status: 'draft' }, { replace: true }); }}>
          <span>草稿</span><strong>{countsQuery.data?.drafts ?? '—'}</strong>
        </button>
        <button type="button" className="ap-workbench__item" onClick={() => switchTab('cc')}>
          <span>抄送未读</span><strong>{countsQuery.data?.ccUnread ?? '—'}</strong>
        </button>
      </div>
      <div className="ap-search">
        {tab === 'mine' && <Select value={instanceStatus} placeholder="全部状态" showClear style={{ minWidth: 90 }} optionList={[{ value: 'draft', label: '草稿' }, { value: 'returned', label: '已退回' }, { value: 'running', label: '审批中' }, { value: 'approved', label: '已通过' }, { value: 'rejected', label: '已拒绝' }, { value: 'withdrawn', label: '已撤回' }]} onChange={v => { setInstanceStatus(v as typeof instanceStatus); setSearchParams({ tab, ...(v ? { status: String(v) } : {}) }, { replace: true }); }} />}
        <KeywordInput
          placeholder="搜索标题 / 流程名称"
          width="100%"
          value={keywordDraft}
          onChange={setKeywordDraft}
          onSearch={() => { setKeyword(keywordDraft.trim()); setSize(10); }}
          onClear={() => { setKeywordDraft(''); setKeyword(''); setSize(10); }}
        />
        <Button theme="borderless" onClick={() => setFiltersVisible(true)}>
          筛选{filtersActive ? ' · 已选' : ''}
        </Button>
        {tab === 'pending' && !batchMode && batchableIds.length > 0 && (
          <Button theme="borderless" icon={<ListChecks size={15} />} onClick={() => setBatchMode(true)}>批量</Button>
        )}
        {tab === 'cc' && list.some((i) => i.ccTaskId != null && !i.ccReadAt) && (
          <Button theme="borderless" icon={<CheckCheck size={15} />} loading={ccReadingAll} onClick={() => void markAllCcRead()}>全部已读</Button>
        )}
      </div>
      {(filtersActive || keyword || instanceStatus) && <div className="ap-filter-summary" aria-label="已选筛选条件"><Typography.Text size="small">共 {total} 条</Typography.Text>{keyword && <Tag closable onClose={() => { setKeyword(''); setKeywordDraft(''); }}>搜索：{keyword}</Tag>}{filters.definitionId && <Tag closable onClose={() => setFilters(p => ({ ...p, definitionId: null }))}>{definitionOptions.find(d => d.value === filters.definitionId)?.label ?? '指定流程'}</Tag>}{filters.priority && <Tag closable onClose={() => setFilters(p => ({ ...p, priority: null }))}>优先级：{filters.priority === 'urgent' ? '紧急' : filters.priority === 'high' ? '高' : filters.priority === 'low' ? '低' : '普通'}</Tag>}{filters.overdue && <Tag closable onClose={() => setFilters(p => ({ ...p, overdue: false }))}>已逾期</Tag>}<Button size="small" theme="borderless" onClick={() => { setFilters(EMPTY_FILTERS); setKeyword(''); setKeywordDraft(''); setInstanceStatus(undefined); Toast.info('筛选已清除'); }}>清除筛选</Button></div>}
      <div className="ap-body" ref={scrollRef}>
        {(pull > 0 || refreshing) && (
          <div className="ap-pull-indicator" style={{ height: pull }}>
            {refreshing ? <Spin size="small" /> : <span>{pull >= 56 ? '松开刷新' : '下拉刷新'}</span>}
          </div>
        )}
        {listQuery.isError ? (
          <div className="ap-error" role="alert">
            <Typography.Text type="danger">{listQuery.error instanceof ApiError ? listQuery.error.message : '审批列表加载失败，请重试。'}</Typography.Text>
            <Button size="small" onClick={() => void refetch()}>重试</Button>
          </div>
        ) : filteredList.map((item) => (
          <TaskCard
            key={`${item.id}-${item.handledTask?.id ?? item.pendingTaskId ?? item.ccTaskId ?? 0}`}
            item={item}
            tab={tab}
            onOpen={() => openItem(item)}
            onQuickApprove={tab === 'pending' ? () => quickApprove(item) : undefined}
            quickApproving={quickTaskId === item.pendingTaskId && quickAction.isPending}
            batchMode={batchMode}
            checked={item.pendingTaskId != null && checkedIds.has(item.pendingTaskId)}
          />
        ))}
        {!tabAllowed && <div className="ap-empty">当前账号没有此列表权限{canCreate ? <Button onClick={() => navigate('/launch')}>发起申请</Button> : null}</div>}
        {tabAllowed && !listQuery.isError && !listQuery.isFetching && filteredList.length === 0 && (
          <div className="ap-empty">{keyword || filtersActive ? '没有匹配的结果' : EMPTY_TEXT[tab]}</div>
        )}
        {hasMore && (
          <div ref={sentinelRef} className="ap-load-sentinel">
            <Spin size="small" />
            <span>加载中…</span>
          </div>
        )}
        {!hasMore && filteredList.length > 0 && (
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', textAlign: 'center', margin: '8px 0' }}>
            共 {displayTotal} 条 · 已全部加载
          </Typography.Text>
        )}
      </div>
      {batchMode ? (
        <div className="ap-batchbar">
          <Checkbox checked={allChecked} onChange={toggleAll}>全选</Checkbox>
          <span className="ap-batchbar__count">
            {checkedIds.size > 0 ? `已选 ${checkedIds.size} 条` : `可批量同意 ${batchableIds.length} 条`}
          </span>
          <Button theme="light" onClick={exitBatch}>退出</Button>
          <Button
            theme="solid"
            type="primary"
            disabled={checkedIds.size === 0}
            loading={batchSubmitting}
            onClick={openBatchConfirm}
          >
            {selectedSignatureCount > 0 ? '签名同意' : '批量同意'}{checkedIds.size > 0 ? `（${checkedIds.size}）` : ''}
          </Button>
        </div>
      ) : (
        <nav className="ap-tabbar" role="tablist" aria-label="审批分类">
          {TAB_ITEMS.map(({ key, label, icon: Icon }, index) => {
            const count = tabCounts[key] ?? 0;
            const active = tab === key;
            const tabButton = (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                disabled={(key === 'pending' || key === 'handled') ? !canHandle : !canList}
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
            if (index !== 2) return tabButton;
            return [
              <button
                key="launch"
                type="button"
                className="ap-tabbar__item ap-tabbar__item--launch"
                onClick={() => navigate('/launch')}
                aria-label="发起申请"
                disabled={!canCreate}
              >
                <span className="ap-tabbar__launch"><Plus size={24} strokeWidth={2.4} /></span>
                <span className="ap-tabbar__label">发起</span>
              </button>,
              tabButton,
            ];
          })}
        </nav>
      )}
      <SideSheet placement="bottom" height="auto" title="筛选" visible={filtersVisible} onCancel={() => setFiltersVisible(false)} className="ap-sheet">
        <div className="ap-sheet__body">
          <Typography.Text type="secondary" size="small">流程</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 6, marginBottom: 14 }}
            placeholder="全部流程"
            value={filters.definitionId ?? undefined}
            showClear
            optionList={definitionOptions}
            onChange={(value) => setFilters((prev) => ({ ...prev, definitionId: typeof value === 'number' ? value : null }))}
          />
          <Typography.Text type="secondary" size="small">优先级</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 6, marginBottom: 14 }}
            placeholder="全部优先级"
            value={filters.priority ?? undefined}
            showClear
            optionList={[{ value: 'low', label: '低' }, { value: 'normal', label: '普通' }, { value: 'high', label: '高' }, { value: 'urgent', label: '加急' }]}
            onChange={(value) => setFilters((prev) => ({ ...prev, priority: typeof value === 'string' ? value as WorkflowInstancePriority : null }))}
          />
          {tab === 'pending' && (
            <Checkbox checked={filters.overdue} onChange={(event) => setFilters((prev) => ({ ...prev, overdue: Boolean(event.target?.checked) }))}>
              只看逾期待办
            </Checkbox>
          )}
          <div className="ap-sheet__actions">
            <Button block theme="light" onClick={() => setFilters(EMPTY_FILTERS)}>清除筛选</Button>
            <Button block theme="solid" type="primary" onClick={() => setFiltersVisible(false)}>完成</Button>
          </div>
        </div>
      </SideSheet>
      <SideSheet
        placement="bottom"
        height="75%"
        title={`通知${(notificationUnreadQuery.data?.count ?? 0) > 0 ? ` · ${notificationUnreadQuery.data?.count} 条未读` : ''}`}
        visible={notificationsVisible}
        onCancel={() => setNotificationsVisible(false)}
        className="ap-sheet"
      >
        <div className="ap-sheet__body ap-notifications">
          {notificationsQuery.isFetching && <Spin size="small" />}
          {!notificationsQuery.isFetching && (notificationsQuery.data?.list ?? []).length === 0 && (
            <div className="ap-empty">暂无通知</div>
          )}
          {(notificationsQuery.data?.list ?? []).map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ap-notification${item.isRead ? '' : ' ap-notification--unread'}`}
              onClick={() => void openNotification(item)}
            >
              <span className="ap-notification__title-row">
                {!item.isRead && <span className="ap-dot" aria-label="未读" />}
                <span className="ap-notification__title">{item.title}</span>
                {mobileApprovalLink(item.link) && <Tag size="small" color="blue">前往处理</Tag>}
              </span>
              <span className="ap-notification__content">{item.content}</span>
              <span className="ap-notification__meta">{item.senderName ?? '系统'} · {formatDateTime(item.createdAt)}</span>
            </button>
          ))}
        </div>
      </SideSheet>
      <SideSheet
        placement="bottom"
        height="75%"
        title="审批代理"
        visible={delegationsVisible}
        onCancel={() => setDelegationsVisible(false)}
        className="ap-sheet"
      >
        <div className="ap-sheet__body ap-delegations">
          <Typography.Text type="secondary" size="small">离岗或临时授权时，代理人可代你处理新进入的审批任务。</Typography.Text>
          <div className="ap-delegation-form">
            <Select
              placeholder="选择代理人"
              filter
              showClear
              value={delegationTarget}
              optionList={(delegationUsersQuery.data ?? []).map((u) => ({ value: u.id, label: u.nickname ?? u.username }))}
              onChange={(value) => setDelegationTarget(typeof value === 'number' ? value : undefined)}
              style={{ flex: 1, minWidth: 0 }}
            />
            <Select
              value={delegationMode}
              optionList={[{ value: 'full', label: '直接代批' }, { value: 'suggest', label: '建议制' }]}
              onChange={(value) => setDelegationMode(value === 'suggest' ? 'suggest' : 'full')}
              style={{ width: 112 }}
            />
          </div>
          <Button theme="solid" type="primary" block loading={createDelegation.isPending} onClick={() => void saveDelegation()}>保存代理</Button>
          <Typography.Text type="secondary" size="small" style={{ marginTop: 10 }}>当前规则</Typography.Text>
          {delegationsQuery.isFetching && <Spin size="small" />}
          {!delegationsQuery.isFetching && (delegationsQuery.data?.list ?? []).length === 0 && <div className="ap-empty">暂无审批代理</div>}
          {(delegationsQuery.data?.list ?? []).map((item) => (
            <div key={item.id} className="ap-delegation-row">
              <div>
                <Typography.Text strong>{item.delegateName ?? `用户#${item.delegateId}`}</Typography.Text>
                <div className="ap-notification__meta">{item.mode === 'suggest' ? '建议制' : '直接代批'} · {item.active ? '生效中' : item.enabled ? '未生效' : '已停用'}</div>
              </div>
              <Button theme="borderless" type="danger" size="small" loading={deleteDelegation.isPending} onClick={() => void deleteDelegation.mutateAsync(item.id)}>删除</Button>
            </div>
          ))}
        </div>
      </SideSheet>
      <SideSheet placement="bottom" height="auto" title={batchConfirm === 'signedApprove' ? '使用我的签名并批量同意' : '批量同意'}
        visible={batchConfirm !== null} onCancel={() => { if (!batchSubmitting) setBatchConfirm(null); }} className="ap-sheet">
        <div className="ap-sheet__body">
          <Typography.Paragraph>本次处理 {checkedIds.size} 条申请，逐条返回结果。</Typography.Paragraph>
          <TextArea value={batchComment} onChange={setBatchComment} placeholder="批量审批意见（可选）" maxCount={500} autosize={{ minRows: 2, maxRows: 4 }} />
          {batchConfirm === 'signedApprove' && <div style={{ marginTop: 12 }}>
            <Typography.Paragraph>其中 {selectedSignatureCount} 项使用以下个人签名，其余按节点规则同意。</Typography.Paragraph>
            <Suspense fallback={<Spin size="small" />}><SignatureField policy="reusable" savedOnly autoSelectSaved value={batchSignature} onChange={setBatchSignature} /></Suspense>
          </div>}
          <div className="ap-sheet__actions">
            <Button block disabled={batchSubmitting} onClick={() => setBatchConfirm(null)}>取消</Button>
            <Button block theme="solid" type="primary" loading={batchSubmitting}
              disabled={batchConfirm === 'signedApprove' && batchSignature?.source !== 'saved'} onClick={() => void submitBatch()}>
              {batchConfirm === 'signedApprove' ? '使用我的签名并批量同意' : '确认批量同意'}
            </Button>
          </div>
        </div>
      </SideSheet>
      <SideSheet placement="bottom" height="80%" title="批量审批结果" visible={batchResult !== null} onCancel={() => setBatchResult(null)}>
        {batchResult && <WorkflowBatchResults {...batchResult} onOpenTask={(taskId) => {
          const instanceId = batchResult.instances[taskId];
          if (instanceId) navigate(`/detail/${instanceId}/${taskId}`);
        }} />}
      </SideSheet>
    </div>
  );
}
