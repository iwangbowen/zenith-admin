import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { oauth2Clients, users } from '../../db/schema';
import { config } from '../../config';
import redis from '../../lib/redis';
import logger from '../../lib/logger';
import { openEventBus } from '../../lib/open-event-bus';
import { sendSystemInApp } from '../messaging/in-app-messages.service';

export async function maybeSendQuotaWarning(input: {
  clientId: string;
  dimension: 'daily' | 'monthly';
  period: string;
  used: number;
  limit: number;
  planCode: string;
  ttlSeconds: number;
}): Promise<void> {
  if (input.limit <= 0) return;
  const percentage = (input.used / input.limit) * 100;
  const threshold = percentage >= 95 ? 95 : percentage >= 80 ? 80 : null;
  if (!threshold) return;

  const key = `${config.redis.keyPrefix}openquota-alert:${input.clientId}:${input.dimension}:${input.period}:${threshold}`;
  const fresh = await redis.set(key, '1', 'EX', input.ttlSeconds, 'NX');
  if (fresh === null) return;

  try {
    const [owner] = await db.select({
      userId: oauth2Clients.ownerId,
      appName: oauth2Clients.name,
      tenantId: users.tenantId,
    }).from(oauth2Clients)
      .leftJoin(users, eq(oauth2Clients.ownerId, users.id))
      .where(eq(oauth2Clients.clientId, input.clientId))
      .limit(1);
    if (owner?.userId) {
      await sendSystemInApp({
        userIds: [owner.userId],
        title: `开放 API 配额已使用 ${threshold}%`,
        content: `应用「${owner.appName}」${input.dimension === 'daily' ? '每日' : '每月'}配额已使用 ${input.used}/${input.limit}，请关注剩余额度。`,
        type: threshold >= 95 ? 'error' : 'warning',
        tenantId: owner.tenantId,
      });
    }
  } catch (err) {
    await redis.del(key).catch((deleteErr) => logger.error('[open-gateway] quota warning dedupe release failed', {
      key,
      err: deleteErr,
    }));
    throw err;
  }

  openEventBus.emit({
    type: 'app.quota.warning',
    clientId: input.clientId,
    data: {
      dimension: input.dimension,
      used: input.used,
      limit: input.limit,
      percentage: Math.round(percentage * 100) / 100,
      threshold,
      plan: input.planCode,
    },
  });
}
