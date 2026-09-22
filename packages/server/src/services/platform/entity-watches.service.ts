import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { isWatchableEntityType, type CanonicalEntityRef } from '@zenith/shared/platform';
import { db } from '../../db';
import { entityWatches } from '../../db/schema';
import { currentUser, runWithCurrentUser } from '../../lib/context';
import { exactTenantCondition } from '../../lib/tenant';
import { resolveVisibleEntityAnchor } from './relations/registry';

export async function getEntityWatchState(ref: CanonicalEntityRef) {
  const user = currentUser();
  return db.transaction(async (tx) => {
    const anchor = await resolveVisibleEntityAnchor(ref.type, ref.key, { db: tx, user });
    const supported = isWatchableEntityType(ref.type);
    if (!supported) return { supported: false, watching: false };
    const [watch] = await tx.select({ id: entityWatches.id }).from(entityWatches).where(and(eq(entityWatches.userId, user.userId),
      eq(entityWatches.entityType, ref.type), eq(entityWatches.entityKey, ref.key), exactTenantCondition(entityWatches.tenantId, anchor.tenantId))).limit(1);
    return { supported, watching: Boolean(watch) };
  });
}

export async function changeEntityWatch(ref: CanonicalEntityRef, following: boolean) {
  const user = currentUser();
  if (user.impersonation) throw new HTTPException(403, { message: '模拟登录期间不能改变个人关注' });
  if (!isWatchableEntityType(ref.type)) throw new HTTPException(400, { message: '该对象暂无可关注的业务事件' });
  return runWithCurrentUser(user, () => db.transaction(async (tx) => {
    if (!following) {
      // A user may always cancel their own edge, even after losing access to its source object.
      await tx.delete(entityWatches).where(and(eq(entityWatches.userId, user.userId), eq(entityWatches.entityType, ref.type), eq(entityWatches.entityKey, ref.key)));
      return { supported: true, watching: false };
    }
    const anchor = await resolveVisibleEntityAnchor(ref.type, ref.key, { db: tx, user });
    await tx.insert(entityWatches).values({ userId: user.userId, entityType: ref.type, entityKey: ref.key, tenantId: anchor.tenantId }).onConflictDoNothing();
    return { supported: true, watching: true };
  }));
}
