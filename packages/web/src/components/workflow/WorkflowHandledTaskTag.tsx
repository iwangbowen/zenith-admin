import { Tag, Tooltip } from '@douyinfe/semi-ui';
import { WORKFLOW_TASK_DECISION_LABELS, type WorkflowHandledInstanceItem } from '@zenith/shared/workflow';

export default function WorkflowHandledTaskTag({ task }: { task: WorkflowHandledInstanceItem['handledTask'] }) {
  const action = task.decision?.action;
  const returned = action === 'returnInitiator' || action === 'returnNode';
  const color = returned ? 'amber' : task.status === 'approved' ? 'green' : 'red';
  const label = action ? WORKFLOW_TASK_DECISION_LABELS[action] : task.status === 'approved' ? '已通过' : '已拒绝';
  const target = task.decision?.targetNodeName;
  const tag = <Tag color={color} size="small">{label}</Tag>;
  return target ? <Tooltip content={`退回至：${target}`}>{tag}</Tooltip> : tag;
}
