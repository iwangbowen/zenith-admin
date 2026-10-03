import { Space, Tag, Timeline, Typography } from '@douyinfe/semi-ui';
import { UserAvatar } from '@/components/UserAvatar';
import FileAttachment from '@/components/FileAttachment';
import { uploadedFileToAttachment } from '@/components/FileAttachment/utils';
import { timelineDot } from '@/components/workflow/timeline-dot';
import { TASK_STATUS_MAP } from '@/components/workflow/workflow-runtime';
import { WORKFLOW_INSTANCE_STATUS_LABELS, WORKFLOW_ACTIVE_INSTANCE_STATUSES, WORKFLOW_APPROVE_METHOD_LABELS, WORKFLOW_SIGN_POSITION_LABELS, WORKFLOW_TASK_WAIT_REASON_LABELS, WORKFLOW_PATH_STATUS_LABELS, workflowExternalCallbackContract } from '@zenith/shared/workflow';
import { Bot, CheckCircle2, Clock, CornerUpLeft, Flag, Mail, RotateCcw, XCircle, ExternalLink, Copy, Forward, UserCog, Send, type LucideIcon } from 'lucide-react';
import type { WorkflowTask, WorkflowInstanceStatus, WorkflowNodeActivation, WorkflowChildInstanceSummary, WorkflowPredictedPathNode } from '@zenith/shared/workflow';
import type { FlowNodeBrief } from '@/components/workflow/workflow-runtime';
import { formatDurationBetween } from '@/utils/date';
import DateTimeText from '@/components/DateTimeText';
import { copyTextWithToast } from '@/utils/clipboard';
import { urlOf } from '@/lib/contract-query';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const TRANSFER_ACTION_LABEL: Record<string, string> = {
  transfer: '转办',
  delegate: '委派',
  reassign: '管理员改派',
  handover: '离职交接',
  timeout: '超时转交',
};

/** 流程结束态 → 完成节点展示（文案统一来自 @zenith/shared，图标/图标色为时间线场景特化） */
const FINISH_MAP: Partial<Record<WorkflowInstanceStatus, { text: string; color: TagColor; icon: LucideIcon; iconColor: string }>> = {
  approved:  { text: WORKFLOW_INSTANCE_STATUS_LABELS.approved,  color: 'green',  icon: CheckCircle2, iconColor: 'var(--semi-color-success)' },
  rejected:  { text: WORKFLOW_INSTANCE_STATUS_LABELS.rejected,  color: 'red',    icon: XCircle,      iconColor: 'var(--semi-color-danger)' },
  withdrawn: { text: WORKFLOW_INSTANCE_STATUS_LABELS.withdrawn, color: 'amber',  icon: RotateCcw,    iconColor: 'var(--semi-color-warning)' },
  cancelled: { text: WORKFLOW_INSTANCE_STATUS_LABELS.cancelled, color: 'grey',   icon: XCircle,      iconColor: 'var(--semi-color-tertiary)' },
};

interface ApprovalTimelineProps {
  tasks: WorkflowTask[];
  approvalActivations?: WorkflowNodeActivation[];
  childInstances?: WorkflowChildInstanceSummary[];
  /** 服务端按当前活动节点预测的剩余路径；无预测时可传全量线性化节点。 */
  flowNodes?: Array<FlowNodeBrief & Omit<WorkflowPredictedPathNode, 'key' | 'name' | 'type'>>;
  /** 发起人信息（用于顶部「发起申请」节点） */
  initiator?: { name?: string | null; avatar?: string | null; submittedAt?: string | null };
  /** 实例状态（终态时展示底部「流程结束」节点） */
  instanceStatus?: WorkflowInstanceStatus;
  /** 流程结束时间 */
  finishedAt?: string | null;
  /** 当前登录人 ID：用于高亮「轮到你处理」的待办节点 */
  currentUserId?: number | null;
}

/** 计票只读取服务端的冻结席位结果，不把任务行、建议或加签人数当作基础票。 */
function buildNodeProgress(tasks: WorkflowTask[], activations: WorkflowNodeActivation[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const activation of activations) {
    if (activation.status !== 'active' || !activation.approveMethod || activation.baseTotal < 2) continue;
    const baseIds = new Set(activation.slots.filter((slot) => slot.origin === 'base').map((slot) => slot.id));
    const first = tasks.find((task) => task.activationId === activation.id && task.taskKind === 'approval' && task.slotId != null && baseIds.has(task.slotId));
    if (first) out.set(first.id, `${WORKFLOW_APPROVE_METHOD_LABELS[activation.approveMethod]} · 正式同意 ${activation.baseApproved}/${activation.baseTotal} · 需${activation.baseRequired}票`);
  }
  return out;
}

