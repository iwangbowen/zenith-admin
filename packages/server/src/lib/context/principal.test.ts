import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { contextStorage } from 'hono/context-storage';
import type { AuthEnv, JwtPayload } from '../../middleware/auth';
import {
  currentUser, currentUserOrNull, currentTenantId, effectiveTenantId,
  isSuperAdmin, runWithCmsOpenApiAccess, runWithCurrentUser,
} from './principal';
import { currentAuditUserId, runAsUser } from '../audit-context';

const principal = (userId: number, tenantId: number | null): JwtPayload => ({
  userId, username: `user-${userId}`, roles: [], tenantId,
} as JwtPayload);

describe('request principal isolation', () => {
  it('does not require a request or database for explicit worker identities', async () => {
    expect(currentUserOrNull()).toBeUndefined();
    expect(() => currentUser()).toThrow('authenticated request');
    await runWithCurrentUser(principal(1, 3), async () => {
      expect(currentUser().userId).toBe(1);
      expect(currentTenantId()).toBe(3);
      expect(currentAuditUserId()).toBe(1);
      await runAsUser(9, async () => expect(currentAuditUserId()).toBe(9));
      expect(currentAuditUserId()).toBe(1);
    });
    expect(currentAuditUserId()).toBeNull();
  });

  it('keeps concurrent worker identities and tenant views independent', async () => {
    const ready = Promise.withResolvers<void>();
    await Promise.all([
      runWithCurrentUser({ ...principal(1, null), viewingTenantId: 7 }, async () => {
        ready.resolve();
        await Promise.resolve();
        expect(currentUser().userId).toBe(1);
        expect(effectiveTenantId()).toBe(7);
      }),
      runWithCurrentUser(principal(2, 8), async () => {
        await ready.promise;
        expect(currentUser().userId).toBe(2);
        expect(effectiveTenantId()).toBe(8);
      }),
    ]);
    expect(currentUserOrNull()).toBeUndefined();
  });

  it('reads authenticated HTTP identity and prevents open API privilege borrowing', async () => {
    const app = new Hono<AuthEnv>();
    app.use('*', contextStorage());
    app.use('*', async (c, next) => {
      c.set('user', { ...principal(4, null), roles: ['super_admin'] });
      await next();
    });
    app.get('/', async c => {
      expect(isSuperAdmin()).toBe(true);
      const openPrivilege = await runWithCmsOpenApiAccess({
        clientId: 'test', siteId: 1, channelIds: [], permissions: [],
      }, async () => isSuperAdmin());
      return c.json({ userId: currentUser().userId, openPrivilege });
    });
    expect(await (await app.request('/')).json()).toEqual({ userId: 4, openPrivilege: false });
  });
});
