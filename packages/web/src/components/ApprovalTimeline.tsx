import { Tag, Timeline, Typography, Toast } from '@douyinfe/semi-ui';
import { UserAvatar } from '@/components/UserAvatar';
import { CheckCircle2, Clock, CornerUpLeft, Mail, RotateCcw, XCircle, ExternalLink, Copy, Forward, UserCog, Send, type LucideIcon } from 'lucide-react';
import type { WorkflowTask, WorkflowInstanceStatus } from '@zenith/shared';
import { formatDateTime, formatDurationBetween } from '@/utils/date';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const TASK_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  pending:  { text: '待审批', color: 'blue'  },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red'   },
  skipped:  { text: '已跳过', color: 'grey'  },
};

const EXT_DISPATCH_MAP: Record<string, { text: string; color: TagColor }> = {
  pending:    { text: '等待分派',  color: 'grey'   },
  dispatched: { text: '已分派',    color: 'blue'   },
  failed:     { text: '分派失败',  color: 'red'    },
  fallback:   { text: '已降级',    color: 'orange' },
};

/** 流程结束态 → 完成节点展示 */
const FINISH_MAP: Partial<Record<WorkflowInstanceStatus, { text: string; color: TagColor; icon: LucideIcon; iconColor: string }>> = {
  approved:  { text: '已通过', color: 'green',  icon: CheckCircle2, iconColor: 'var(--semi-color-success)' },
  rejected:  { text: '已驳回', color: 'red',    icon: XCircle,      iconColor: 'var(--semi-color-danger)' },
  withdrawn: { text: '已撤回', color: 'amber',  icon: RotateCcw,    iconColor: 'var(--semi-color-warning)' },
  cancelled: { text: '已取消', color: 'grey',   icon: XCircle,      iconColor: 'var(--semi-color-tertiary)' },
};

