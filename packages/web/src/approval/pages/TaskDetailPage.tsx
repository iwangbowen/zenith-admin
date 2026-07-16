import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Avatar, Banner, Button, Empty, Form, Popconfirm, SideSheet, Skeleton, Tag, TextArea, Toast, Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { BellRing, ChevronLeft, RotateCcw, Send } from 'lucide-react';
import type { WorkflowActionButtonConfig, WorkflowFieldPermission, WorkflowTask } from '@zenith/shared';
import { applyFieldPermissionsToFields, hasEditableFieldPermission } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';
import ApprovalTimeline from '@/components/ApprovalTimeline';
import FileAttachment from '@/components/FileAttachment';
import { uploadedFileToAttachment } from '@/components/FileAttachment/utils';
import SignaturePad from '@/components/SignaturePad';
import { UserAvatar } from '@/components/UserAvatar';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import BusinessFormHost from '@/components/workflow/BusinessFormHost';
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
import {
  fetchNextPendingTask,
  useAddApprovalComment, useApprovalDetail, useApprovalMe, useApprovalQuickPhrases, useApprovalUsers,
  useSelectableNextApprovers, useTaskAction, useUrgeInstance, useWithdrawInstance,
} from '../lib/queries';
import { INSTANCE_STATUS_MAP as STATUS_MAP } from '@/components/workflow/workflow-runtime';

type ActionKind = 'approve' | 'reject' | 'transfer' | null;

function resolveBtn(
  cfg: Partial<Record<string, WorkflowActionButtonConfig>> | null | undefined,
  key: 'approve' | 'reject' | 'transfer',
): WorkflowActionButtonConfig {
  const defaults: WorkflowActionButtonConfig = {
    enabled: key !== 'transfer',
    displayName: key === 'approve' ? '同意' : key === 'reject' ? '拒绝' : '转办',
    opinionName: key === 'approve' ? '审批意见' : key === 'reject' ? '拒绝原因' : '转办说明',
  };
  const override = cfg?.[key];
  return override ? { ...defaults, ...override } : defaults;
}

/** 详情页头部骨架（返回键常驻，避免加载时无法退出） */
function PageShell({ title, tag, children }: Readonly<{ title: string; tag?: React.ReactNode; children: React.ReactNode }>) {
  const navigate = useNavigate();
  return (
    <div className="ap-page">
      <div className="ap-header">
        <Button theme="borderless" icon={<ChevronLeft size={18} />} onClick={() => navigate(-1)} aria-label="返回" />
        <span className="ap-header__title">{title}</span>
        {tag}
      </div>
      {children}
    </div>
  );
}

