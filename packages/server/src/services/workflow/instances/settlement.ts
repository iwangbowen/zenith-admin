import { and, eq, inArray } from 'drizzle-orm';
import { workflowInstances, workflowTasks } from '../../../db/schema';
import type { DbExecutor } from '../../../db/types';
import { cancelJobs, WORKFLOW_ADVANCING_JOB_TYPES } from '../../../lib/workflow-jobs/engine';
import { bridgeReportFillWorkflowOutcome } from '../../report/report-fill-workflow-bridge.service';
import { killInstanceTokens } from './materialize';
import { enqueueSubprocessJoin } from './async-jobs';

type InstanceRow = typeof workflowInstances.$inferSelect;
type TaskRow = typeof workflowTasks.$inferSelect;
type FillBridgeResult = Awaited<ReturnType<typeof bridgeReportFillWorkflowOutcome>>;

/** 事务内落定实例终态：驳回时清理全部活动任务 / token，更新实例状态并触发报表填报桥接 */
export async function settleInstanceInTx(
  tx: DbExecutor,
  instanceId: number,
  opts: {
    outcome: 'approved' | 'rejected';
    actorId: number;
    comment?: string | null;
    outcomeReason?: string;
  },
): Promise<{ row: InstanceRow; fillBridge: FillBridgeResult; skippedTasks: TaskRow[] }> {
  // 每条拒绝终止路径都必须清场，不让调用方分别选择任务 / token 清理而遗漏并行分支。
  const skippedTasks = opts.outcome === 'rejected'
    ? await tx.update(workflowTasks)
      .set({ status: 'skipped', actionAt: new Date(), comment: '[流程驳回] 流程已被驳回终止，本待办作废' })
      .where(and(eq(workflowTasks.instanceId, instanceId), inArray(workflowTasks.status, ['pending', 'waiting'])))
      .returning()
    : [];
  if (opts.outcome === 'rejected') await killInstanceTokens(tx, instanceId);
  // 终态清场：取消仍在途的推进类作业（延时唤醒/超时/触发器/外部派发/子流程），避免作业苏醒后推进已终结实例
  await cancelJobs({ instanceId, jobTypes: WORKFLOW_ADVANCING_JOB_TYPES }, tx);
  const [row] = await tx.update(workflowInstances)
    .set({ status: opts.outcome, currentNodeKey: null, outcomeReason: opts.outcomeReason ?? (opts.outcome === 'approved' ? 'business_approved' : 'business_rejected') })
    .where(eq(workflowInstances.id, instanceId))
    .returning();
  const fillBridge = await bridgeReportFillWorkflowOutcome(tx, {
    workflowInstanceId: instanceId,
    outcome: opts.outcome,
    actorId: opts.actorId,
    comment: opts.comment ?? null,
  });
  await enqueueSubprocessJoin(row, tx);
  return { row, fillBridge, skippedTasks };
}



