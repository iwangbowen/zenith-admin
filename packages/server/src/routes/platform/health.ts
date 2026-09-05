import { OpenAPIHono } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { healthContract, type HealthCheckResult, type HealthStatus } from '@zenith/shared/platform';
import { db } from '../../db';
import redis from '../../lib/redis';
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
    const allOk = Object.values(checks).every((v) => v === 'ok');
    const status: HealthStatus = allOk ? 'ok' : 'degraded';
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
