// ─── 审批人运行时策略（去重/同发起人替换/管理员兜底）（拆分自 workflow-instances.service.ts）───
import { eq, ne, and, desc, sql, type SQL } from 'drizzle-orm';
import { workflowTasks } from '../../../db/schema';
import { type TaskAction } from '../../../lib/workflow-engine';
import type { WorkflowFlowData } from '@zenith/shared/workflow';
import { applyRuntimeAssigneePolicy } from '../runtime/assignee-policy';
import { resolveAssigneeIds } from '../workflow-assignee-resolver.service';
import type { DbExecutor } from '../../../db/types';

export { type AssigneeRuntimeResult, type AssigneeEmptiedReason, type AssigneeRuntimeOutcome } from '../runtime/assignee-policy';

export async function applyAssigneeRuntimeStrategies(
  task: TaskAction, userIds: number[],
  ctx: { instanceId: number; initiatorId: number; executor: DbExecutor; formData?: Record<string, unknown>; settings?: WorkflowFlowData['settings'] },
) {
  return applyRuntimeAssigneePolicy(task, userIds, {
    initiatorId: ctx.initiatorId, settings: ctx.settings,
    resolve: config => resolveAssigneeIds(config, { initiatorId: ctx.initiatorId, executor: ctx.executor, formData: ctx.formData, instanceId: ctx.instanceId }),
    collectDedup: (mode, nodeKey) => collectDedupApprovers(ctx.executor, ctx.instanceId, mode, nodeKey),
  });
}

/**
 * 当前轮次起点：最近一次「退回发起人」（decision.action=returnInitiator）的表态时间。
 * 退回重提是同一实例「重新从头走流程」（发起人可能已修改单据），上一轮表态不构成新一轮的
 * 「前序已审批」——否则重提后原审批人会被跨轮去重剔除、任务兜底转管理员，申请人等不到原
 * 审批人复核修改结果。轮次起点与过滤条件全部在 SQL 侧比较：时间值经 JS Date 往返会被截断到
 * 毫秒精度（库内为微秒），回传参数还会受进程本地时区影响，不得参与此类判定。
 */
function currentRoundStartExpr(instanceId: number): SQL {
  return sql`coalesce((select ${workflowTasks.actionAt} from ${workflowTasks}
    where ${workflowTasks.instanceId} = ${instanceId} and ${workflowTasks.decision}->>'action' = 'returnInitiator'
    order by ${workflowTasks.actionAt} desc limit 1), '-infinity'::timestamptz)`;
}

/** 收集需要去重的「前序已审批」处理人集合（限定当前轮次内，见 currentRoundStartExpr） */
async function collectDedupApprovers(
  exec: DbExecutor,
  instanceId: number,
  mode: 'all' | 'consecutive',
  currentNodeKey: string,
): Promise<Set<number>> {
  // 节点重入（撤回重审 / 退回节点 / 退回重提重走）后，该节点上一轮的表态已作废（“新轮次独立计票，
  // 旧意见仅用于追溯”）：不回入去重集合，否则重入节点会被自己的旧意见去重剔除、兜底转管理员。
  const supersededNode = ne(workflowTasks.nodeKey, currentNodeKey);
  if (mode === 'all') {
    // 去重当前轮次内所有已审批人（含抄送，保持既有行为）
    const rows = await exec.select({ assigneeId: workflowTasks.assigneeId }).from(workflowTasks)
      .where(and(
        eq(workflowTasks.instanceId, instanceId),
        eq(workflowTasks.status, 'approved'),
        supersededNode,
        sql`${workflowTasks.actionAt} > ${currentRoundStartExpr(instanceId)}`,
      ));
    return new Set(rows.map((row) => row.assigneeId).filter((id): id is number => typeof id === 'number'));
  }
  // consecutive：仅取「紧邻的前一个审批节点」（排除抄送）的处理人
  const rows = await exec
    .select({ nodeKey: workflowTasks.nodeKey, assigneeId: workflowTasks.assigneeId })
    .from(workflowTasks)
    .where(and(
      eq(workflowTasks.instanceId, instanceId),
      eq(workflowTasks.status, 'approved'),
      ne(workflowTasks.nodeType, 'ccNode'),
      supersededNode,
      sql`${workflowTasks.actionAt} > ${currentRoundStartExpr(instanceId)}`,
    ))
    .orderBy(desc(workflowTasks.id));
  const lastNodeKey = rows[0]?.nodeKey;
  if (!lastNodeKey) return new Set();
  return new Set(
    rows
      .filter((row) => row.nodeKey === lastNodeKey)
      .map((row) => row.assigneeId)
      .filter((id): id is number => typeof id === 'number'),
  );
}
