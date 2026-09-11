// ─── 审计前置数据读取（拆分自 workflow-instances.service.ts）───
import { eq, and } from 'drizzle-orm';
import { db } from '../../../db';
import { workflowTasks } from '../../../db/schema';
import { currentUser } from '../../../lib/context';
import { mapInstance } from './mapping';
import { getInstanceDetail } from './queries';
import { findVisibleInstance } from './shared';

export async function getWorkflowInstanceBeforeAudit(id: number) {
  try {
    return await getInstanceDetail(id);
  } catch {
    return null;
  }
}

export async function getWorkflowTaskBeforeAudit(taskId: number) {
  const user = currentUser();
  const [task] = await db
    .select({ instanceId: workflowTasks.instanceId })
    .from(workflowTasks)
    .where(and(eq(workflowTasks.id, taskId), eq(workflowTasks.assigneeId, user.userId)))
    .limit(1);
  if (!task) return null;
  return getWorkflowInstanceBeforeAudit(task.instanceId);
}

export async function getWorkflowTaskForAdminAudit(taskId: number) {
  const [task] = await db
    .select({ instanceId: workflowTasks.instanceId })
    .from(workflowTasks)
    .where(eq(workflowTasks.id, taskId))
    .limit(1);
  if (!task) return null;
  return getInstanceForAdminAudit(task.instanceId);
}

/** 监控页管理员操作的审计前置快照（不做发起人/审批人权限校验） */
export async function getInstanceForAdminAudit(id: number) {
  const inst = await findVisibleInstance(id);
  return inst ? mapInstance(inst) : null;
}
