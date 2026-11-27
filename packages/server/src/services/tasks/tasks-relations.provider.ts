import { asyncTasks } from '../../db/schema';
import { runWithCurrentUser } from '../../lib/context';
import { buildWhere } from '../../lib/where-helpers';
import { anchorIdsWhere, numericAnchorResolver } from '../platform/relations/anchor-batch';
import type { EntityAnchorResolver, RelationAccessContext, VisibleEntityAnchor } from '../platform/relations/types';
import { asyncTaskScopedWhere } from './public/access';

async function resolveAsyncTasks(ids: number[], access: RelationAccessContext): Promise<VisibleEntityAnchor[]> {
  return runWithCurrentUser(access.user, async () => {
    const scope = await asyncTaskScopedWhere();
    const rows = await access.db.select({ id: asyncTasks.id, title: asyncTasks.title, tenantId: asyncTasks.tenantId })
      .from(asyncTasks).where(buildWhere(anchorIdsWhere(asyncTasks.id, ids), scope)).limit(ids.length);
    return rows.map((row): VisibleEntityAnchor => ({ ref: { type: 'tasks.async', key: String(row.id) }, title: row.title, tenantId: row.tenantId }));
  });
}

export const taskAnchorResolvers: readonly EntityAnchorResolver[] = [numericAnchorResolver('tasks.async', resolveAsyncTasks)];
