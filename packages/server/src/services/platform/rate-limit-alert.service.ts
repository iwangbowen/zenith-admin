import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { users } from '../../db/schema';
import redis from '../../lib/redis';
import { config } from '../../config';
import logger from '../../lib/logger';
import { notify } from '../messaging/notification-outbox.service';
export async function maybeSendRateLimitSpikeAlert(input: {
  ruleName: string;
  threshold: number;
  blockedCount: number;
  hourKey: string;
  userIds?: number[];
  cooldownSeconds?: number;
}): Promise<void> {
  const cooldown = input.cooldownSeconds ?? 3600;
  const gateKey = config.redis.keyPrefix + 'rl-alert:' + input.ruleName;
  const owner = String(Date.now()) + ':' + process.pid;
  try {
    if ((await redis.set(gateKey, owner, 'EX', cooldown, 'NX')) !== 'OK') return;
    let ids = input.userIds ?? [];
    if (!ids.length) {
      const [admin] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.username, 'admin'), isNull(users.tenantId), eq(users.status, 'enabled')))
        .limit(1);
      ids = admin ? [admin.id] : [];
    }
    if (!ids.length) throw new Error('No valid rate-limit alert recipients');
    await notify('ops.rate_limit.spike', {
      recipients: ids.map((id) => ({ type: 'user' as const, id })),
      vars: {
        ruleName: input.ruleName,
        blockedCount: input.blockedCount,
        threshold: input.threshold,
        hour: input.hourKey,
      },
      tenantId: null,
      link: '/system/rate-limit?tab=blocks',
      dedupeKey: 'rate-limit-spike:' + input.ruleName + ':' + Math.floor(Date.now() / (cooldown * 1000)),
    });
  } catch (error) {
    await redis
      .eval(
        "if redis.call('GET',KEYS[1]) == ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",
        1,
        gateKey,
        owner,
      )
      .catch(() => undefined);
    logger.warn('[rate-limit] alert delivery failed', {
      ruleName: input.ruleName,
      error: error instanceof Error ? error.message : 'unknown',
    });
  }
}
