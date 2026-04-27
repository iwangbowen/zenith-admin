import { Avatar, Tag, Timeline, Typography } from '@douyinfe/semi-ui';
import { CheckCircle2, Clock, Mail, XCircle } from 'lucide-react';
import type { WorkflowTask } from '@zenith/shared';
import { formatDateTime } from '@/utils/date';

type TagColor = 'amber' | 'blue' | 'cyan' | 'green' | 'grey' | 'indigo' | 'light-blue' | 'light-green' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'violet' | 'yellow' | 'white';

const TASK_STATUS_MAP: Record<string, { text: string; color: TagColor }> = {
  pending:  { text: '待审批', color: 'blue'  },
  approved: { text: '已通过', color: 'green' },
  rejected: { text: '已驳回', color: 'red'   },
  skipped:  { text: '已跳过', color: 'grey'  },
};

/** 审批流时间线，使用 Semi Design Timeline 组件统一渲染 */
export default function ApprovalTimeline({ tasks }: Readonly<{ tasks: WorkflowTask[] }>) {
  return (
    <Timeline style={{ paddingLeft: 4 }}>
      {tasks.map((task) => {
        const isApproved = task.status === 'approved';
        const isRejected = task.status === 'rejected';
        const isSkipped = task.status === 'skipped';
        const isCc = task.nodeType === 'ccNode';

        // Semi Design Tokens — 自动适配暗色模式
        let iconColor = 'var(--semi-color-primary)';
        if (isApproved) iconColor = 'var(--semi-color-success)';
        else if (isRejected) iconColor = 'var(--semi-color-danger)';
        else if (isSkipped) iconColor = 'var(--semi-color-tertiary)';

        let StatusIcon = Clock;
        if (isApproved) StatusIcon = CheckCircle2;
        else if (isRejected) StatusIcon = XCircle;
        else if (isCc) StatusIcon = Mail;

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
            </div>

            {/* 审批人 + 时间 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: task.comment ? 6 : 0 }}>
              <Avatar
                size="extra-extra-small"
                style={{
                  backgroundColor: isSkipped ? 'var(--semi-color-fill-2)' : 'var(--semi-color-primary-light-active)',
                  flexShrink: 0,
                }}
                src={task.assigneeAvatar ?? undefined}
              >
                {(task.assigneeName ?? '?').charAt(0)}
              </Avatar>
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
                borderLeft: `3px solid ${iconColor}`,
              }}>
                <Typography.Text size="small" type="secondary">{task.comment}</Typography.Text>
              </div>
            )}
          </Timeline.Item>
        );
      })}
    </Timeline>
  );
}
