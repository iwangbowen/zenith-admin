import { OpenAPIHono } from '@hono/zod-openapi';
import { and, eq, gte, sql } from 'drizzle-orm';
import { CRON_HEALTH_RULES, healthContract, type HealthCheckResult, type HealthStatus } from '@zenith/shared/platform';
import { config } from '../../config';
import { db } from '../../db';
import { systemSchedulerNodes } from '../../db/schema';
import redis from '../../lib/redis';
import { invalidationBusState } from '../../lib/invalidation-bus';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { wsFanoutState } from '../../lib/ws-fanout';

const startTime = Date.now();
const appVersion = process.env.npm_package_version || 'unknown';

const health = new OpenAPIHono({ defaultHook: validationHook });

/**
 * api 角色的作业执行者感知：近期无任何活跃 worker 心跳时，投递的作业会一直排队无人执行。
 * 本进程自己承担 worker 角色时天然为 ok；查询失败按 error 上报（数据库项已同时失败）。
 */
async function checkWorkers(): Promise<HealthCheckResult> {
  if (config.roles.worker) return 'ok';
  try {
    const staleBefore = new Date(Date.now() - CRON_HEALTH_RULES.schedulerHeartbeatStaleMs);
    const alive = await db.$count(systemSchedulerNodes, and(
      eq(systemSchedulerNodes.active, true),
      gte(systemSchedulerNodes.lastHeartbeatAt, staleBefore),
      sql`${systemSchedulerNodes.roles} @> ARRAY['worker']::process_role[]`,
    ));
    return alive > 0 ? 'ok' : 'degraded';
  } catch {
    return 'error';
  }
}

const healthRoute = defineContractRoute(healthContract.check, {
  middleware: [],
  handler: async (c) => {
    const checks: Record<string, HealthCheckResult> = {};
    try {
      await db.execute(sql`SELECT 1`);
      checks.database = 'ok';
    } catch {
      checks.database = 'error';
    }
    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch {
      checks.redis = 'error';
    }
    // 失效广播未建立时功能仍可用（缓存退回 TTL 兜底），只作为降级提示，不拉低整体 status
    checks.invalidationBus = invalidationBusState() === 'listening' ? 'ok' : 'degraded';
    if (config.roles.api) {
      // 跨进程 WS 推送订阅未建立：其他进程（worker / 别的 api 副本）产生的推送到不了本进程的连接
      checks.wsFanout = wsFanoutState() === 'subscribed' ? 'ok' : 'degraded';
      checks.workers = await checkWorkers();
    }
    const anyError = Object.values(checks).some((v) => v === 'error');
    const status: HealthStatus = anyError ? 'degraded' : 'ok';
    return c.json(okBody({
      status,
      version: appVersion,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      roles: config.roles.list,
      checks,
    }), 200);
  },
});

health.openapiRoutes([healthRoute] as const);

export default health;
