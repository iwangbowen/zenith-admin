import { Avatar, Tag, Timeline, Typography, Toast } from '@douyinfe/semi-ui';
import { CheckCircle2, Clock, CornerUpLeft, Mail, RotateCcw, XCircle, ExternalLink, Copy, Forward, UserCog } from 'lucide-react';
import type { WorkflowTask } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';

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

/** 审批流时间线，使用 Semi Design Timeline 组件统一渲染 */
export default function ApprovalTimeline({ tasks }: Readonly<{ tasks: WorkflowTask[] }>) {
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

  return (
    <Timeline style={{ paddingLeft: 4 }}>
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

        let actionText = '';
        if (isApproved && !isCc) actionText = '已同意';
        else if (isRejected) actionText = '已驳回';
        else if (isSkipped) actionText = '已跳过';
        else if (isCc && isApproved) actionText = '已抄送';
        else actionText = '待处理';

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
            </div>

            {/* 审批人 + 时间 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: task.comment ? 6 : 0 }}>
              {(() => {
                let avatarBg: string | undefined;
                if (isSkipped) avatarBg = 'var(--semi-color-fill-2)';
                else if (!task.assigneeAvatar) avatarBg = 'var(--semi-color-primary)';
                return (
                  <Avatar
                    size="extra-extra-small"
                    style={{ backgroundColor: avatarBg, color: '#fff', flexShrink: 0 }}
                    src={task.assigneeAvatar ?? undefined}
                  >
                    {(task.assigneeName ?? '?').charAt(0)}
                  </Avatar>
                );
              })()}
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
