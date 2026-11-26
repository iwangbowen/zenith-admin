import { and, eq, gt, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { mergeAccessPermissionItems, accessScopesOverlap } from '@zenith/shared/identity';
import { db } from '../../db';
import type { DbExecutor } from '../../db/types';
import { identityAccessGrants, identityAccessRequests } from '../../db/schema';
import { exactTenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';

export async function assertNoOverlappingAccessRequest(input: {
  targetUserId: number; tenantId: number | null; startsAt: Date; expiresAt: Date | null;
  items: Parameters<typeof mergeAccessPermissionItems>[0]; excludeRequestId?: number; excludeGrantItemId?: number;
}, executor: DbExecutor = db): Promise<void> {
  const requested = mergeAccessPermissionItems(input.items);
  if (!requested.length) return;
  const [grants, requests] = await Promise.all([
    executor.query.identityAccessGrants.findMany({
      where: buildWhere(eq(identityAccessGrants.userId, input.targetUserId), exactTenantCondition(identityAccessGrants.tenantId, input.tenantId), inArray(identityAccessGrants.status, ['scheduled', 'active']), input.expiresAt ? lt(identityAccessGrants.startsAt, input.expiresAt) : undefined, or(isNull(identityAccessGrants.expiresAt), gt(identityAccessGrants.expiresAt, input.startsAt))),
      with: { items: true },
    }),
    executor.query.identityAccessRequests.findMany({
      where: buildWhere(eq(identityAccessRequests.targetUserId, input.targetUserId), exactTenantCondition(identityAccessRequests.tenantId, input.tenantId),
        input.excludeRequestId ? ne(identityAccessRequests.id, input.excludeRequestId) : undefined,
        or(eq(identityAccessRequests.status, 'pending'), and(eq(identityAccessRequests.status, 'approved'), inArray(identityAccessRequests.provisionStatus, ['pending', 'running']))),
        input.expiresAt ? lt(identityAccessRequests.startsAt, input.expiresAt) : undefined, or(isNull(identityAccessRequests.expiresAt), gt(identityAccessRequests.expiresAt, input.startsAt))),
      with: { items: true },
    }),
  ]);
  const conflicts = new Set<string>();
  for (const wanted of requested) {
    const sameScope = (item: typeof grants[number]['items'][number] | typeof requests[number]['items'][number]) =>
      (item.menuId ?? null) === wanted.menuId && item.permissionCode === wanted.permissionCode && accessScopesOverlap(wanted, item);
    if (grants.some(grant => grant.items.some(item => item.id !== input.excludeGrantItemId && ['active', 'scheduled'].includes(item.status) && (!input.expiresAt || item.startsAt < input.expiresAt) && (!item.expiresAt || item.expiresAt > input.startsAt) && sameScope(item)))
      || requests.some(request => request.items.some(sameScope))) conflicts.add(wanted.pageTitle || wanted.permissionLabel || wanted.permissionCode);
  }
  if (conflicts.size) throw new HTTPException(409, { message: `以下权限已有有效授权或待处理申请，请勿重复申请：${[...conflicts].join('、')}` });
}
