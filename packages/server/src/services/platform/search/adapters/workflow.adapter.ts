import { eq, ilike, or } from 'drizzle-orm';
import { hasPermission, currentUser } from '../../../../lib/context';
import { getDataScopeCondition } from '../../../../lib/data-scope';
import { tenantCondition } from '../../../../lib/tenant';
import { buildWhere } from '../../../../lib/where-helpers';
import { db } from '../../../../db';
import { users, workflowDefinitions, workflowInstances } from '../../../../db/schema';
import type { GlobalSearchAdapter } from '../types';
import { likePattern, result } from '../helpers';

export const workflowSearchAdapter: GlobalSearchAdapter = {
  type: 'workflow',
  permissions: ['workflow:instance:list'],
  async search({ q, limit }) {
    if (!(await hasPermission('workflow:instance:list'))) return [];
    const user = currentUser();
    const pattern = likePattern(q);
    const monitor = await hasPermission('workflow:instance:monitor');
    const scope = monitor
      ? await getDataScopeCondition({ currentUserId: user.userId, deptColumn: users.departmentId, ownerColumn: workflowInstances.initiatorId })
      : eq(workflowInstances.initiatorId, user.userId);
    const rows = await db.select({
      id: workflowInstances.id,
      title: workflowInstances.title,
      serialNo: workflowInstances.serialNo,
      status: workflowInstances.status,
      definitionName: workflowDefinitions.name,
    })
      .from(workflowInstances)
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(users, eq(workflowInstances.initiatorId, users.id))
      .where(buildWhere(
        or(ilike(workflowInstances.title, pattern), ilike(workflowInstances.serialNo, pattern), ilike(workflowDefinitions.name, pattern))!,
        scope,
        tenantCondition(workflowInstances, user),
      ))
      .orderBy(workflowInstances.id)
      .limit(limit);
    return rows.map((row) => result({
      type: 'workflow',
      id: String(row.id),
      title: row.title,
      subtitle: [row.serialNo, row.definitionName].filter(Boolean).join(' · '),
      description: row.status,
      icon: 'Workflow',
      route: `/workflow/applications?keyword=${encodeURIComponent(row.title)}`,
      highlights: [{ field: 'title', text: row.title }],
    }));
  },
};
