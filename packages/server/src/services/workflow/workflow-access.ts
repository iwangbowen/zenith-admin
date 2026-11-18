import { eq, exists, isNull, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { users, workflowInstances, workflowJobs } from '../../db/schema';
import { currentUser, hasPermission } from '../../lib/context';
import { getDataScopeCondition } from '../../lib/data-scope';
import { isPlatformAdmin, tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';

/** Monitor access is distinct from participant access; all projections share this predicate. */
export async function workflowMonitorScope(executor: DbExecutor = db): Promise<SQL | undefined> {
  const user = currentUser();
  const scope = await getDataScopeCondition({ currentUserId: user.userId, deptColumn: users.departmentId, ownerColumn: workflowInstances.initiatorId });
  return buildWhere(tenantCondition(workflowInstances, user), scope
    ? exists(executor.select({ id: users.id }).from(users).where(buildWhere(eq(users.id, workflowInstances.initiatorId), scope)))
    : undefined);
}

export async function canMonitorWorkflowInstance(id: number, executor: DbExecutor = db): Promise<boolean> {
  const rows = await executor.select({ id: workflowInstances.id }).from(workflowInstances)
    .where(buildWhere(eq(workflowInstances.id, id), await workflowMonitorScope(executor))).limit(1);
  return rows.length > 0;
}

export async function requireMonitorWorkflowInstance(id: number, executor: DbExecutor = db) {
  const [row] = await executor.select().from(workflowInstances)
    .where(buildWhere(eq(workflowInstances.id, id), await workflowMonitorScope(executor))).limit(1);
  if (!row) throw new HTTPException(404, { message: '实例不存在或不在授权范围内' });
  return row;
}

export async function workflowJobScope(executor: DbExecutor = db): Promise<SQL | undefined> {
  const user = currentUser();
  const instances = executor.select({ id: workflowInstances.id }).from(workflowInstances)
    .where(buildWhere(eq(workflowInstances.id, workflowJobs.instanceId), await workflowMonitorScope(executor)));
  const platform = isPlatformAdmin(user) && user.viewingTenantId == null && await hasPermission('workflow:engine:platform');
  return buildWhere(tenantCondition(workflowJobs, user), or(exists(instances), platform ? isNull(workflowJobs.instanceId) : sql`false`));
}

export async function requirePlatformWorkflowAccess(): Promise<void> {
  const user = currentUser();
  if (!isPlatformAdmin(user) || user.viewingTenantId != null || !await hasPermission('workflow:engine:platform')) {
    throw new HTTPException(403, { message: '需要平台流程观测权限并切换到平台视角' });
  }
}
