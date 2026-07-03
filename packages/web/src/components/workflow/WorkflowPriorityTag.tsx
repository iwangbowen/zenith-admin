/* eslint-disable react-refresh/only-export-components */
import { Tag } from '@douyinfe/semi-ui';
import type { WorkflowInstancePriority } from '@zenith/shared';

export const WORKFLOW_PRIORITY_OPTIONS: Array<{ label: string; value: WorkflowInstancePriority }> = [
  { label: '低', value: 'low' },
  { label: '普通', value: 'normal' },
  { label: '高', value: 'high' },
  { label: '加急', value: 'urgent' },
];

const PRIORITY_META: Record<WorkflowInstancePriority, { text: string; color: 'red' | 'orange' | 'grey' } | null> = {
  urgent: { text: '加急', color: 'red' },
  high: { text: '高', color: 'orange' },
  normal: null,
  low: null,
};

/** 加急/优先级标签：normal/low 不展示，high/urgent 展示彩色标签 */
export default function WorkflowPriorityTag({ priority }: Readonly<{ priority?: WorkflowInstancePriority | null }>) {
  const meta = priority ? PRIORITY_META[priority] : null;
  if (!meta) return <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>;
  return <Tag color={meta.color} size="small">{meta.text}</Tag>;
}
