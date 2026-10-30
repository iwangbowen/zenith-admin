import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { oauth2Clients, openQuotaAlerts, users } from '../../db/schema';
import { registerEventConsumer, wakeEventConsumers } from '../../lib/domain-events';
import { notifyWithin } from '../messaging/notification-outbox.service';
import { publishOpenEventInTx } from './open-events.service';
import redis from '../../lib/redis';
import { config } from '../../config';

let registered = false;
export function registerQuotaNotificationConsumer(): void {
  if (registered) return;
  registerEventConsumer({ key: 'open.quota.notification', matches: (event) => event.eventType === 'app.quota.warning',
    handle: async (tx, event) => {
      const context = event.payload.context as { ownerId: number | null; ownerTenantId: number | null; appName: string };
      if (!context?.ownerId) return { outcome: 'skipped', reason: 'application_has_no_owner' };
      const data = event.payload.data as { threshold: number; dimension: string; used: number; limit: number };
      await notifyWithin(tx, 'open-platform.quota.threshold_exceeded', {
        recipients: [{ type: 'user', id: context.ownerId }], tenantId: context.ownerTenantId,
        vars: { threshold: data.threshold, appName: context.appName, dimensionText: data.dimension === 'daily' ? '每日' : '每月', used: data.used, quotaLimit: data.limit },
        dedupeKey: `open-quota:${event.eventId}`, link: '/open-platform/my-apps',
      });
      return { outcome: 'handed_off' };
    },
  });
  registered = true;
}

/** The threshold row is a business fact; its unique period key outlives event retention. */
export async function maybeSendQuotaWarning(input: {
  clientId: string; dimension: 'daily' | 'monthly'; period: string; used: number;
  limit: number; planCode: string; gateTtlSeconds: number;
}): Promise<void> {
  if (input.limit <= 0) return;
  const percentage = (input.used / input.limit) * 100;
  const threshold = percentage >= 95 ? 95 : percentage >= 80 ? 80 : null;
  if (!threshold) return;
  registerQuotaNotificationConsumer();
  const gateKey = `${config.redis.keyPrefix}openquota-gate:${input.clientId}:${input.dimension}:${input.period}:${threshold}`;
  if (await redis.set(gateKey, '1', 'EX', 30, 'NX') === null) return;
  let committed = false;
  try {
    await db.transaction(async (tx) => {
      const [client] = await tx.select({ id: oauth2Clients.id, name: oauth2Clients.name, tenantId: oauth2Clients.tenantId,
        ownerId: oauth2Clients.ownerId, ownerTenantId: users.tenantId,
      }).from(oauth2Clients).leftJoin(users, eq(oauth2Clients.ownerId, users.id)).where(eq(oauth2Clients.clientId, input.clientId)).limit(1);
      if (!client) throw new Error('Quota fact requires an existing application');
      const [fact] = await tx.insert(openQuotaAlerts).values({ clientId: input.clientId, dimension: input.dimension,
        period: input.period, threshold, used: input.used, quotaLimit: input.limit, planCode: input.planCode, eventId: randomUUID(),
      }).onConflictDoNothing({ target: [openQuotaAlerts.clientId, openQuotaAlerts.dimension, openQuotaAlerts.period, openQuotaAlerts.threshold] }).returning();
      if (!fact) return;
      await publishOpenEventInTx(tx, { type: 'app.quota.warning', clientId: input.clientId, tenantId: client.tenantId,
        businessKey: `quota:${input.clientId}:${input.dimension}:${input.period}:${threshold}`, orderingKey: `application:${input.clientId}`,
        subjects: [{ type: 'open-platform.app', key: String(client.id), role: 'primary' }],
        data: { dimension: input.dimension, used: input.used, limit: input.limit, percentage: Math.round(percentage * 100) / 100, threshold, plan: input.planCode },
        context: { ownerId: client.ownerId, ownerTenantId: client.ownerTenantId, appName: client.name },
      });
    });
    committed = true;
    await redis.expire(gateKey, input.gateTtlSeconds);
    await wakeEventConsumers();
  } finally {
    if (!committed) await redis.del(gateKey);
  }
}