/** 统一的时间线圆点 */
function timelineDot(Icon: LucideIcon, iconColor: string) {
  return (
    <div style={{
      width: 28,
      height: 28,
      borderRadius: '50%',
      backgroundColor: `color-mix(in srgb, ${iconColor} 10%, transparent)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    }}>
      <Icon size={15} color={iconColor} />
    </div>
  );
}

interface ApprovalTimelineProps {
  tasks: WorkflowTask[];
  /** 发起人信息（用于顶部「发起申请」节点） */
  initiator?: { name?: string | null; avatar?: string | null; submittedAt?: string | null };
  /** 实例状态（终态时展示底部「流程结束」节点） */
  instanceStatus?: WorkflowInstanceStatus;
  /** 流程结束时间 */
  finishedAt?: string | null;
}

/** 审批流时间线，使用 Semi Design Timeline 组件统一渲染 */
export default function ApprovalTimeline({ tasks, initiator, instanceStatus, finishedAt }: Readonly<ApprovalTimelineProps>) {
  const sorted = [...tasks].sort((a, b) => a.id - b.id);

  // 为每个 rejected 任务定位"已回退至"的目标节点：取 id 严格大于当前任务、且非抄送节点的第一条后续任务
  const returnTargetMap = new Map<number, string>();
  for (const t of sorted) {
    if (t.status !== 'rejected') continue;
    const next = sorted.find(n => n.id > t.id && n.nodeType !== 'ccNode' && n.nodeKey !== t.nodeKey);
    if (next) returnTargetMap.set(t.id, next.nodeName);
  }

  // 标记"被驳回回退后重新推进"的任务：当存在 rejected 任务，且后续出现的同 nodeKey 或初始节点任务视为重新审批
  const regeneratedIds = new Set<number>();
  const seenNodeKeys = new Set<string>();
  let hasRejection = false;
  for (const t of sorted) {
    if (t.status === 'rejected') {
      hasRejection = true;
    } else if (hasRejection && seenNodeKeys.has(t.nodeKey)) {
      regeneratedIds.add(t.id);
    }
    seenNodeKeys.add(t.nodeKey);
  }

  const finish = instanceStatus ? FINISH_MAP[instanceStatus] : undefined;

  return (
    <Timeline style={{ paddingLeft: 4 }}>
      {initiator && (
        <Timeline.Item dot={timelineDot(Send, 'var(--semi-color-primary)')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>发起申请</Typography.Text>
            <Tag color="blue" size="small">已提交</Tag>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <UserAvatar name={initiator.name ?? '?'} avatar={initiator.avatar} semiSize="extra-extra-small" size={20} />
            <Typography.Text size="small" type="tertiary">{initiator.name ?? '发起人'}</Typography.Text>
            {initiator.submittedAt && (
              <Typography.Text size="small" type="quaternary" style={{ marginLeft: 'auto' }}>
                {formatDateTime(initiator.submittedAt)}
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

        // Semi Design Tokens — 自动适配暗色模式
        let iconColor = 'var(--semi-color-primary)';
        if (isApproved) iconColor = 'var(--semi-color-success)';
        else if (isRejected) iconColor = 'var(--semi-color-danger)';
        else if (isSkipped) iconColor = 'var(--semi-color-tertiary)';
        else if (isRegenerated) iconColor = 'var(--semi-color-warning)';

        let StatusIcon = Clock;
        if (isApproved) StatusIcon = CheckCircle2;
        else if (isRejected) StatusIcon = XCircle;
        else if (isCc) StatusIcon = Mail;
        else if (isRegenerated) StatusIcon = RotateCcw;

        let actionText: string;
        if (isApproved && !isCc) actionText = '已同意';
        else if (isRejected) actionText = '已驳回';
        else if (isSkipped) actionText = '已跳过';
        else if (isCc && isApproved) actionText = '已抄送';
        else actionText = '待处理';

        // 节点耗时：从任务生成（节点激活）到处理完成，仅对已同意/已驳回的处理节点展示
        const duration = (isApproved || isRejected) && task.actionAt
          ? formatDurationBetween(task.createdAt, task.actionAt)
          : '';

        const dot = (
          <div style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            backgroundColor: isSkipped ? 'var(--semi-color-fill-1)' : `color-mix(in srgb, ${iconColor} 10%, transparent)`,
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
            {/* 节点名称 + 状态 Tag */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <Typography.Text strong style={{ fontSize: 13 }}>{task.nodeName}</Typography.Text>
              {actionText && (
                <Tag color={TASK_STATUS_MAP[task.status]?.color ?? 'grey'} size="small" style={{ flexShrink: 0 }}>
                  {actionText}
                </Tag>
              )}
              {isRegenerated && (
                <Tag color="orange" size="small" style={{ flexShrink: 0 }}>重新审批</Tag>
              )}
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

            {/* 审批人 + 时间 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: task.comment ? 6 : 0 }}>
                <UserAvatar
                  name={task.assigneeName ?? '?'}
                  avatar={isSkipped ? null : task.assigneeAvatar}
                  semiSize="extra-extra-small"
                  size={20}
                  style={isSkipped ? { backgroundColor: 'var(--semi-color-fill-2)', color: 'var(--semi-color-text-2)' } : undefined}
                />
              <Typography.Text size="small" type="tertiary">
                {task.assigneeName ?? '未指定'}
              </Typography.Text>
              {task.actionAt && (
                <Typography.Text size="small" type="quaternary" style={{ marginLeft: 'auto' }}>
                  {formatDateTime(task.actionAt)}
                </Typography.Text>
              )}
            </div>

            {/* 审批意见 */}
            {task.comment && (
              <div style={{
                marginTop: 6,
                padding: '8px 10px',
                backgroundColor: 'var(--semi-color-fill-0)',
                borderRadius: 6,
              }}>
                <Typography.Text size="small" type="secondary">{task.comment}</Typography.Text>
              </div>
            )}

            {task.signature && (
              <div style={{ marginTop: 6 }}>
                <Typography.Text size="small" type="tertiary" style={{ display: 'block', marginBottom: 2 }}>手写签名</Typography.Text>
                <img src={task.signature} alt="签名" style={{ maxHeight: 80, border: '1px solid var(--semi-color-border)', borderRadius: 4, background: '#fff' }} />
              </div>
            )}

            {/* 转办链路 / 委派提示 */}
            {((task.transferChain?.length ?? 0) > 0 || task.delegatedFromId) && (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                {(task.transferChain?.length ?? 0) > 0 && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Forward size={12} />
                    <span>已经手 {task.transferChain!.length} 人</span>
                  </span>
                )}
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
                borderRadius: 6,
                fontSize: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <ExternalLink size={12} />
                  <Typography.Text size="small" strong>外部审批</Typography.Text>
                  {task.externalDispatchStatus && (
                    <Tag color={EXT_DISPATCH_MAP[task.externalDispatchStatus]?.color ?? 'grey'} size="small">
                      {EXT_DISPATCH_MAP[task.externalDispatchStatus]?.text ?? task.externalDispatchStatus}
                    </Tag>
                  )}
                </div>
                <ExternalCallbackUrl callbackId={task.externalCallbackId} />
              </div>
            )}
          </Timeline.Item>
        );
      })}
      {finish && (
        <Timeline.Item dot={timelineDot(finish.icon, finish.iconColor)}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Typography.Text strong style={{ fontSize: 13 }}>流程结束</Typography.Text>
            <Tag color={finish.color} size="small">{finish.text}</Tag>
            {finishedAt && (
              <Typography.Text size="small" type="quaternary" style={{ marginLeft: 'auto' }}>
                {formatDateTime(finishedAt)}
              </Typography.Text>
            )}
          </div>
        </Timeline.Item>
      )}
    </Timeline>
  );
}

function ExternalCallbackUrl({ callbackId }: Readonly<{ callbackId: string }>) {
  const path = `/api/public/workflow/external-callback/${callbackId}`;
  const origin = globalThis.window === undefined ? '' : globalThis.window.location.origin;
  const fullUrl = `${origin}${path}`;
  const handleCopy = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(fullUrl).then(
        () => Toast.success('已复制回调地址'),
        () => Toast.error('复制失败'),
      );
    }
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
