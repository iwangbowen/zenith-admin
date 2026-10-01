import { lazy, Suspense, useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Checkbox, Modal, SideSheet, Spin, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import { Check, CheckCheck, CircleCheckBig, ClipboardCheck, FilePlus2, ListChecks, LogOut, Plus, Send, type LucideIcon } from 'lucide-react';
import { TOKEN_KEY, REFRESH_TOKEN_KEY, type SignatureInput } from '@zenith/shared/core';
import type { WorkflowBatchActionResponse } from '@zenith/shared/workflow';
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
  useApprovalCounts, useApprovalList, useBatchApprove, useMarkCcRead, useTaskAction,
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
  return !item.requiresIndividual && item.pendingSignaturePolicy !== 'handwritten' && item.pendingTaskId != null;
}

/** 极速同意没有签名确认步骤，只适用于无需签名的节点。 */
function isQuickable(item: ApprovalListItem): boolean {
  return isBatchable(item) && (item.pendingSignaturePolicy ?? 'none') === 'none';
}

function TaskCard({ item, tab, onOpen, onQuickApprove, quickApproving, batchMode, checked }: Readonly<CardProps>) {
  const status = STATUS_MAP[item.status];
  const handledTask = tab === 'handled' ? item.handledTask : undefined;
  const ccUnread = tab === 'cc' && item.ccTaskId != null && !item.ccReadAt;
  const quickable = tab === 'pending' && isQuickable(item);
  const batchable = tab === 'pending' && isBatchable(item);
  // 极速同意：无需签名/加签选人时展示（意见必填等由服务端校验兜底，失败引导进详情）
  const canQuick = quickable && onQuickApprove != null && !batchMode;
  const dim = batchMode && !batchable;

  return (
    <div
      className={`ap-card${checked ? ' ap-card--checked' : ''}${dim ? ' ap-card--dim' : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
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
              极速同意
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
  const [tab, setTab] = useState<ApprovalTab>('pending');
  const [size, setSize] = useState(10);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const listQuery = useApprovalList(tab, size, keyword);
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
    setBatchMode(false);
    setCheckedIds(new Set());
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    Toast.info('已退出移动审批');
    navigate('/login', { replace: true });
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

  // 批量审批：可勾选集合 / 全选 / 提交 / 退出
  const batchableIds = tab === 'pending'
    ? list.filter(isBatchable).map((i) => i.pendingTaskId as number)
    : [];
  const selectedSignatureCount = list.filter((item) => item.pendingTaskId != null && checkedIds.has(item.pendingTaskId) && item.pendingSignaturePolicy === 'reusable').length;
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
      const selected = list.filter((item) => item.pendingTaskId != null && checkedIds.has(item.pendingTaskId));
      setBatchResult({ result,
        titles: Object.fromEntries(selected.map((item) => [item.pendingTaskId!, item.title])),
        instances: Object.fromEntries(selected.map((item) => [item.pendingTaskId!, item.id])),
      });
      exitBatch();
    } catch { /* 请求层提示失败；保留勾选和签名，允许重新确认。 */ }
  };

  // 抄送一键已读：标记当前已加载列表中的未读项
  const markAllCcRead = async () => {
    const unread = list.filter((i) => i.ccTaskId != null && !i.ccReadAt);
    if (unread.length === 0) return;
    setCcReadingAll(true);
    await Promise.allSettled(unread.map((i) => markCcRead.mutateAsync(i.ccTaskId as number)));
    setCcReadingAll(false);
    Toast.success('已全部标记为已读');
  };

  return (
    <div className="ap-page">
      <div className="ap-header">
        <span className="ap-header__title">移动审批</span>
        <Button theme="borderless" icon={<LogOut size={16} />} onClick={logout} aria-label="退出" />
      </div>
      <div className="ap-search">
        <KeywordInput
          placeholder="搜索标题 / 流程名称"
          width="100%"
          value={keywordDraft}
          onChange={setKeywordDraft}
          onSearch={() => { setKeyword(keywordDraft.trim()); setSize(10); }}
          onClear={() => { setKeywordDraft(''); setKeyword(''); setSize(10); }}
        />
        {tab === 'pending' && !batchMode && batchableIds.length > 0 && (
          <Button theme="borderless" icon={<ListChecks size={15} />} onClick={() => setBatchMode(true)}>批量</Button>
        )}
        {tab === 'cc' && list.some((i) => i.ccTaskId != null && !i.ccReadAt) && (
          <Button theme="borderless" icon={<CheckCheck size={15} />} loading={ccReadingAll} onClick={() => void markAllCcRead()}>全部已读</Button>
        )}
      </div>
      <div className="ap-body" ref={scrollRef}>
        {(pull > 0 || refreshing) && (
          <div className="ap-pull-indicator" style={{ height: pull }}>
            {refreshing ? <Spin size="small" /> : <span>{pull >= 56 ? '松开刷新' : '下拉刷新'}</span>}
          </div>
        )}
        {list.map((item) => (
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
              >
                <span className="ap-tabbar__launch"><Plus size={24} strokeWidth={2.4} /></span>
                <span className="ap-tabbar__label">发起</span>
              </button>,
              tabButton,
            ];
          })}
        </nav>
      )}
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
