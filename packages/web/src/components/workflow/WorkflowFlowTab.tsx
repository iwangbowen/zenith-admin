/**
 * 流程图 + 节点列表组合页签
 *
 * 发起抽屉（预测态，无 tasks）与审批/详情抽屉（运行态，带 tasks）共用：
 * 上方渲染只读流程图，下方线性化节点列表（叠加运行态状态/处理人/时间）。
 */
import { Divider, Typography } from '@douyinfe/semi-ui';
import type { WorkflowTask } from '@zenith/shared';
import WorkflowGraphView from './WorkflowGraphView';
import WorkflowNodeListView from './WorkflowNodeListView';

interface Props {
  flowData: { process?: unknown } | null | undefined;
  tasks?: WorkflowTask[];
  /** 实例状态（运行态 start/end 节点标识） */
  instanceStatus?: string;
  /** 发起人（详情传真实发起人；发起预览传当前用户作为预期发起人） */
  initiator?: { name?: string | null; avatar?: string | null; submittedAt?: string | null };
}

export default function WorkflowFlowTab({ flowData, tasks, instanceStatus, initiator }: Readonly<Props>) {
  return (
    <>
      <WorkflowGraphView flowData={flowData} tasks={tasks} instanceStatus={instanceStatus} />
      <Divider align="left" margin="16px">
        <Typography.Text type="tertiary" size="small">节点列表</Typography.Text>
      </Divider>
      <WorkflowNodeListView flowData={flowData} tasks={tasks} initiator={initiator} />
    </>
  );
}
