/**
 * 结束节点
 */
import { WORKFLOW_INSTANCE_STATUS_LABELS } from '@zenith/shared';

// 文案统一来自 @zenith/shared；CSS 变量色为画布场景特化
const END_LABEL: Record<string, { text: string; color: string }> = {
  approved: { text: WORKFLOW_INSTANCE_STATUS_LABELS.approved, color: 'var(--semi-color-success)' },
  rejected: { text: WORKFLOW_INSTANCE_STATUS_LABELS.rejected, color: 'var(--semi-color-danger)' },
  withdrawn: { text: WORKFLOW_INSTANCE_STATUS_LABELS.withdrawn, color: 'var(--semi-color-warning)' },
  cancelled: { text: WORKFLOW_INSTANCE_STATUS_LABELS.cancelled, color: 'var(--semi-color-text-2)' },
};

export default function EndNode({ status }: Readonly<{ status?: string | null }>) {
  const meta = status ? END_LABEL[status] : null;
  return (
    <div className="fd-end-node">
      <div className="fd-end-node__circle" style={meta ? { borderColor: meta.color, color: meta.color } : undefined}>
        {meta ? meta.text : '结束'}
      </div>
    </div>
  );
}
