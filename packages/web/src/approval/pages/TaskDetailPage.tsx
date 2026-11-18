import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Avatar, Banner, Button, Dropdown, Empty, Form, Popconfirm, Select, SideSheet, Skeleton, Spin, Tag, TextArea, Toast, Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { BellRing, ChevronLeft, MoreHorizontal, Reply, RotateCcw, Send, Share2, X } from 'lucide-react';
import type { WorkflowActionButtonConfig, WorkflowActionButtonKey, WorkflowFieldPermission, WorkflowTask } from '@zenith/shared/workflow';
import { applyFieldPermissionsToFields, hasEditableFieldPermission, isWorkflowBaseApprovalTask, resolveWorkflowActionButton, WORKFLOW_RETURN_TO_INITIATOR_KEY, workflowAttachmentContract } from '@zenith/shared/workflow';
import { formatDateTime } from '@/utils/date';
import { downloadBlob } from '@/utils/download';
import { urlOf } from '@/lib/contract-query';
import ApprovalTimeline from '@/components/ApprovalTimeline';
import FileAttachment, { type AttachmentItem } from '@/components/FileAttachment';
import { workflowFileToAttachment } from '@/components/FileAttachment/utils';
import type { SignatureInput } from '@zenith/shared/core';
import { SignatureClientProvider } from '@/components/signature/SignatureClientContext';
import { approvalRequest } from '../lib/approval-request';
import { UserAvatar } from '@/components/UserAvatar';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import BusinessFormHost, { type WorkflowBusinessFormApi } from '@/components/workflow/BusinessFormHost';
import WorkflowPriorityTag from '@/components/workflow/WorkflowPriorityTag';
import { linearizeApprovalNodes } from '@/components/workflow/workflow-runtime';
import {
  resolveWorkflowCustomForm,
  resolveWorkflowDetailDefinition,
  resolveWorkflowFlowData,
  resolveWorkflowFormFields,
  resolveWorkflowFormType,
} from '@/utils/workflow-snapshot';
import ApproverPickerField from '../components/ApproverPicker';
import MobileWorkflowGraph from '../components/MobileWorkflowGraph';
import {
  fetchApprovalPrintPdf,
  fetchNextPendingTask, approvalKeys,
  useAddApprovalComment, useApprovalDetail, useApprovalMe, useApprovalQuickPhrases, useApprovalUsers,
  useApprovalCollaboration, useDeleteApprovalInstance, useResubmitApprovalInstance, useSelectableNextApprovers, useTaskAction, useUrgeInstance, useWithdrawInstance,
  type ApprovalTaskActionVariables,
} from '../lib/queries';
import { INSTANCE_STATUS_MAP as STATUS_MAP } from '@/components/workflow/workflow-runtime';

type ActionKind = 'approve' | 'reject' | 'transfer' | 'delegate' | 'addSign' | 'return' | null;
const SignatureField = lazy(() => import('@/components/signature/SignatureField'));

/** 移动审批端按钮默认值同样取 shared 唯一事实源（与审批面板 / 设计器 / 服务端一致） */
function resolveBtn(
  cfg: Partial<Record<string, WorkflowActionButtonConfig>> | null | undefined,
  key: 'approve' | 'reject' | 'transfer' | 'delegate' | 'addSign' | 'return',
): WorkflowActionButtonConfig {
  return resolveWorkflowActionButton(cfg as Partial<Record<WorkflowActionButtonKey, WorkflowActionButtonConfig>>, key);
}

/** 详情页头部骨架（返回键常驻，避免加载时无法退出） */
function PageShell({ title, tag, actions, children }: Readonly<{ title: string; tag?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }>) {
  const navigate = useNavigate();
  return (
    <div className="ap-page">
      <div className="ap-header">
        <Button theme="borderless" icon={<ChevronLeft size={18} />} onClick={() => navigate(-1)} aria-label="返回" />
        <span className="ap-header__title">{title}</span>
        {tag}
        {actions}
      </div>
      {children}
    </div>
  );
}

/** 分享审批单 PDF：支持 Web Share 的移动浏览器直接系统分享，否则退化为保存文件 */
function SharePrintButton({ instanceId, title }: Readonly<{ instanceId: number; title: string }>) {
  const [loading, setLoading] = useState(false);
  const share = async () => {
    setLoading(true);
    try {
      const { blob, filename } = await fetchApprovalPrintPdf(instanceId);
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
      } else {
        downloadBlob(blob, filename);
      }
    } catch (err) {
      // 用户取消系统分享面板不是错误
      if (err instanceof DOMException && err.name === 'AbortError') return;
      Toast.error(err instanceof Error ? err.message : '审批单生成失败');
    } finally {
      setLoading(false);
    }
  };
  return <Button theme="borderless" icon={<Share2 size={18} />} loading={loading} onClick={() => void share()} aria-label="分享审批单 PDF" />;
}

export default function TaskDetailPage() {
  return <SignatureClientProvider client={approvalRequest}><TaskDetailContent /></SignatureClientProvider>;
}

