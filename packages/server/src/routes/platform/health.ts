import { OpenAPIHono } from '@hono/zod-openapi';
import { healthContract, type HealthCheckResult, type HealthProbeCheckResult } from '@zenith/shared/platform';
import { config } from '../../config';
import { defineContractRoute } from '../../lib/contract-route';
import { checkInfraHealth, overallHealthStatus } from '../../lib/health-checks';
import { buildHealthProbe } from '../../lib/health-probe';
import { isApplicationStartupReady } from '../../lib/health-probe-state';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { countActiveWorkerNodes, getSchedulerIntrospection } from '../../lib/pg-boss-scheduler';
import { wsFanoutState } from '../../lib/ws-fanout';

const startTime = Date.now();
const appVersion = process.env.npm_package_version || 'unknown';
const STARTUP_REQUIRED_CHECKS = ['process', 'application', 'scheduler'] as const;
// Database, Redis and the scheduler are required to accept traffic. Optional
// cross-process capabilities remain visible as degraded without failing readiness.
const READINESS_REQUIRED_CHECKS = ['process', 'application', 'database', 'redis', 'scheduler'] as const;

const health = new OpenAPIHono({ defaultHook: validationHook });

function probeContext() {
  return { version: appVersion, roles: config.roles.list };
}

function schedulerCheck(): HealthCheckResult {
  return getSchedulerIntrospection().initialized ? 'ok' : 'error';
}

function startupProbe() {
  return buildHealthProbe({
    process: 'ok',
    application: isApplicationStartupReady() ? 'ok' : 'error',
    scheduler: schedulerCheck(),
  }, STARTUP_REQUIRED_CHECKS, probeContext());
}

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

async function readinessProbe() {
  const infra = await checkInfraHealth();
  const checks: Record<string, HealthProbeCheckResult> = {
    process: 'ok',
    ...infra,
    application: isApplicationStartupReady() ? 'ok' : 'error',
    scheduler: schedulerCheck(),
  };
  if (config.roles.api) {
    // Cross-process WS delivery is optional for local connections; expose degradation
    // without removing an otherwise usable API replica from service.
    checks.wsFanout = wsFanoutState() === 'subscribed' ? 'ok' : 'degraded';
    checks.workers = await checkWorkers();
  }
  return buildHealthProbe(checks, READINESS_REQUIRED_CHECKS, probeContext());
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

const liveRoute = defineContractRoute(healthContract.livez, {
  middleware: [],
  handler: (c) => {
    const probe = buildHealthProbe({ process: 'ok' }, ['process'], probeContext());
    return c.json(okBody(probe.body, 'success'), 200);
  },
});

const startupRoute = defineContractRoute(healthContract.startupz, {
  middleware: [],
  handler: (c) => {
    const probe = startupProbe();
    return c.json(okBody(probe.body, 'success'), probe.httpStatus);
  },
});

const readyRoute = defineContractRoute(healthContract.readyz, {
  middleware: [],
  handler: async (c) => {
    const probe = await readinessProbe();
    return c.json(okBody(probe.body, 'success'), probe.httpStatus);
  },
});

health.openapiRoutes([healthRoute, liveRoute, startupRoute, readyRoute] as const);

export default health;
