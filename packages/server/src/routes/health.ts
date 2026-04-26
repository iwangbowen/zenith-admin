import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import redis from '../lib/redis';
import { validationHook, ok, okBody } from '../lib/openapi-schemas';

const startTime = Date.now();
const appVersion = process.env.npm_package_version || 'unknown';
const healthVersionExample = process.env.npm_package_version || '0.8.0';

const HealthDTO = z
  .object({
    status: z.enum(['ok', 'degraded']).openapi({ example: 'ok' }),
    version: z.string().openapi({ example: healthVersionExample }),
    uptimeSeconds: z.number().int().openapi({ example: 12345 }),
    checks: z.record(z.string(), z.enum(['ok', 'error'])).openapi({
      example: { database: 'ok', redis: 'ok' },
    }),
  })
  .openapi('Health');

const health = new OpenAPIHono({ defaultHook: validationHook });

const healthRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['服务状态'],
    summary: '健康检查',
    description: '检查数据库与 Redis 连通状态，返回服务运行信息。',
    security: [],
    responses: {
      ...ok(HealthDTO, '健康检查结果'),
    },
  }),
  handler: async (c) => {
    const checks: Record<string, 'ok' | 'error'> = {};
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
    const status: 'ok' | 'degraded' = allOk ? 'ok' : 'degraded';
    return c.json(okBody({
      status,
      version: appVersion,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      checks,
    }));
  },
});

health.openapiRoutes([healthRoute] as const);

export default health;