function TaskDetailContent() {
  const navigate = useNavigate();
  const params = useParams<{ instanceId: string; taskId?: string }>();
  const instanceId = Number(params.instanceId);
  const requestedTaskId = params.taskId ? Number(params.taskId) : null;
  const queryClient = useQueryClient();

  const detailQuery = useApprovalDetail(Number.isFinite(instanceId) ? instanceId : null);
  const meQuery = useApprovalMe();
  const actionMutation = useTaskAction();
  const withdrawMutation = useWithdrawInstance();
  const deleteMutation = useDeleteApprovalInstance();
  const resubmitMutation = useResubmitApprovalInstance();
  const urgeMutation = useUrgeInstance();
  const commentMutation = useAddApprovalComment();
  const collaboration = useApprovalCollaboration();
  const [collaborationAction, setCollaborationAction] = useState<'consult' | 'forward' | null>(null);
  const [collaborationUsers, setCollaborationUsers] = useState<number[]>([]);
  const [collaborationNote, setCollaborationNote] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [actionAttachments, setActionAttachments] = useState<AttachmentItem[]>([]);
  const [signPosition, setSignPosition] = useState<'before' | 'after' | 'parallel'>('after');
  const [signMode, setSignMode] = useState<'and' | 'or'>('and');
  const [returnTargets, setReturnTargets] = useState<string[]>([]);
  const detail = detailQuery.data ?? null;
  const me = meQuery.data ?? null;
  const myPendingTasks = (detail?.tasks ?? []).filter(t => t.status === 'pending' && t.assigneeId === me?.id && detail?.status === 'running');
  const taskId = requestedTaskId ?? (myPendingTasks.length === 1 ? myPendingTasks[0].id : null);

  const [action, setAction] = useState<ActionKind>(null);
  const [signature, setSignature] = useState<SignatureInput | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [replyTo, setReplyTo] = useState<{ id: number; userName?: string | null; content: string } | null>(null);
  const [commentMentions, setCommentMentions] = useState<number[]>([]);
  const [commentAttachments, setCommentAttachments] = useState<AttachmentItem[]>([]);
  // 下一节点自选审批人：nodeKey -> userIds；转办接收人（单选）
  const [selectedNext, setSelectedNext] = useState<Record<string, number[]>>({});
  const [highlightNextMissing, setHighlightNextMissing] = useState(false);
  const [transferTarget, setTransferTarget] = useState<number[]>([]);
  const [delegateTarget, setDelegateTarget] = useState<number[]>([]);
  const [addSignTargets, setAddSignTargets] = useState<number[]>([]);
  const [online, setOnline] = useState(() => navigator.onLine);
  const actionFormApi = useRef<FormApi | null>(null);
  const detailFormApi = useRef<FormApi | null>(null);
  const businessActionFormApi = useRef<WorkflowBusinessFormApi | null>(null);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener('online', updateOnline);
    window.addEventListener('offline', updateOnline);
    return () => {
      window.removeEventListener('online', updateOnline);
      window.removeEventListener('offline', updateOnline);
    };
  }, []);

  // 连续审批跳转到下一条时复用组件实例，需重置操作状态
  useEffect(() => {
    setAction(null);
    setSignature(null);
    setCommentDraft('');
    setReplyTo(null);
    setCommentMentions([]);
    setCommentAttachments([]);
    setSelectedNext({});
    setHighlightNextMissing(false);
    setTransferTarget([]);
    setDelegateTarget([]);
    setAddSignTargets([]);
  }, [instanceId, taskId]);

  const phrasesQuery = useApprovalQuickPhrases(action === 'approve' || action === 'reject');

  const def = useMemo(() => resolveWorkflowDetailDefinition(detail), [detail]);
  const businessForm = resolveWorkflowCustomForm(detail, def);
  const formType = useMemo(() => resolveWorkflowFormType(detail, def), [detail, def]);
  const formFields = useMemo(() => resolveWorkflowFormFields(detail, def), [detail, def]);
  const flowData = useMemo(() => resolveWorkflowFlowData(detail, def), [detail, def]);

  const currentTask: WorkflowTask | null = useMemo(
    () => (taskId != null ? detail?.tasks?.find((t) => t.id === taskId) ?? null : null),
    [detail, taskId],
  );
  const actionable = currentTask?.status === 'pending' && me != null && currentTask.assigneeId === me.id
    && detail?.status === 'running';
  const isInitiator = me != null && detail?.initiatorId === me.id;
  const initiatorActionable = !actionable && isInitiator && detail?.status === 'running';

  // 下游「自选下一审批人」节点（有则同意时必选）；转办候选用户
  const nextApproversQuery = useSelectableNextApprovers(taskId, actionable);
  const nextGroups = useMemo(() => nextApproversQuery.data ?? [], [nextApproversQuery.data]);
  // 候选被服务端限量截断的组：抽屉里的搜索词按组远程检索，不把整个组织拉到手机上
  const [nextSearch, setNextSearch] = useState<{ nodeKey: string; keyword: string } | null>(null);
  const nextSearchQuery = useSelectableNextApprovers(taskId, actionable && !!nextSearch, nextSearch ?? undefined);
  const searchedCandidates = (nodeKey: string) => (nextSearch?.nodeKey === nodeKey
    ? nextSearchQuery.data?.find((g) => g.nodeKey === nodeKey)?.selectableApprovers ?? []
    : null);
  const usersQuery = useApprovalUsers(action === 'transfer' || action === 'delegate' || action === 'addSign' || collaborationAction != null || currentTask?.delegatedFromId != null);
  const transferCandidates = useMemo(
    () => (usersQuery.data ?? [])
      .filter((u) => u.id !== me?.id)
      .map((u) => ({ id: u.id, name: u.nickname || u.username })),
    [usersQuery.data, me],
  );
  const delegatedFromName = useMemo(() => {
    if (!currentTask?.delegatedFromId) return null;
    return usersQuery.data?.find((u) => u.id === currentTask.delegatedFromId)?.nickname
      ?? usersQuery.data?.find((u) => u.id === currentTask.delegatedFromId)?.username
      ?? `用户#${currentTask.delegatedFromId}`;
  }, [currentTask?.delegatedFromId, usersQuery.data]);

  // 当前进度：所有 pending 审批任务（节点 + 等待人）
  const pendingTasks = useMemo(
    () => (detail?.tasks ?? []).filter((t) => t.status === 'pending' && t.nodeType !== 'ccNode'),
    [detail],
  );

  const nodeCfg = useMemo(
    () => flowData?.nodes.find((n) => n.data.key === currentTask?.nodeKey)?.data ?? null,
    [flowData, currentTask],
  );
  const viewerPerms = (nodeCfg?.fieldPermissions ?? null) as Record<string, WorkflowFieldPermission> | null;
  const visibleFields = useMemo(
    () => applyFieldPermissionsToFields(formFields, currentTask ? viewerPerms : null),
    [formFields, viewerPerms, currentTask],
  );
  // 移动端仅 designer 表单支持审批时编辑；业务表单（custom/external）恒只读查看
  const formEditable = actionable && formType === 'designer' && hasEditableFieldPermission(viewerPerms);

  const btnApprove = resolveBtn(currentTask?.actionButtons ?? null, 'approve');
  const btnReject = resolveBtn(currentTask?.actionButtons ?? null, 'reject');
  const btnTransfer = resolveBtn(currentTask?.actionButtons ?? null, 'transfer');
  const btnDelegate = resolveBtn(currentTask?.actionButtons ?? null, 'delegate');
  const btnAddSign = resolveBtn(currentTask?.actionButtons ?? null, 'addSign');
  const btnReturn = resolveBtn(currentTask?.actionButtons ?? null, 'return');
  const signaturePolicy = currentTask?.signaturePolicy ?? 'none';
  const needSignature = signaturePolicy !== 'none';
  const approveLabel = needSignature ? `签名并${btnApprove.displayName ?? '同意'}` : btnApprove.displayName ?? '同意';
  const opinionRequired = nodeCfg?.operations?.includes('opinionRequired') ?? false;
  const currentSlot = detail?.approvalActivations?.flatMap(a => a.slots).find(s => s.id === currentTask?.slotId);
  const canAddSign = !!currentTask && isWorkflowBaseApprovalTask(currentTask, currentSlot, currentTask.id);
  const returnOptions = useMemo(() => {
    const nodes = flowData?.nodes ?? [];
    const current = nodes.find(n => n.data.key === currentTask?.nodeKey);
    const ancestors = new Set<string>();
    const visit = (id: string) => { for (const edge of flowData?.edges ?? []) if (edge.target === id && !edge.isException && !ancestors.has(edge.source)) { ancestors.add(edge.source); visit(edge.source); } };
    if (current) visit(current.id);
    const approved = new Set((detail?.tasks ?? []).filter(t => t.status === 'approved').map(t => t.nodeKey));
    return [{ value: WORKFLOW_RETURN_TO_INITIATOR_KEY, label: '发起人（修改后重新提交）' }, ...nodes.filter(n => ancestors.has(n.id) && approved.has(n.data.key) && ['approve', 'handler'].includes(n.data.type)).map(n => ({ value: n.data.key, label: n.data.label }))];
  }, [flowData, currentTask, detail]);
  const actionConfig = action === 'approve' ? btnApprove : action === 'reject' ? btnReject : action === 'transfer' ? btnTransfer : action === 'delegate' ? btnDelegate : action === 'addSign' ? btnAddSign : btnReturn;

  const status = detail ? STATUS_MAP[detail.status] : null;
  const comments = detail?.comments ?? [];
  const recallableTask = [...(detail?.tasks ?? [])].reverse().find(t => t.assigneeId === me?.id && ['approved', 'rejected'].includes(t.status));
  const mentionOptions = useMemo(() => {
    if (!detail) return [] as Array<{ value: number; label: string }>;
    const users = new Map<number, string>();
    if (detail.initiatorId) users.set(detail.initiatorId, detail.initiatorName ?? `用户#${detail.initiatorId}`);
    for (const task of detail.tasks ?? []) {
      if (task.assigneeId) users.set(task.assigneeId, task.assigneeName ?? `用户#${task.assigneeId}`);
    }
    return [...users.entries()].map(([value, label]) => ({ value, label }));
  }, [detail]);

  const collectFormUpdates = async (): Promise<Record<string, unknown> | undefined> => {
    if (!formEditable || !viewerPerms || !detailFormApi.current) return undefined;
    const values = await detailFormApi.current.validate() as Record<string, unknown>;
    const updates: Record<string, unknown> = {};
    for (const [key, perm] of Object.entries(viewerPerms)) {
      if (perm === 'edit' && key in values) updates[key] = values[key];
    }
    return Object.keys(updates).length > 0 ? updates : undefined;
  };

  const openAction = (kind: Exclude<ActionKind, null>) => {
    setActionAttachments([]); setSignPosition('after'); setSignMode('and');
    setReturnTargets([btnReturn.jumpToNodeKey ?? WORKFLOW_RETURN_TO_INITIATOR_KEY]);
    setSignature(null);
    setHighlightNextMissing(false);
    setAction(kind);
  };

  const submitAction = async () => {
    if (taskId == null || !action || actionMutation.isPending) return;
    try {
      if (actionConfig.uploadMode === 'required' && actionAttachments.length === 0) { Toast.warning('请上传本次操作附件'); return; }
      const values = (await actionFormApi.current?.validate() ?? {}) as { comment?: string };
      if (action === 'approve' && needSignature && !signature) {
        Toast.error('请确认本次使用的签名');
        return;
      }
      if (action === 'approve' && signaturePolicy === 'handwritten' && signature?.source !== 'drawn') {
        Toast.error('该节点要求本次重新手写签名');
        return;
      }
      let vars: ApprovalTaskActionVariables;
      if (action === 'approve') {
        if (businessForm?.actionComponent && !businessActionFormApi.current) { Toast.warning('补充审批表单尚未就绪'); return; }
        const businessInput = await businessActionFormApi.current?.validate();
        const missing = nextGroups.find((g) => (selectedNext[g.nodeKey] ?? []).length === 0);
        if (missing) {
          setHighlightNextMissing(true);
          Toast.error(`请为「${missing.label}」选择审批人`);
          return;
        }
        const compactNext: Record<string, number[]> = {};
        for (const g of nextGroups) {
          const ids = selectedNext[g.nodeKey] ?? [];
          if (ids.length > 0) compactNext[g.nodeKey] = ids;
        }
        vars = {
          taskId,
          action,
          body: {
            businessInput,
            comment: values.comment ?? '',
            signature: needSignature ? signature ?? undefined : undefined,
            formUpdates: await collectFormUpdates(),
            selectedNextApprovers: Object.keys(compactNext).length > 0 ? compactNext : undefined,
          },
        };
      } else if (action === 'reject') {
        vars = { taskId, action, body: { comment: values.comment ?? '' } };
      } else if (action === 'transfer') {
        if (transferTarget.length === 0) {
          Toast.error('请选择接收人');
          return;
        }
        vars = { taskId, action, body: { targetUserId: transferTarget[0], comment: values.comment } };
      } else if (action === 'delegate') {
        if (delegateTarget.length === 0) {
          Toast.error('请选择委派人');
          return;
        }
        vars = { taskId, action, body: { targetUserId: delegateTarget[0], comment: values.comment } };
      } else if (action === 'addSign') {
        if (addSignTargets.length === 0) {
          Toast.error('请选择加签人');
          return;
        }
        vars = {
          taskId,
          action: 'add-sign',
          body: { targetUserIds: addSignTargets, position: signPosition, signMode, comment: values.comment },
        };
      } else {
        vars = {
          taskId,
          action: 'return',
          body: { targetNodeKeys: returnTargets, comment: values.comment ?? '' },
        };
      }
      vars.body = { ...vars.body, attachments: actionAttachments.map(item => ({ fileId: item.fileId })) };
      await actionMutation.mutateAsync(vars);
      businessActionFormApi.current?.onActionSuccess?.();
      setAction(null);
      if (action === 'addSign') { Toast.success('加签已创建，请继续完成本人的审批意见'); return; }
      // 连续审批（对标钉钉）：处理完自动进入下一条待办，清零后回列表
      const doneLabel = action === 'approve' ? (currentTask?.taskKind === 'suggestion' ? '已提交同意建议，等待原审批人确认' : '已同意')
        : action === 'reject' ? '已驳回'
          : action === 'transfer' ? '已转办'
            : action === 'delegate' ? '已委派'
            : '已退回';
      try {
        const { next, remaining } = await fetchNextPendingTask(taskId, instanceId);
        if (next) {
          Toast.success(`${doneLabel} · 还剩 ${remaining} 条待办，已进入下一条`);
          navigate(`/detail/${next.instanceId}/${next.taskId}`, { replace: true });
          return;
        }
        Toast.success(remaining > 0 ? `${doneLabel} · 还剩 ${remaining} 条待办，请返回列表继续` : `${doneLabel} · 待办已清零 🎉`);
      } catch {
        Toast.success(doneLabel);
      }
      navigate('/', { replace: true });
    } catch { /* 表单校验失败或请求失败（request 层已 Toast） */ }
  };

  const withdraw = async () => {
    if (!detail) return;
    try {
      await withdrawMutation.mutateAsync({ id: detail.id });
      Toast.success('已撤回');
      navigate('/', { replace: true });
    } catch { /* request 层已 Toast */ }
  };

  const deleteDraft = async () => {
    if (!detail || !draftActionable) return;
    try {
      await deleteMutation.mutateAsync(detail.id);
      Toast.success('草稿已删除');
      navigate('/', { replace: true });
      // 先让详情观察者卸载，再清理已删除实例的缓存，避免 active query
      // 在删除响应后立刻回源并弹出「流程实例不存在」。
      window.setTimeout(() => {
        queryClient.removeQueries({ queryKey: approvalKeys.detail(detail.id), exact: true });
      }, 0);
    } catch { /* request 层已 Toast */ }
  };

  const urge = async () => {
    if (!detail) return;
    try {
      const result = await urgeMutation.mutateAsync({ id: detail.id });
      const names = result.urged.map((row) => row.assigneeName ?? '处理人').join('、');
      Toast.success(names ? `已催办：${names}` : result.message);
    } catch { /* request 层已 Toast */ }
  };

  const sendComment = async () => {
    const text = commentDraft.trim();
    if (!detail || !text) return;
    try {
      await commentMutation.mutateAsync({
        instanceId: detail.id,
        content: text,
        mentions: commentMentions,
        attachments: commentAttachments.map((item) => ({ fileId: item.fileId })),
        parentId: replyTo?.id ?? null,
      });
      setCommentDraft('');
      setReplyTo(null);
      setCommentMentions([]);
      setCommentAttachments([]);
      Toast.success('评论已发送');
    } catch { /* request 层已 Toast */ }
  };

  const appendPhrase = (text: string) => {
    const api = actionFormApi.current;
    if (!api) return;
    const cur = (api.getValue('comment') as string | undefined) ?? '';
    api.setValue('comment', cur ? `${cur} ${text}` : text);
  };

  const renderForm = () => {
    // 业务表单（custom/external）：移动端以只读模式渲染业务查看组件
    // （数据编辑/发起仍在桌面端或业务模块），组件缺失时宿主内置 Empty 兜底
    if (formType !== 'designer') {
      return (
        <BusinessFormHost
          requestClient={approvalRequest}
          customForm={resolveWorkflowCustomForm(detail, def)}
          mode="view"
          container="sheet"
          definitionId={detail?.definitionId ?? 0}
          instanceId={detail?.id ?? null}
          value={(detail?.formData as Record<string, unknown>) ?? {}}
          bizType={detail?.bizType ?? null}
          bizId={detail?.bizId ?? null}
          readOnly
        />
      );
    }
    if (visibleFields.length === 0) {
      return <Typography.Text type="tertiary" size="small">当前节点无可见表单字段</Typography.Text>;
    }
    return (
      <WorkflowFormRenderer
        attachmentInstanceId={instanceId}
        instanceSerialNo={detail?.serialNo}
        key={`form-${instanceId}-${taskId ?? 'view'}-${currentTask?.activationId ?? 'none'}-${formEditable ? 'edit' : 'read'}`}
        fields={visibleFields}
        initValues={(detail?.formData ?? {}) as Record<string, unknown>}
        readOnly={!formEditable}
        readOnlyAsText
        filePreviewPresentation="fullscreen"
        fileCapture="environment"
        getFormApi={(api) => { detailFormApi.current = api; }}
      />
    );
  };

  if (detailQuery.isLoading) {
    return (
      <PageShell title="加载中…">
        <div className="ap-body"><Skeleton placeholder={<Skeleton.Paragraph rows={6} />} loading active /></div>
      </PageShell>
    );
  }

  if (!detail) {
    return (
      <PageShell title="申请详情">
        <div className="ap-body">
          {detailQuery.isError ? (
            <div className="ap-error" role="alert">
              <Typography.Text type="danger">详情加载失败，请检查网络后重试。</Typography.Text>
              <Button size="small" onClick={() => void detailQuery.refetch()}>重试</Button>
            </div>
          ) : <Empty description="流程不存在或无权查看" style={{ paddingTop: 60 }} />}
        </div>
      </PageShell>
    );
  }

  const draftActionable = (detail.status === 'draft' || detail.status === 'returned') && isInitiator;
  const cloneActionable = isInitiator && detail.allowResubmit && ['rejected', 'withdrawn'].includes(detail.status) && !detail.bizId;
  const hasFooter = actionable || initiatorActionable || draftActionable || cloneActionable;
  const sheetTitle = action === 'approve' ? approveLabel
    : action === 'reject' ? (btnReject.displayName ?? '拒绝')
      : action === 'transfer' ? (btnTransfer.displayName ?? '转办')
        : action === 'delegate' ? (btnDelegate.displayName ?? '委派')
          : action === 'addSign' ? (btnAddSign.displayName ?? '加签')
            : (btnReturn.displayName ?? '退回');

  const canPrint = detail.status !== 'draft' && (me?.permissions?.includes('*') || me?.permissions?.includes('workflow:instance:print'));

  return (
    <PageShell
      title={detail.title}
      tag={status && <Tag color={status.color}>{status.text}</Tag>}
      actions={(
        <>
          <MobileWorkflowGraph
            flowData={flowData}
            tasks={detail.tasks ?? []}
            consults={detail.consults ?? []}
            instanceStatus={detail.status}
            formFields={formFields}
          />
          {canPrint ? <SharePrintButton instanceId={detail.id} title={detail.title} /> : null}
        </>
      )}
    >
      <div className={`ap-body${hasFooter ? ' ap-body--with-footer' : ''}`}>
        <div className="ap-section">{me?.permissions?.some(p => p === '*' || p === 'workflow:instance:list') && <Button onClick={() => { setCollaborationAction('forward'); setCollaborationUsers([]); }}>抄送他人</Button>}{actionable && <Button onClick={() => { setCollaborationAction('consult'); setCollaborationUsers([]); }}>邀请协办</Button>}{recallableTask && detail.status === 'running' && <Popconfirm title="撤回我的处理？后续已处理时将无法撤回。" onConfirm={() => void collaboration.mutateAsync({ action: 'recall', taskId: recallableTask.id })}><Button>撤回我的处理</Button></Popconfirm>}</div>
        {requestedTaskId == null && myPendingTasks.length > 1 && <div className="ap-section"><Typography.Text>请选择本次处理的任务</Typography.Text>{myPendingTasks.map(t => <Button key={t.id} block onClick={() => navigate(`/detail/${instanceId}/${t.id}`, { replace: true })}>{t.nodeName}{t.signPosition ? ' · 加签意见' : ''}</Button>)}</div>}
        {requestedTaskId != null && !actionable && <Banner type="info" closeIcon={null} description="此任务已处理或不再由你处理。可返回待办列表查看当前任务。" />}
        {detail.status === 'suspended' && (
          <Banner type="warning" closeIcon={null} description={`流程已挂起${detail.suspendReason ? `：${detail.suspendReason}` : ''}，恢复前不可审批`} style={{ marginBottom: 12 }} />
        )}
        {currentTask?.delegatedFromId != null && (
          <Banner
            type="info"
            closeIcon={null}
            description={currentTask.delegationMode === 'suggest'
              ? `当前为建议制代理：你正在为${delegatedFromName}提供审批建议，最终确认仍由委托人完成。`
              : `当前为代理审批：你正在代${delegatedFromName}处理此任务，操作会保留代理留痕。`}
            style={{ marginBottom: 12 }}
          />
        )}
        {!online && <Banner type="warning" closeIcon={null} description="当前处于离线状态，审批操作已暂时禁用；网络恢复后可继续处理。" style={{ marginBottom: 12 }} />}

        {/* 基本信息 + 当前进度 */}
        <div className="ap-section">
          <div className="ap-detail-head">
            <UserAvatar name={detail.initiatorName ?? '—'} avatar={detail.initiatorAvatar ?? undefined} size={40} />
            <div className="ap-detail-head__info">
              <div className="ap-detail-head__name">{detail.initiatorName ?? '—'}</div>
              <div className="ap-detail-head__meta">
                {(detail.priority === 'high' || detail.priority === 'urgent') && <WorkflowPriorityTag priority={detail.priority} />}
                <span>{detail.definitionName ?? '—'}</span>
                <span>·</span>
                <span>{formatDateTime(detail.createdAt)}</span>
              </div>
            </div>
          </div>
          {detail.status === 'running' && pendingTasks.length > 0 && (
            <div className="ap-progress-hint">
              当前节点「{pendingTasks[0].nodeName}」，等待
              {' '}{[...new Set(pendingTasks.map((t) => t.assigneeName ?? `用户#${t.assigneeId}`))].slice(0, 3).join('、')}
              {pendingTasks.length > 3 ? ` 等 ${pendingTasks.length} 人` : ''} 处理
            </div>
          )}
        </div>

        {/* 审批表单 */}
        <div className="ap-section">
          <div className="ap-section__title">审批表单{formEditable && <Tag size="small" color="blue" style={{ marginLeft: 6 }}>可编辑</Tag>}</div>
          {renderForm()}
        </div>

        {/* 流转记录 */}
        <div className="ap-section">
          <div className="ap-section__title">流转记录</div>
          <ApprovalTimeline
            approvalActivations={detail.approvalActivations}
            childInstances={detail.childInstances ?? []}
            tasks={detail.tasks ?? []}
            consults={detail.consults ?? []}
            flowNodes={detail.predictedPath ?? linearizeApprovalNodes(flowData)}
            initiator={{ name: detail.initiatorName, avatar: detail.initiatorAvatar, submittedAt: detail.createdAt }}
            instanceStatus={detail.status}
            finishedAt={detail.updatedAt}
            currentUserId={me?.id ?? null}
          />
          {(detail.approvalActivations ?? []).map(activation => <div key={activation.id} className="ap-section"><Typography.Text strong>{activation.nodeName}：基础意见 {activation.baseApproved}/{activation.baseTotal}，需 {activation.baseRequired} 票</Typography.Text>{activation.signGroups.map(group => <div key={group.id}><Tag>{group.position === 'before' ? '前加签' : group.position === 'after' ? '后加签' : '并加签'} · {group.signMode === 'and' ? '会签' : '或签'} · {group.status}</Tag>{group.slots.map(slot => <div key={slot.id}>{slot.assigneeName} · {slot.status}{group.canReduce && slot.status === 'pending' && <Popconfirm title="移除此未办加签席位？" onConfirm={() => void collaboration.mutateAsync({ action: 'reduce', groupId: group.id, slotIds: [slot.id] })}><Button size="small" type="danger">减签</Button></Popconfirm>}</div>)}</div>)}</div>)}
          {(detail.consults ?? []).filter(c => c.consulteeId === me?.id && c.status === 'pending').map(c => <div key={c.id} className="ap-section"><Typography.Text>协办：{c.question}</Typography.Text><TextArea value={replyDrafts[c.id] ?? ''} onChange={v => setReplyDrafts(p => ({ ...p, [c.id]: v }))} placeholder="填写协办意见" /><Button disabled={!replyDrafts[c.id]?.trim()} onClick={() => void collaboration.mutateAsync({ action: 'reply', id: c.id, opinion: replyDrafts[c.id] })}>提交协办意见</Button></div>)}
        </div>

        {/* 沟通评论 */}
        <div className="ap-section">
          <div className="ap-section__title">沟通评论{comments.length > 0 ? `（${comments.length}）` : ''}</div>
          {comments.length === 0 && (
            <Typography.Text type="tertiary" size="small">暂无评论</Typography.Text>
          )}
          {comments.map((c) => (
            <div key={c.id} className="ap-comment">
              <Avatar size="extra-small" src={c.userAvatar ?? undefined} style={{ flexShrink: 0 }}>
                {(c.userName ?? 'U').slice(0, 1)}
              </Avatar>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ap-comment__head">
                  <span className="ap-comment__name">{c.userName ?? `用户#${c.userId}`}</span>
                  <span className="ap-comment__time">{formatDateTime(c.createdAt)}</span>
                  {detail.allowComment !== false && (
                    <Button
                      theme="borderless"
                      size="small"
                      icon={<Reply size={12} />}
                      onClick={() => setReplyTo({ id: c.id, userName: c.userName, content: c.content })}
                    >
                      回复
                    </Button>
                  )}
                </div>
                {c.parentSummary && (
                  <div className="ap-comment__quote">{c.parentSummary.userName ?? '—'}：{c.parentSummary.content}</div>
                )}
                <div className="ap-comment__content">{c.content}</div>
                {c.attachments && c.attachments.length > 0 && (
                  <FileAttachment mode="view" showTitle={false} previewPresentation="fullscreen" value={c.attachments.map((a, i) => workflowFileToAttachment(a, i))} />
                )}
              </div>
            </div>
          ))}
          {detail.allowComment !== false && (
            <div className="ap-comment-composer">
              {replyTo && (
                <div className="ap-comment-replying">
                  <span>回复 {replyTo.userName ?? '评论'}：{replyTo.content}</span>
                  <Button theme="borderless" size="small" icon={<X size={13} />} onClick={() => setReplyTo(null)} aria-label="取消回复" />
                </div>
              )}
              <TextArea
                value={commentDraft}
                onChange={setCommentDraft}
                placeholder={replyTo ? `回复 ${replyTo.userName ?? '评论'}…` : '发表评论，与流程相关人员沟通…'}
                autosize={{ minRows: 2, maxRows: 5 }}
                maxCount={2000}
              />
              <FileAttachment
                mode="edit"
                uploadPath={urlOf(workflowAttachmentContract.upload)}
                uploadData={{ instanceId: detail.id }}
                showTitle={false}
                limit={5}
                previewPresentation="fullscreen"
                value={commentAttachments}
                onChange={setCommentAttachments}
              />
              <div className="ap-comment-composer__actions">
                <Select
                  multiple
                  filter
                  showClear
                  value={commentMentions}
                  optionList={mentionOptions}
                  placeholder="提醒谁（@提及）"
                  onChange={(value) => setCommentMentions((value as number[]) ?? [])}
                  maxTagCount={2}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <Button
                  theme="solid"
                  type="primary"
                  icon={<Send size={14} />}
                  loading={commentMutation.isPending}
                  disabled={!commentDraft.trim() || !online}
                  onClick={() => void sendComment()}
                  aria-label="发送评论"
                >
                  发送
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 底部操作条：草稿 */}
      {draftActionable && (
        <div className="ap-footer-bar">
          <Button theme="light" onClick={() => navigate(`/draft/${detail.id}`)}>
            {detail.status === 'returned' ? '修改并重新提交' : '编辑'}
          </Button>
          {detail.status === 'draft' && <Popconfirm title="删除这份草稿？" content="删除后无法恢复。" onConfirm={() => void deleteDraft()}>
            <Button theme="solid" type="danger" loading={deleteMutation.isPending}>
              删除草稿
            </Button>
          </Popconfirm>}
        </div>
      )}
      {cloneActionable && <div className="ap-footer-bar"><Button block theme="solid" loading={resubmitMutation.isPending} onClick={() => { void resubmitMutation.mutateAsync(detail.id).then(d => navigate(`/draft/${d.id}`)); }}>重新申请</Button></div>}

      {/* 底部操作条：审批人 */}
      {actionable && (
        <div className="ap-footer-bar">
          {btnTransfer.enabled && (
            <Button theme="light" disabled={!online} onClick={() => openAction('transfer')}>{btnTransfer.displayName ?? '转办'}</Button>
          )}
          {(btnDelegate.enabled || (btnAddSign.enabled && canAddSign) || btnReturn.enabled) && (
            <Dropdown
              trigger="click"
              position="topRight"
              render={(
                <Dropdown.Menu>
                  {btnDelegate.enabled && <Dropdown.Item onClick={() => openAction('delegate')}>{btnDelegate.displayName ?? '委派'}</Dropdown.Item>}
                  {btnAddSign.enabled && canAddSign && <Dropdown.Item onClick={() => openAction('addSign')}>{btnAddSign.displayName ?? '加签'}</Dropdown.Item>}
                  {btnReturn.enabled && <Dropdown.Item onClick={() => openAction('return')}>{btnReturn.displayName ?? '退回'}</Dropdown.Item>}
                </Dropdown.Menu>
              )}
            >
              <Button theme="light" disabled={!online} icon={<MoreHorizontal size={15} />}>更多</Button>
            </Dropdown>
          )}
          {btnReject.enabled && (
            <Button theme="light" type="danger" disabled={!online} onClick={() => openAction('reject')}>{btnReject.displayName ?? '拒绝'}</Button>
          )}
          {btnApprove.enabled && (
            <Button theme="solid" type="primary" disabled={!online} onClick={() => openAction('approve')}>{approveLabel}</Button>
          )}
        </div>
      )}

      {/* 底部操作条：发起人（撤回 / 催办） */}
      {initiatorActionable && (
        <div className="ap-footer-bar">
          {detail.allowWithdraw && <Popconfirm title="确定撤回该申请？" content="撤回后流程终止，可重新发起" onConfirm={() => void withdraw()}>
            <Button theme="light" type="danger" disabled={!online} icon={<RotateCcw size={14} />} loading={withdrawMutation.isPending}>撤回</Button>
          </Popconfirm>}
          <Button
            theme="solid"
            type="primary"
            icon={<BellRing size={14} />}
            loading={urgeMutation.isPending}
            disabled={!online}
            onClick={() => void urge()}
          >
            催办
          </Button>
        </div>
      )}

      {/* 审批操作底部抽屉 */}
      <SideSheet
        placement="bottom"
        height="auto"
        title={sheetTitle}
        visible={action != null}
        onCancel={() => setAction(null)}
        className="ap-sheet"
      >
        <div className="ap-sheet__body">
          {action === 'return' && <Select style={{ width: '100%' }} optionList={returnOptions} value={returnTargets[0]} onChange={value => setReturnTargets([String(value)])} placeholder="退回到节点" />}
          {action === 'addSign' && <><Select style={{ width: '100%', marginBottom: 10 }} value={signPosition} optionList={[{ value: 'before', label: '前加签：先收集补充意见，再由我确认' }, { value: 'after', label: '后加签：我同意后再收集意见' }, { value: 'parallel', label: '并加签：与我同时处理' }]} onChange={v => setSignPosition(v as typeof signPosition)} /><Select style={{ width: '100%' }} value={signMode} optionList={[{ value: 'and', label: '本次加签组全部同意' }, { value: 'or', label: '本次加签组任一同意' }]} onChange={v => setSignMode(v as typeof signMode)} /></>}
          {actionConfig.uploadMode && actionConfig.uploadMode !== 'hidden' && <FileAttachment key={`${taskId}-${action}`} mode="edit" uploadPath={urlOf(workflowAttachmentContract.upload)} uploadData={{ instanceId }} previewPresentation="fullscreen" capture="environment" value={actionAttachments} onChange={setActionAttachments} title={actionConfig.uploadMode === 'required' ? '操作附件（必填）' : '操作附件'} limit={20} />}
          {action === 'approve' && businessForm?.actionComponent && detail ? <BusinessFormHost
            key={'business-action-' + taskId} requestClient={approvalRequest} customForm={businessForm} mode="action"
            definitionId={detail.definitionId} instanceId={detail.id} value={detail.formData ?? {}} bizType={detail.bizType} bizId={detail.bizId}
            getFormApi={api => { businessActionFormApi.current = api; }}
          /> : null}
          {(action === 'transfer' || action === 'delegate' || action === 'addSign') && (
            <div style={{ marginBottom: 12 }}>
              <Typography.Text type="secondary" size="small" style={{ display: 'block', marginBottom: 6 }}>
                {action === 'transfer' ? '转办给' : action === 'delegate' ? '委派给' : '加签人'}
              </Typography.Text>
              <ApproverPickerField
                title={action === 'transfer' ? '转办给' : action === 'delegate' ? '委派给' : '加签人'}
                candidates={transferCandidates}
                value={action === 'transfer' ? transferTarget : action === 'delegate' ? delegateTarget : addSignTargets}
                onChange={action === 'transfer' ? setTransferTarget : action === 'delegate' ? setDelegateTarget : setAddSignTargets}
                multiple={action === 'addSign'}
                placeholder={action === 'addSign' ? '选择一名或多名加签人' : '选择接收人'}
                loading={usersQuery.isLoading}
              />
            </div>
          )}
          {action === 'approve' && nextGroups.map((g) => {
            const ids = selectedNext[g.nodeKey] ?? [];
            const missing = highlightNextMissing && ids.length === 0;
            const searched = searchedCandidates(g.nodeKey);
            return (
              <div key={g.nodeKey} style={{ marginBottom: 12 }}>
                <Typography.Text type="secondary" size="small" style={{ display: 'block', marginBottom: 6 }}>
                  下一节点「{g.label}」审批人（必选）
                </Typography.Text>
                <ApproverPickerField
                  title={g.label}
                  candidates={searched ?? g.selectableApprovers}
                  truncated={g.truncated}
                  loading={searched !== null && nextSearchQuery.isFetching}
                  onSearch={g.truncated
                    ? (keyword) => setNextSearch(keyword ? { nodeKey: g.nodeKey, keyword } : null)
                    : undefined}
                  value={ids}
                  onChange={(next) => {
                    setSelectedNext((prev) => ({ ...prev, [g.nodeKey]: next }));
                    if (next.length > 0) setHighlightNextMissing(false);
                  }}
                  error={missing}
                />
                {missing && <span className="ap-chain__error">请选择该节点的审批人</span>}
              </div>
            );
          })}
          <Form getFormApi={(api) => { actionFormApi.current = api; }}>
            <Form.TextArea
              field="comment"
              label={action === 'approve' ? (btnApprove.opinionName ?? '审批意见')
                : action === 'reject' ? (btnReject.opinionName ?? '拒绝原因')
                  : action === 'transfer' ? (btnTransfer.opinionName ?? '转办说明')
                    : action === 'delegate' ? (btnDelegate.opinionName ?? '委派说明')
                      : action === 'addSign' ? (btnAddSign.opinionName ?? '加签说明')
                        : (btnReturn.opinionName ?? '退回原因')}
              rows={3}
              placeholder={action === 'reject' || action === 'return' || (action === 'approve' && opinionRequired) ? '必填' : '选填'}
              rules={action === 'reject' || action === 'return' || (action === 'approve' && opinionRequired)
                ? [{ required: true, message: '请填写意见' }]
                : undefined}
            />
          </Form>
          {(action === 'approve' || action === 'reject') && (phrasesQuery.data?.length ?? 0) > 0 && (
            <div className="ap-phrases">
              {(phrasesQuery.data ?? []).slice(0, 8).map((p) => (
                <Tag key={p.id} className="ap-phrases__item" onClick={() => appendPhrase(p.content)}>{p.content}</Tag>
              ))}
            </div>
          )}
          {action === 'approve' && needSignature && (
            <div style={{ marginTop: 8 }}>
              <Typography.Text type="secondary" size="small">本次签名（必填）</Typography.Text>
              <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 6, marginTop: 6, overflow: 'hidden' }}>
                <Suspense fallback={<Spin size="small" />}>
                  <SignatureField key={taskId} value={signature} onChange={setSignature}
                    policy={signaturePolicy} autoSelectSaved={signaturePolicy === 'reusable'} />
                </Suspense>
              </div>
            </div>
          )}
          <div className="ap-sheet__actions">
            <Button block theme="light" onClick={() => setAction(null)}>取消</Button>
            <Button
              block
              theme="solid"
              type={action === 'reject' || action === 'return' ? 'danger' : 'primary'}
              loading={actionMutation.isPending}
              disabled={action === 'approve' && needSignature && !signature}
              onClick={() => void submitAction()}
            >
              {action === 'approve' && needSignature ? sheetTitle : `确认${sheetTitle}`}
            </Button>
          </div>
        </div>
      </SideSheet>
      <SideSheet placement="bottom" height="auto" className="ap-sheet" title={collaborationAction === 'consult' ? '邀请协办' : '抄送他人'} visible={collaborationAction != null} onCancel={() => setCollaborationAction(null)}><ApproverPickerField title="选择人员" candidates={transferCandidates} value={collaborationUsers} onChange={setCollaborationUsers} /><TextArea value={collaborationNote} onChange={setCollaborationNote} placeholder="说明" /><Button block theme="solid" disabled={!collaborationUsers.length} loading={collaboration.isPending} onClick={() => { if (!collaborationAction) return; void collaboration.mutateAsync(collaborationAction === 'consult' ? { action: 'consult', taskId: taskId!, userIds: collaborationUsers, question: collaborationNote } : { action: 'forward', instanceId, userIds: collaborationUsers, note: collaborationNote }).then(() => { setCollaborationAction(null); Toast.success('已发送'); }); }}>确认发送</Button></SideSheet>
    </PageShell>
  );
}