export default function TaskDetailPage() {
  const navigate = useNavigate();
  const params = useParams<{ instanceId: string; taskId?: string }>();
  const instanceId = Number(params.instanceId);
  const taskId = params.taskId ? Number(params.taskId) : null;

  const detailQuery = useApprovalDetail(Number.isFinite(instanceId) ? instanceId : null);
  const meQuery = useApprovalMe();
  const actionMutation = useTaskAction();
  const withdrawMutation = useWithdrawInstance();
  const urgeMutation = useUrgeInstance();
  const commentMutation = useAddApprovalComment();
  const detail = detailQuery.data ?? null;
  const me = meQuery.data ?? null;

  const [action, setAction] = useState<ActionKind>(null);
  const [signature, setSignature] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  // 下一节点自选审批人：nodeKey -> userIds；转办接收人（单选）
  const [selectedNext, setSelectedNext] = useState<Record<string, number[]>>({});
  const [highlightNextMissing, setHighlightNextMissing] = useState(false);
  const [transferTarget, setTransferTarget] = useState<number[]>([]);
  const actionFormApi = useRef<FormApi | null>(null);
  const detailFormApi = useRef<FormApi | null>(null);

  // 连续审批跳转到下一条时复用组件实例，需重置操作状态
  useEffect(() => {
    setAction(null);
    setSignature('');
    setCommentDraft('');
    setSelectedNext({});
    setHighlightNextMissing(false);
    setTransferTarget([]);
  }, [instanceId, taskId]);

  const phrasesQuery = useApprovalQuickPhrases(action === 'approve' || action === 'reject');

  const def = useMemo(() => resolveWorkflowDetailDefinition(detail), [detail]);
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
  const usersQuery = useApprovalUsers(action === 'transfer');
  const transferCandidates = useMemo(
    () => (usersQuery.data ?? [])
      .filter((u) => u.id !== me?.id)
      .map((u) => ({ id: u.id, name: u.nickname || u.username })),
    [usersQuery.data, me],
  );

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
  const needSignature = (currentTask?.signatureRequired ?? false) || (nodeCfg?.operations?.includes('signature') ?? false);
  const opinionRequired = nodeCfg?.operations?.includes('opinionRequired') ?? false;

  const status = detail ? STATUS_MAP[detail.status] : null;
  const comments = detail?.comments ?? [];

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
    if (kind === 'approve' && btnApprove.uploadMode === 'required') {
      Toast.info('该节点要求上传附件，请到桌面端处理');
      return;
    }
    setSignature('');
    setHighlightNextMissing(false);
    setAction(kind);
  };

  const submitAction = async () => {
    if (taskId == null || !action) return;
    try {
      const values = (await actionFormApi.current?.validate() ?? {}) as Record<string, unknown>;
      if (action === 'approve' && needSignature && !signature) {
        Toast.error('该节点要求手写签名，请先签名');
        return;
      }
      let body: Record<string, unknown>;
      if (action === 'approve') {
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
        body = {
          comment: values.comment ?? '',
          signature: signature || undefined,
          formUpdates: await collectFormUpdates(),
          selectedNextApprovers: Object.keys(compactNext).length > 0 ? compactNext : undefined,
        };
      } else if (action === 'reject') {
        body = { comment: values.comment };
      } else {
        if (transferTarget.length === 0) {
          Toast.error('请选择接收人');
          return;
        }
        body = { targetUserId: transferTarget[0], comment: values.comment };
      }
      await actionMutation.mutateAsync({ taskId, action, body });
      setAction(null);
      // 连续审批（对标钉钉）：处理完自动进入下一条待办，清零后回列表
      const doneLabel = action === 'approve' ? '已同意' : action === 'reject' ? '已驳回' : '已转办';
      try {
        const { next, remaining } = await fetchNextPendingTask(instanceId);
        if (next) {
          Toast.success(`${doneLabel} · 还剩 ${remaining} 条待办，已进入下一条`);
          navigate(`/detail/${next.instanceId}/${next.taskId}`, { replace: true });
          return;
        }
        Toast.success(`${doneLabel} · 待办已清零 🎉`);
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

  const urge = async () => {
    if (!detail) return;
    try {
      await urgeMutation.mutateAsync({ id: detail.id });
      Toast.success('已发送催办提醒');
    } catch { /* request 层已 Toast */ }
  };

  const sendComment = async () => {
    const text = commentDraft.trim();
    if (!detail || !text) return;
    try {
      await commentMutation.mutateAsync({ instanceId: detail.id, content: text });
      setCommentDraft('');
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
        key={`form-${instanceId}-${formEditable ? 'edit' : 'read'}`}
        fields={visibleFields}
        initValues={(detail?.formData ?? {}) as Record<string, unknown>}
        readOnly={!formEditable}
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
        <div className="ap-body"><Empty description="流程不存在或无权查看" style={{ paddingTop: 60 }} /></div>
      </PageShell>
    );
  }

  const hasFooter = actionable || initiatorActionable;
  const sheetTitle = action === 'approve' ? (btnApprove.displayName ?? '同意')
    : action === 'reject' ? (btnReject.displayName ?? '拒绝')
    : (btnTransfer.displayName ?? '转办');

  return (
    <PageShell title={detail.title} tag={status && <Tag color={status.color}>{status.text}</Tag>}>
      <div className={`ap-body${hasFooter ? ' ap-body--with-footer' : ''}`}>
        {detail.status === 'suspended' && (
          <Banner type="warning" closeIcon={null} description={`流程已挂起${detail.suspendReason ? `：${detail.suspendReason}` : ''}，恢复前不可审批`} style={{ marginBottom: 12 }} />
        )}

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
            tasks={detail.tasks ?? []}
            flowNodes={linearizeApprovalNodes(flowData)}
            initiator={{ name: detail.initiatorName, avatar: detail.initiatorAvatar, submittedAt: detail.createdAt }}
            instanceStatus={detail.status}
            finishedAt={detail.updatedAt}
            currentUserId={me?.id ?? null}
          />
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
                </div>
                {c.parentSummary && (
                  <div className="ap-comment__quote">{c.parentSummary.userName ?? '—'}：{c.parentSummary.content}</div>
                )}
                <div className="ap-comment__content">{c.content}</div>
                {c.attachments && c.attachments.length > 0 && (
                  <FileAttachment mode="view" showTitle={false} value={c.attachments.map((a, i) => uploadedFileToAttachment(a, i))} />
                )}
              </div>
            </div>
          ))}
          {detail.allowComment !== false && (
            <div className="ap-comment-input">
              <TextArea
                value={commentDraft}
                onChange={setCommentDraft}
                placeholder="发表评论，与流程相关人员沟通…"
                autosize={{ minRows: 1, maxRows: 4 }}
                maxCount={2000}
              />
              <Button
                theme="solid"
                type="primary"
                icon={<Send size={14} />}
                loading={commentMutation.isPending}
                disabled={!commentDraft.trim()}
                onClick={() => void sendComment()}
                aria-label="发送评论"
              />
            </div>
          )}
        </div>
      </div>

      {/* 底部操作条：审批人 */}
      {actionable && (
        <div className="ap-footer-bar">
          {btnTransfer.enabled && (
            <Button theme="light" onClick={() => openAction('transfer')}>{btnTransfer.displayName ?? '转办'}</Button>
          )}
          {btnReject.enabled && (
            <Button theme="light" type="danger" onClick={() => openAction('reject')}>{btnReject.displayName ?? '拒绝'}</Button>
          )}
          {btnApprove.enabled && (
            <Button theme="solid" type="primary" onClick={() => openAction('approve')}>{btnApprove.displayName ?? '同意'}</Button>
          )}
        </div>
      )}

      {/* 底部操作条：发起人（撤回 / 催办） */}
      {initiatorActionable && (
        <div className="ap-footer-bar">
          <Popconfirm title="确定撤回该申请？" content="撤回后流程终止，可重新发起" onConfirm={() => void withdraw()}>
            <Button theme="light" type="danger" icon={<RotateCcw size={14} />} loading={withdrawMutation.isPending}>撤回</Button>
          </Popconfirm>
          <Button
            theme="solid"
            type="primary"
            icon={<BellRing size={14} />}
            loading={urgeMutation.isPending}
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
          {action === 'transfer' && (
            <div style={{ marginBottom: 12 }}>
              <Typography.Text type="secondary" size="small" style={{ display: 'block', marginBottom: 6 }}>转办给</Typography.Text>
              <ApproverPickerField
                title="转办给"
                candidates={transferCandidates}
                value={transferTarget}
                onChange={setTransferTarget}
                multiple={false}
                placeholder="选择接收人"
                loading={usersQuery.isLoading}
              />
            </div>
          )}
          {action === 'approve' && nextGroups.map((g) => {
            const ids = selectedNext[g.nodeKey] ?? [];
            const missing = highlightNextMissing && ids.length === 0;
            return (
              <div key={g.nodeKey} style={{ marginBottom: 12 }}>
                <Typography.Text type="secondary" size="small" style={{ display: 'block', marginBottom: 6 }}>
                  下一节点「{g.label}」审批人（必选）
                </Typography.Text>
                <ApproverPickerField
                  title={g.label}
                  candidates={g.selectableApprovers}
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
              label={action === 'approve' ? (btnApprove.opinionName ?? '审批意见') : action === 'reject' ? (btnReject.opinionName ?? '拒绝原因') : (btnTransfer.opinionName ?? '转办说明')}
              rows={3}
              placeholder={action === 'reject' || (action === 'approve' && opinionRequired) ? '必填' : '选填'}
              rules={action === 'reject' || (action === 'approve' && opinionRequired)
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
              <Typography.Text type="secondary" size="small">手写签名（必填）</Typography.Text>
              <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 6, marginTop: 6, overflow: 'hidden' }}>
                <SignaturePad value={signature} onChange={setSignature} width={Math.min(400, window.innerWidth - 64)} height={140} />
              </div>
            </div>
          )}
          <div className="ap-sheet__actions">
            <Button block theme="light" onClick={() => setAction(null)}>取消</Button>
            <Button
              block
              theme="solid"
              type={action === 'reject' ? 'danger' : 'primary'}
              loading={actionMutation.isPending}
              onClick={() => void submitAction()}
            >
              确认{sheetTitle}
            </Button>
          </div>
        </div>
      </SideSheet>
    </PageShell>
  );
}
