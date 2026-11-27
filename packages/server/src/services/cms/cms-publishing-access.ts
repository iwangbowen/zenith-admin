import { CMS_PUBLISH_TASK_TYPES } from '@zenith/shared/cms';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { asyncTasks, cmsSites, cmsSiteUsers } from '../../db/schema';
import { currentUser, hasPermission } from '../../lib/context';
import { getTenantScopeId } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import type { AsyncTaskAccess } from '../tasks/public/access';
import { isCmsPlatformAdmin } from './cms-access';

export async function cmsPublishingTaskScopedWhere(access: AsyncTaskAccess = 'read'): Promise<SQL> {
  const user = currentUser();
  const platformGlobal = isCmsPlatformAdmin(user) && getTenantScopeId(user) === undefined;
  const write = access === 'manage' || access === 'remove';
  const permitted = await hasPermission(write ? 'cms:publish:manage' : 'cms:publish:view');
  if (!permitted || (isCmsPlatformAdmin(user) && !platformGlobal) || (access === 'remove' && !platformGlobal)) {
    return sql`false`;
  }

  const siteId = sql`${asyncTasks.payload}->>'siteId'`;
  const taskType = inArray(asyncTasks.taskType, [...CMS_PUBLISH_TASK_TYPES]);
  if (platformGlobal) {
    return buildWhere(
      taskType,
      access === 'own' ? eq(asyncTasks.createdBy, user.userId) : undefined,
      sql`exists (select 1 from ${cmsSites} where ${cmsSites.id}::text = ${siteId})`,
    )!;
  }
  return and(taskType, eq(asyncTasks.createdBy, user.userId), sql`exists (
    select 1 from ${cmsSiteUsers}
    where ${cmsSiteUsers.userId} = ${user.userId} and ${cmsSiteUsers.siteId}::text = ${siteId}
  )`)!;
}
