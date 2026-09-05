import { OpenAPIHono } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { healthContract, type HealthCheckResult, type HealthStatus } from '@zenith/shared/platform';
import { db } from '../../db';
import redis from '../../lib/redis';
import { invalidationBusState } from '../../lib/invalidation-bus';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';

const startTime = Date.now();
const appVersion = process.env.npm_package_version || 'unknown';

const health = new OpenAPIHono({ defaultHook: validationHook });

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
    const anyError = Object.values(checks).some((v) => v === 'error');
    const status: HealthStatus = anyError ? 'degraded' : 'ok';
    return c.json(okBody({
      status,
      version: appVersion,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      checks,
    }), 200);
  },
});

health.openapiRoutes([healthRoute] as const);

export default health;
