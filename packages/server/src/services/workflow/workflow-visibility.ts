import { and, eq, exists, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '../../db/types';
import { workflowInstances, workflowTasks } from '../../db/schema';
import { hasPermission } from '../../lib/context';

/** Match instance-detail participant rules without fetching form snapshots; ancestors remain tenant-bound. */
export async function workflowVisibility(access: { user: { userId: number }; db: DbExecutor }) {
  if (await hasPermission('workflow:instance:monitor')) return undefined;
  return or(
    eq(workflowInstances.initiatorId, access.user.userId),
    exists(access.db.select({ id: workflowTasks.id }).from(workflowTasks).where(and(
      eq(workflowTasks.instanceId, workflowInstances.id), eq(workflowTasks.assigneeId, access.user.userId),
    )).limit(1)),
    sql`exists (
      with recursive ancestors as (
        select parent.id, parent.initiator_id, parent.parent_instance_id, 1 as depth
        from workflow_instances parent
        where parent.id = ${workflowInstances.parentInstanceId}
          and parent.tenant_id is not distinct from ${workflowInstances.tenantId}
        union all
        select parent.id, parent.initiator_id, parent.parent_instance_id, ancestors.depth + 1
        from workflow_instances parent join ancestors on parent.id = ancestors.parent_instance_id
        where ancestors.depth < 10
          and parent.tenant_id is not distinct from ${workflowInstances.tenantId}
      ) select 1 from ancestors where initiator_id = ${access.user.userId}
    )`,
  );
}

/** Running instances need attention only when a real pending approval task exists. */
export function workflowInstanceAttention(access: { db: DbExecutor }) {
  return and(eq(workflowInstances.status, 'running'), exists(access.db.select({ id: workflowTasks.id }).from(workflowTasks)
    .where(and(eq(workflowTasks.instanceId, workflowInstances.id), eq(workflowTasks.status, 'pending')))));
}
