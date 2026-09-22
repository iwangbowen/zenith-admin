import { and, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { canonicalEntityRefSchema, getDomainEventDefinition, isWatchableEntityType, watchedEntityDetailRoute } from '@zenith/shared/platform';
import { permissionList } from '@zenith/shared/core';
import type { DbTransaction } from '../../db/types';
import { domainEvents, domainEventSubjects, entityWatches, tenants, users, type EntityWatchRow } from '../../db/schema';
import { hasPermission, runWithCurrentUser } from '../../lib/context';
import { runWithFreshUserPermissions } from '../../lib/permissions';
import { checkSubjectLiveness, loadSubjectRow } from '../../lib/subject-liveness';
import { exactTenantCondition, isPlatformAdmin, isTenantActive } from '../../lib/tenant';
import { enabledGroupRolesWith, extractEnabledGroupRoles } from '../../lib/user-group-access';
import type { JwtPayload } from '../../middleware/auth';
import { resolveVisibleEntityAnchor } from './relations/registry';

export async function loadWatchPrincipal(watch: EntityWatchRow, tx: DbTransaction): Promise<JwtPayload | null> {
  const subject = await loadSubjectRow(watch.userId, tx);
  if (!checkSubjectLiveness(subject).ok || !subject) return null;
  const row = await tx.query.users.findFirst({ where: eq(users.id, watch.userId), columns: {}, with: {
    userRoles: { columns: {}, with: { role: { columns: { code: true, status: true, tenantId: true } } } },
    userGroupMembers: enabledGroupRolesWith({ columns: { code: true, status: true, tenantId: true } }),
  } });
  if (!row) return null;
  const roles = [...row.userRoles.map(({ role }) => role), ...extractEnabledGroupRoles(row.userGroupMembers).roles]
    .filter((role) => role.status === 'enabled' && (role.code !== 'super_admin' || role.tenantId === null)).map((role) => role.code);
  const user: JwtPayload = { userId: subject.id, username: subject.username, tenantId: subject.tenantId, roles };
  if (user.tenantId !== watch.tenantId && !isPlatformAdmin(user)) return null;
  if (watch.tenantId !== null) {
    const [tenant] = await tx.select({ status: tenants.status, expireAt: tenants.expireAt }).from(tenants).where(eq(tenants.id, watch.tenantId)).limit(1);
    if (!tenant || !isTenantActive(tenant)) return null;
  }
  return isPlatformAdmin(user) ? { ...user, viewingTenantId: watch.tenantId } : user;
}

/** Recheck current subject, feature, tenant, data scope and event/source access at each delivery boundary. */
export async function authorizeWatchedEvent(tx: DbTransaction, watch: EntityWatchRow, event: typeof domainEvents.$inferSelect) {
  if (!isWatchableEntityType(watch.entityType) || watch.tenantId !== event.tenantId || watch.createdAt > event.occurredAt) return null;
  const source = canonicalEntityRefSchema.safeParse({ type: event.sourceType, key: event.sourceKey });
  const watched = canonicalEntityRefSchema.safeParse({ type: watch.entityType, key: watch.entityKey });
  const definition = getDomainEventDefinition(event.eventType);
  if (!source.success || !watched.success || !definition?.summarySchema.safeParse(event.payload).success) return null;
  if (source.data.type !== watched.data.type || source.data.key !== watched.data.key) {
    const [subject] = await tx.select({ id: domainEventSubjects.eventId }).from(domainEventSubjects).where(and(
      eq(domainEventSubjects.eventId, event.id), eq(domainEventSubjects.entityType, watched.data.type), eq(domainEventSubjects.entityKey, watched.data.key),
      exactTenantCondition(domainEventSubjects.tenantId, watch.tenantId))).limit(1);
    if (!subject) return null;
  }
  const principal = await loadWatchPrincipal(watch, tx);
  if (!principal) return null;
  return runWithCurrentUser(principal, () => runWithFreshUserPermissions(principal.userId, async () => {
    if (!(await hasPermission(...permissionList(definition.permission)))) return null;
    try {
      const access = { db: tx, user: principal };
      const anchor = await resolveVisibleEntityAnchor(watched.data.type, watched.data.key, access);
      const eventSource = await resolveVisibleEntityAnchor(source.data.type, source.data.key, access);
      if (anchor.tenantId !== watch.tenantId || eventSource.tenantId !== watch.tenantId) return null;
      // Some related sources have no public detail route; the watched business detail always does.
      const link = watchedEntityDetailRoute(source.data) ?? watchedEntityDetailRoute(watched.data);
      return link ? { title: anchor.title, link, watched: watched.data, source: source.data } : null;
    } catch (error) {
      if (error instanceof HTTPException && [403, 404].includes(error.status)) return null;
      throw error;
    }
  }, tx));
}

export async function getCurrentWatch(tx: DbTransaction, watchId: number, tenantId: number | null) {
  const [watch] = await tx.select().from(entityWatches).where(and(eq(entityWatches.id, watchId), exactTenantCondition(entityWatches.tenantId, tenantId))).limit(1).for('share');
  return watch ?? null;
}
