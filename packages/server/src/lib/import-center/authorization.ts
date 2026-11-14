import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { db } from '../../db';
import { tenants, users } from '../../db/schema';
import { currentUser, hasPermission, runWithCurrentUser } from '../context';
import { isSuperAdmin, runWithFreshUserPermissions } from '../permissions';
import { isTenantActive } from '../tenant';
import type { JwtPayload } from '../../middleware/auth';
import type { TaskRunContext } from '../task-center/types';
import { TaskNonRetryableError } from '../task-center/types';
import { getImportDefinition } from './registry';

/** A queued import must use the creator's live identity and the persisted tenant scope. */
export async function withImportAuthorization<T>(task: Pick<TaskRunContext, 'tenantId' | 'payload'>, work: () => Promise<T>): Promise<T> {
  const userId = currentUser().userId;
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, username: true, tenantId: true, status: true },
    with: { userRoles: { columns: {}, with: { role: { columns: { code: true, status: true } } } } },
  });
  if (!user || user.status !== 'enabled') throw new TaskNonRetryableError('导入创建人已不存在或已停用');
  const payload: JwtPayload = { userId: user.id, username: user.username, tenantId: user.tenantId, roles: user.userRoles.filter(item => item.role.status === 'enabled').map(item => item.role.code) };
  if (isSuperAdmin(payload)) payload.viewingTenantId = task.tenantId;
  else if (user.tenantId !== task.tenantId) throw new TaskNonRetryableError('导入创建人的租户已变更，请重新提交');
  if (task.tenantId !== null) {
    const tenant = await db.query.tenants.findFirst({ where: eq(tenants.id, task.tenantId), columns: { status: true, expireAt: true } });
    if (!tenant || !isTenantActive(tenant)) throw new TaskNonRetryableError('导入所属租户已停用或到期');
  }
  return runWithCurrentUser(payload, () => runWithFreshUserPermissions(userId, async () => {
    const definition = getImportDefinition(String(task.payload.entity ?? ''));
    if (!await hasPermission(definition.permission)) throw new TaskNonRetryableError('导入权限已撤销，请重新申请权限');
    try { return await work(); } catch (error) {
      if (error instanceof HTTPException && error.status < 500) throw new TaskNonRetryableError(error.message, { cause: error });
      throw error;
    }
  }));
}
