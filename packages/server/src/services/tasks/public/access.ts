import { CMS_PUBLISH_TASK_TYPES } from '@zenith/shared/cms';
import type { AsyncTask } from '@zenith/shared/tasks';
import { eq, isNotNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { config } from '../../../config';
import { asyncTasks } from '../../../db/schema';
import { currentUser, hasPermission } from '../../../lib/context';
import { getTenantScopeId, optionalExactTenantCondition } from '../../../lib/tenant';
import { buildWhere } from '../../../lib/where-helpers';

export type AsyncTaskAccess = 'own' | 'read' | 'manage' | 'remove';

interface CmsTaskPolicy {
  where(access: AsyncTaskAccess): Promise<SQL>;
  retry(id: number, action: 'resume' | 'restart'): Promise<AsyncTask>;
}

let cmsPublishingPolicy: CmsTaskPolicy | undefined;

export function registerCmsPublishingTaskPolicy(policy: CmsTaskPolicy): void {
  if (cmsPublishingPolicy) throw new Error('CMS publishing task policy is already registered');
  cmsPublishingPolicy = policy;
}

export function retryCmsPublishingTask(id: number, action: 'resume' | 'restart'): Promise<AsyncTask> {
  if (!cmsPublishingPolicy) throw new HTTPException(404, { message: '任务不存在或无权访问' });
  return cmsPublishingPolicy.retry(id, action);
}

export function requireGlobalTaskScope(): void {
  if (config.multiTenantMode && getTenantScopeId(currentUser()) !== undefined) {
    throw new HTTPException(403, { message: '仅平台全局视角可以管理全局任务策略' });
  }
}

export async function asyncTaskScopedWhere(access: AsyncTaskAccess = 'read'): Promise<SQL> {
  const user = currentUser();
  const tenantId = getTenantScopeId(user);
  const write = access === 'manage' || access === 'remove';
  const canOperate = access !== 'own' && await hasPermission(write ? 'system:async-task:manage' : 'system:async-task:list');
  if (access === 'remove' && !canOperate) return sql`false`;
  const standard = buildWhere(
    notInArray(asyncTasks.taskType, [...CMS_PUBLISH_TASK_TYPES]),
    optionalExactTenantCondition(asyncTasks.tenantId, tenantId),
    canOperate ? undefined : eq(asyncTasks.createdBy, user.userId),
    write && tenantId !== undefined ? isNotNull(asyncTasks.createdBy) : undefined,
  )!;
  const cms = await cmsPublishingPolicy?.where(access);
  return cms ? or(standard, cms)! : standard;
}
