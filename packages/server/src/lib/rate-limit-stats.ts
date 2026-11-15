import { randomUUID } from 'node:crypto';
import dayjs from 'dayjs';
import { APP_TIME_ZONE } from './datetime';
import { limiterRedis as redis } from './rate-limit-redis';
import { config } from '../config';
import logger from './logger';
import type { RATE_LIMIT_DECISIONS } from '@zenith/shared/platform';
export type LimitDecision = (typeof RATE_LIMIT_DECISIONS)[number];
export interface LimitEvent {
  id: string;
  name: string;
  ts: number;
  key: string;
  path: string;
  method: string;
  decision: LimitDecision;
  correlationId: string | null;
}
const PREFIX = config.redis.keyPrefix + 'rlmetrics:';
const queue: LimitEvent[] = [];
const alertPolicies = new Map<string, { threshold: number | null; userIds: number[]; cooldownSeconds: number }>();
let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | undefined;
let dropped = 0;
export const rateLimitStatsHealth = () => ({ queued: queue.length, dropped });
export function recordRateLimitEvent(
  event: Omit<LimitEvent, 'id' | 'ts'>,
  alert?: { threshold: number | null; userIds: number[]; cooldownSeconds: number },
): void {
  if (queue.length >= 2000) {
    dropped++;
    return;
  }
  if (alert) alertPolicies.set(event.name, alert);
  queue.push({ ...event, id: randomUUID(), ts: Date.now() });
  if (!timer) {
    timer = setTimeout(() => {
      timer = undefined;
      void flushRateLimitEvents().catch(() => undefined);
    }, 100);
    timer.unref?.();
  }
}
async function epoch(name: string) {
  const raw = await redis.get(PREFIX + name + ':epoch');
  return raw ? (JSON.parse(raw) as { id: string; at: number }) : { id: 'initial', at: 0 };
}
export async function flushRateLimitEvents(): Promise<void> {
  if (running) return running;
  running = (async () => {
    const events = queue.splice(0, 500);
    if (!events.length) return;
    try {
      const scopes = new Map(
        await Promise.all(
          [...new Set(events.map((e) => e.name))].map(async (name) => [name, await epoch(name)] as const),
        ),
      );
      const pipeline = redis.pipeline();
      for (const name of scopes.keys()) pipeline.expire(PREFIX + name + ':epoch', 33 * 86400);
      for (const event of events) {
        const scope = scopes.get(event.name)!;
        if (event.ts <= scope.at) continue;
        const base = PREFIX + event.name + ':' + scope.id;
        const time = dayjs(event.ts).tz(APP_TIME_ZONE);
        for (const [period, ttl] of [
          [time.format('YYYY-MM-DD-HH'), 25 * 3600],
          [time.format('YYYY-MM-DD'), 32 * 86400],
        ] as const) {
          const key = base + ':bucket:' + period;
          pipeline.hincrby(key, event.decision, 1).expire(key, ttl);
        }
        if (['blocked', 'monitored', 'banned', 'degraded'].includes(event.decision)) {
          pipeline
            .zadd(base + ':events', event.ts, JSON.stringify(event))
            .zremrangebyrank(base + ':events', 0, -501)
            .expire(base + ':events', 7 * 86400);
          if (event.decision === 'blocked' || event.decision === 'banned')
            pipeline
              .zincrby(base + ':top:' + time.format('YYYY-MM-DD'), 1, event.key)
              .zremrangebyrank(base + ':top:' + time.format('YYYY-MM-DD'), 0, -1001)
              .expire(base + ':top:' + time.format('YYYY-MM-DD'), 2 * 86400);
        }
      }
      const result = await pipeline.exec();
      if (result?.some(([error]) => error)) throw new Error('Metrics pipeline failed');
      for (const name of new Set(
        events.filter((e) => e.decision === 'blocked' || e.decision === 'banned').map((e) => e.name),
      )) {
        const policy = alertPolicies.get(name);
        if (!policy?.threshold) continue;
        const hour = dayjs().tz(APP_TIME_ZONE).format('YYYY-MM-DD-HH');
        const values = await redis.hgetall(PREFIX + name + ':' + scopes.get(name)!.id + ':bucket:' + hour);
        const blocked = Number(values.blocked ?? 0) + Number(values.banned ?? 0);
        if (blocked >= policy.threshold)
          await (
            await import('../services/platform/rate-limit-alert.service')
          ).maybeSendRateLimitSpikeAlert({
            ruleName: name,
            threshold: policy.threshold,
            blockedCount: blocked,
            hourKey: hour,
            userIds: policy.userIds,
            cooldownSeconds: policy.cooldownSeconds,
          });
      }
    } catch (error) {
      dropped += events.length;
      logger.warn('[rate-limit] metrics batch dropped', {
        count: events.length,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  })().finally(() => {
    running = undefined;
    if (queue.length && !timer) {
      timer = setTimeout(() => {
        timer = undefined;
        void flushRateLimitEvents().catch(() => undefined);
      }, 100);
      timer.unref?.();
    }
  });
  return running;
}
const number = (value: string | undefined) => Number(value ?? 0) || 0;
export async function readRateLimitMetrics(name: string, details = false) {
  const scope = await epoch(name);
  const base = PREFIX + name + ':' + scope.id;
  const now = dayjs().tz(APP_TIME_ZONE);
  const hours = Array.from({ length: 24 }, (_, i) => now.subtract(23 - i, 'hour'));
  const days = details ? Array.from({ length: 30 }, (_, i) => now.subtract(29 - i, 'day')) : [];
  const pipe = redis.pipeline();
  for (const time of hours) pipe.hgetall(base + ':bucket:' + time.format('YYYY-MM-DD-HH'));
  for (const time of days) pipe.hgetall(base + ':bucket:' + time.format('YYYY-MM-DD'));
  const rows = await pipe.exec();
  if (rows?.some(([error]) => error)) throw new Error('Rate-limit metrics are temporarily unavailable');
  const points = (times: typeof hours, offset: number) =>
    times.map((time, i) => {
      const value = rows?.[offset + i]?.[1] as Record<string, string> | undefined;
      return {
        hour: time.format('MM-DD HH:00'),
        day: time.format('MM-DD'),
        hits: ['allowed', 'blocked', 'monitored', 'banned', 'degraded'].reduce(
          (sum, key) => sum + number(value?.[key]),
          0,
        ),
        blocked: number(value?.blocked) + number(value?.banned),
        monitored: number(value?.monitored),
        banned: number(value?.banned),
        exempt: number(value?.exempt),
        degraded: number(value?.degraded),
      };
    });
  const hourlySeries = points(hours, 0);
  const dailySeries = points(days, 24);
  const totals = hourlySeries.reduce(
    (t, p) => ({
      hits: t.hits + p.hits,
      blocked: t.blocked + p.blocked,
      monitored: t.monitored + p.monitored,
      banned: t.banned + p.banned,
      exempt: t.exempt + p.exempt,
      degraded: t.degraded + p.degraded,
    }),
    { hits: 0, blocked: 0, monitored: 0, banned: 0, exempt: 0, degraded: 0 },
  );
  const raw = details ? await redis.zrevrange(base + ':events', 0, 499) : [];
  const events: LimitEvent[] = raw.flatMap((value) => {
    try {
      return [JSON.parse(value) as LimitEvent];
    } catch {
      return [];
    }
  });
  const top = details ? await redis.zrevrange(base + ':top:' + now.format('YYYY-MM-DD'), 0, 9, 'WITHSCORES') : [];
  return {
    ...totals,
    hourlySeries,
    dailySeries,
    events,
    topSources: Array.from({ length: top.length / 2 }, (_, i) => ({ key: top[i * 2], count: Number(top[i * 2 + 1]) })),
  };
}
export async function readRateLimitEvents(name: string): Promise<LimitEvent[]> {
  const scope = await epoch(name);
  const raw = await redis.zrevrange(PREFIX + name + ':' + scope.id + ':events', 0, 499);
  return raw.flatMap((value) => {
    try {
      return [JSON.parse(value) as LimitEvent];
    } catch {
      return [];
    }
  });
}
export async function resetRateLimitMetrics(name: string): Promise<void> {
  await redis.set(PREFIX + name + ':epoch', JSON.stringify({ id: randomUUID(), at: Date.now() }), 'EX', 33 * 86400);
}