/** 审批流时间线，使用 Semi Design Timeline 组件统一渲染 */
export default function ApprovalTimeline({ tasks, approvalActivations = [], childInstances = [], flowNodes, initiator, instanceStatus, finishedAt, currentUserId }: Readonly<ApprovalTimelineProps>) {
  const sorted = [...tasks].sort((a, b) => a.id - b.id);
  const nodeProgress = buildNodeProgress(sorted, approvalActivations);

  // 退回目标来自当次决策事实，比例会签的部分拒绝不代表发生退回。
  const returnTargetMap = new Map<number, string>();
  for (const t of sorted) {
    if (t.decision?.action !== 'returnNode' && t.decision?.action !== 'returnInitiator') continue;
    if (t.decision.targetNodeName) returnTargetMap.set(t.id, t.decision.targetNodeName);
  }

  // 显式新轮才是重新审批，同轮的委派回执和其它基础席位不是新一轮。
  const regeneratedIds = new Set<number>();
  const firstActivationByNode = new Map<string, string>();
  for (const t of sorted) {
    if (t.taskKind === 'cc' || t.taskKind === 'excluded' || !t.activationId) continue;
    const first = firstActivationByNode.get(t.nodeKey);
    if (first && first !== t.activationId) regeneratedIds.add(t.id);
    else if (!first) firstActivationByNode.set(t.nodeKey, t.activationId);
  }

  const finish = instanceStatus ? FINISH_MAP[instanceStatus] : undefined;

  return (
    <Timeline className="wf-approval-timeline" style={{ paddingLeft: 4 }}>
      {initiator && (
        <Timeline.Item dot={timelineDot(Send, 'var(--semi-color-primary)')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>发起申请</Typography.Text>
            <Tag color="blue" size="small">已提交</Tag>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <UserAvatar name={initiator.name ?? '?'} avatar={initiator.avatar} semiSize="extra-extra-small" size={20} style={{ flexShrink: 0 }} />
            <Typography.Text size="small" type="tertiary" ellipsis={{ showTooltip: true }} style={{ minWidth: 0, flex: 1 }}>{initiator.name ?? '发起人'}</Typography.Text>
            {initiator.submittedAt && (
              <Typography.Text size="small" type="quaternary" style={{ marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>
                <DateTimeText value={initiator.submittedAt} />
              </Typography.Text>
            )}
          </div>
        </Timeline.Item>
      )}
      {tasks.map((task) => {
        const isApproved = task.status === 'approved';
        const isRejected = task.status === 'rejected';
        const isSkipped = task.status === 'skipped';
        const isCc = task.nodeType === 'ccNode';
        const isRegenerated = regeneratedIds.has(task.id);
        const returnTargetName = returnTargetMap.get(task.id);
        const isMine = task.status === 'pending' && currentUserId != null && task.assigneeId === currentUserId;

        // Semi Design Tokens — 自动适配暗色模式（CC 任务送达即完成：skipped 视作成功抄送）
        let iconColor = 'var(--semi-color-primary)';
        if (isApproved || (isCc && isSkipped)) iconColor = 'var(--semi-color-success)';
        else if (isRejected) iconColor = 'var(--semi-color-danger)';
        else if (isSkipped) iconColor = 'var(--semi-color-tertiary)';
        else if (isRegenerated) iconColor = 'var(--semi-color-warning)';

        let StatusIcon = Clock;
        if (isCc) StatusIcon = Mail;
        else if (isApproved) StatusIcon = CheckCircle2;
        else if (isRejected) StatusIcon = XCircle;
        else if (isRegenerated) StatusIcon = RotateCcw;

        // 系统自动执行的任务（自动通过/拒绝/异常兜底）：无处理人，comment 携带自动原因
        const isSystemAuto = task.assigneeId == null && !isCc && (isApproved || isRejected || isSkipped);

        let actionText: string;
        if (isCc) actionText = isSkipped || isApproved ? '已抄送' : '待抄送';
        else if (isApproved) actionText = isSystemAuto ? '自动通过' : '已同意';
        else if (isRejected) actionText = isSystemAuto ? '自动拒绝' : '已驳回';
        else if (isSkipped) actionText = '已跳过';
        else actionText = task.waitReason ? WORKFLOW_TASK_WAIT_REASON_LABELS[task.waitReason] : '待处理';
        if (task.taskKind === 'suggestion') actionText = isApproved ? '建议同意' : isRejected ? '建议拒绝' : '待提交建议';
        if (task.status === 'waiting' && task.waitReason === 'subprocess') {
          const children = childInstances.filter((child) => child.parentTaskId === task.id);
          actionText = !children.length ? '等待后台创建子流程'
            : children.some((child) => WORKFLOW_ACTIVE_INSTANCE_STATUSES.some((status) => status === child.status)) ? '等待子流程办理'
              : '等待后台汇聚子流程';
        }

        // 节点耗时：从任务生成（节点激活）到处理完成，仅对已同意/已驳回的处理节点展示
        const duration = (isApproved || isRejected) && task.actionAt && task.activatedAt
          ? formatDurationBetween(task.activatedAt, task.actionAt)
          : '';

        const dot = (
          <div style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            backgroundColor: isSkipped && !isCc ? 'var(--semi-color-fill-1)' : `color-mix(in srgb, ${iconColor} 10%, transparent)`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}>
            <StatusIcon size={15} color={iconColor} />
          </div>
        );

        return (
          <Timeline.Item key={task.id} dot={dot}>
            <div style={isMine ? {
              background: 'color-mix(in srgb, var(--semi-color-warning) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--semi-color-warning) 28%, transparent)',
              borderRadius: 'var(--semi-border-radius-medium)',
              padding: '8px 10px',
            } : undefined}>
            {/* 节点名称 + 状态 Tag：放不下时标签整体折到下一行，不挤压节点名称 */}
            <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '4px 8px', marginBottom: 6 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>{task.nodeName}</Typography.Text>
              {isMine && (
                <Tag color="amber" size="small">待你处理</Tag>
              )}
              {actionText && (
                <Tag color={TASK_STATUS_MAP[task.status]?.color ?? 'grey'} size="small">
                  {actionText}
                </Tag>
              )}
              {isRegenerated && (
                <Tag color="orange" size="small">重新审批</Tag>
              )}
              {task.signPosition && <Tag size="small">{WORKFLOW_SIGN_POSITION_LABELS[task.signPosition]}</Tag>}
              {duration && (
                <Typography.Text
                  size="small"
                  type="quaternary"
                  style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
                >
                  <Clock size={12} />耗时 {duration}
                </Typography.Text>
              )}
            </div>

            {/* 会签计票是节点级汇总，单独成行，不与任务状态争抢标题行宽度 */}
            {nodeProgress.has(task.id) && (
              <div style={{ marginBottom: 6 }}>
                <Tag color="light-blue" size="small" style={{ maxWidth: '100%' }}>{nodeProgress.get(task.id)}</Tag>
              </div>
            )}

            {/* 审批人 + 时间：姓名弹性省略，时间定长保单行不换行 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, marginBottom: task.comment ? 6 : 0 }}>
              {isSystemAuto ? (
                <span style={{
                  width: 20,
                  height: 20,
                  borderRadius: '50%',
                  backgroundColor: 'var(--semi-color-fill-1)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Bot size={12} color="var(--semi-color-text-2)" />
                </span>
              ) : (
                <UserAvatar
                  name={task.assigneeName ?? '?'}
                  avatar={isSkipped ? null : task.assigneeAvatar}
                  semiSize="extra-extra-small"
                  size={20}
                  style={isSkipped ? { backgroundColor: 'var(--semi-color-fill-2)', color: 'var(--semi-color-text-2)', flexShrink: 0 } : { flexShrink: 0 }}
                />
              )}
              <Typography.Text size="small" type="tertiary" ellipsis={{ showTooltip: true }} style={{ minWidth: 0, flex: 1 }}>
                {isSystemAuto ? '系统自动' : (task.assigneeName ?? '未指定')}
              </Typography.Text>
              {task.actionAt && (
                <Typography.Text size="small" type="quaternary" style={{ marginLeft: 'auto', whiteSpace: 'nowrap', flexShrink: 0 }}>
                  <DateTimeText value={task.actionAt} />
                </Typography.Text>
              )}
            </div>

            {/* 审批意见 */}
            {task.comment && (
              <div style={{
                marginTop: 6,
                padding: '8px 10px',
                backgroundColor: 'var(--semi-color-fill-0)',
                borderRadius: 'var(--semi-border-radius-medium)',
              }}>
                <Typography.Text size="small" type="secondary">{task.comment}</Typography.Text>
              </div>
            )}

            {task.attachments && task.attachments.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <FileAttachment mode="view" showTitle={false} value={task.attachments.map((a, i) => uploadedFileToAttachment(a, i))} />
              </div>
            )}

            {task.signature && (
              <div style={{ marginTop: 6 }}>
                <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginBottom: 2 }}>手写签名</Typography.Text>
                <img src={task.signature} alt="签名" style={{ maxHeight: 80, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-small)', background: '#fff' }} />
              </div>
            )}

            {/* 转办明细 / 委派提示 */}
            {((task.transfers?.length ?? 0) > 0 || task.delegatedFromId) && (
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                {(task.transfers ?? []).map((tr) => (
                  <Space key={tr.id} spacing={4} wrap>
                    <Forward size={12} />
                    <span>
                      {TRANSFER_ACTION_LABEL[tr.action] ?? tr.action}：{tr.fromUserName ?? '—'} → {tr.toUserName ?? `用户#${tr.toUserId}`}
                      {tr.reason ? `（${tr.reason}）` : ''}
                    </span>
                  </Space>
                ))}
                {task.delegatedFromId && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--semi-color-warning)' }}>
                    <UserCog size={12} />
                    <span>委派任务 · 反馈后回到原委派人</span>
                  </span>
                )}
              </div>
            )}

            {/* 驳回回退提示 */}
            {isRejected && returnTargetName && (
              <div style={{
                marginTop: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: 'var(--semi-color-warning)',
                fontSize: 12,
              }}>
                <CornerUpLeft size={12} />
                <span>已退回至「{returnTargetName}」重新审批</span>
              </div>
            )}

            {/* 外部审批信息 */}
            {task.externalCallbackId && (
              <div style={{
                marginTop: 8,
                padding: '8px 10px',
                backgroundColor: 'var(--semi-color-fill-0)',
                borderRadius: 'var(--semi-border-radius-medium)',
                fontSize: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <ExternalLink size={12} />
                  <Typography.Text size="small" strong>外部审批</Typography.Text>
                </div>
                <ExternalCallbackUrl callbackId={task.externalCallbackId} />
              </div>
            )}
            </div>
          </Timeline.Item>
        );
      })}
      {!finish && (() => {
        // 预测路径从当前执行位置出发；历史审批记录不能遮掉返工后将再次经过的节点。
        // 只有没有预测状态的全量结构回退才按已有任务去重。
        const doneKeys = new Set(tasks.map((t) => t.nodeKey));
        return (flowNodes ?? [])
          .filter((n) => n.status !== 'excluded' && (n.status != null || !doneKeys.has(n.key)))
          .map((n) => (
            <Timeline.Item key={`future-${n.key}`} dot={timelineDot(Clock, 'var(--semi-color-tertiary)')}>
              <Space spacing={8} wrap>
                <Typography.Text strong style={{ fontSize: 13, color: 'var(--semi-color-text-2)' }}>{n.name}</Typography.Text>
                <Tag color="grey" size="small">{n.type === 'cc' || n.type === 'ccNode' ? '待抄送' : (n.type === 'handler' ? '待办理' : '待审批')}</Tag>
                {n.status && <Tag color={n.status === 'unknown' ? 'orange' : 'blue'} size="small">{WORKFLOW_PATH_STATUS_LABELS[n.status]}</Tag>}
                {n.branchLabel && <Tag color="violet" size="small">{n.branchLabel}</Tag>}
              </Space>
              {(n.estimatedApprovers?.length ?? 0) > 0 && (
                <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginTop: 4 }}>
                  预计处理人：{n.estimatedApprovers?.map((approver) => approver.name).join('、')}
                </Typography.Text>
              )}
              {n.reason && (
                <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginTop: 4 }}>{n.reason}</Typography.Text>
              )}
              {n.approverReason && (
                <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginTop: 4 }}>{n.approverReason}</Typography.Text>
              )}
            </Timeline.Item>
          ));
      })()}
      {finish ? (
        <Timeline.Item dot={timelineDot(finish.icon, finish.iconColor)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>流程结束</Typography.Text>
            <Tag color={finish.color} size="small">{finish.text}</Tag>
            {finishedAt && (
              <Typography.Text size="small" type="quaternary" style={{ marginLeft: 'auto' }}>
                <DateTimeText value={finishedAt} />
              </Typography.Text>
            )}
          </div>
        </Timeline.Item>
      ) : (
        <Timeline.Item dot={timelineDot(Flag, 'var(--semi-color-tertiary)')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>流程结束</Typography.Text>
            <Tag color="grey" size="small">待完成</Tag>
          </div>
        </Timeline.Item>
      )}
    </Timeline>
  );
}

function ExternalCallbackUrl({ callbackId }: Readonly<{ callbackId: string }>) {
  const path = urlOf(workflowExternalCallbackContract.callback, { params: { callbackId } });
  const origin = globalThis.window === undefined ? '' : globalThis.window.location.origin;
  const fullUrl = `${origin}${path}`;
  const handleCopy = () => {
    void copyTextWithToast(fullUrl, { success: '已复制回调地址', error: '复制失败' });
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Typography.Text
        size="small"
        type="tertiary"
        ellipsis={{ rows: 1, showTooltip: { opts: { content: fullUrl } } }}
        style={{ flex: 1, fontFamily: 'monospace' }}
      >
        {fullUrl}
      </Typography.Text>
      <button
        type="button"
        onClick={handleCopy}
        title="复制"
        style={{
          border: 'none', background: 'transparent', cursor: 'pointer', padding: 2,
          display: 'inline-flex', alignItems: 'center', color: 'var(--semi-color-text-2)',
        }}
      >
        <Copy size={12} />
      </button>
    </div>
  );
}
