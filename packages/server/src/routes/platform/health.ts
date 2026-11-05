import { OpenAPIHono } from '@hono/zod-openapi';
import { healthContract, type HealthCheckResult } from '@zenith/shared/platform';
import { config } from '../../config';
import { defineContractRoute } from '../../lib/contract-route';
import { checkInfraHealth, overallHealthStatus } from '../../lib/health-checks';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { countActiveWorkerNodes } from '../../lib/pg-boss-scheduler';
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
    return (await countActiveWorkerNodes()) > 0 ? 'ok' : 'degraded';
  } catch {
    return 'error';
  }
}

const healthRoute = defineContractRoute(healthContract.check, {
  middleware: [],
  handler: async (c) => {
    const checks: Record<string, HealthCheckResult> = await checkInfraHealth();
    if (config.roles.api) {
      // 跨进程 WS 推送订阅未建立：其他进程（worker / 别的 api 副本）产生的推送到不了本进程的连接
      checks.wsFanout = wsFanoutState() === 'subscribed' ? 'ok' : 'degraded';
      checks.workers = await checkWorkers();
    }
    return c.json(okBody({
      status: overallHealthStatus(checks),
      version: appVersion,
      uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
      roles: config.roles.list,
      checks,
    }), 200);
  },
});

function probeBody(checks: Record<string, 'ok' | 'degraded' | 'error' | 'unavailable'>, ready: boolean) {
  const status = Object.values(checks).some((value) => value === 'error' || value === 'unavailable')
    ? 'unavailable'
    : Object.values(checks).some((value) => value === 'degraded')
      ? 'degraded'
      : 'ok';
  return { status, ready, version: appVersion, roles: config.roles.list, checks } as const;
}

const liveRoute = defineContractRoute(healthContract.livez, {
  middleware: [],
  handler: (c) => c.json(okBody(probeBody({ process: 'ok' }, true), 'success'), 200),
});

const startupRoute = defineContractRoute(healthContract.startupz, {
  middleware: [],
  handler: (c) => c.json(okBody(probeBody({ process: 'ok', app: 'ok' }, true), 'success'), 200),
});

const readyRoute = defineContractRoute(healthContract.readyz, {
  middleware: [],
  handler: async (c) => {
    const checks: Record<string, 'ok' | 'degraded' | 'error' | 'unavailable'> = await checkInfraHealth();
    if (config.roles.api) {
      checks.wsFanout = wsFanoutState() === 'subscribed' ? 'ok' : 'degraded';
      checks.workers = await checkWorkers();
    }
    const body = probeBody(checks, Object.values(checks).every((value) => value === 'ok'));
    return c.json(okBody(body, 'success'), body.ready ? 200 : 503);
  },
});

health.openapiRoutes([healthRoute, liveRoute, startupRoute, readyRoute] as const);

export default health;
