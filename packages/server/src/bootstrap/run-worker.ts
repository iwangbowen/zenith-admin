/**
 * worker 角色：后台作业执行面。
 *
 * 声明（注册表、队列、schedule）对所有角色一致，由 index.ts 经 bootstrap/workers.ts 完成；
 * 本文件只负责 worker 独有的部分：
 * - 存储拓扑自检（本地磁盘型存储必须是共享卷，见 lib/storage-topology.ts）；
 * - 纯 worker 进程的健康 / 就绪 / 指标端点（不挂任何业务路由，探针与采集器专用）；
 * - 声明完成后的执行期收尾：孤儿对账、启动期补齐（埋点聚合断档、主题指纹重建）。
 */
import { serve, type ServerType } from '@hono/node-server';
import { prometheus } from '@hono/prometheus';
import { Hono } from 'hono';
import { Registry } from 'prom-client';
import type { HealthCheckResult, HealthProbeCheckResult } from '@zenith/shared/platform';
import { config } from '../config';
import { checkInfraHealth, overallHealthStatus } from '../lib/health-checks';
import { buildHealthProbe } from '../lib/health-probe';
import { isApplicationStartupReady } from '../lib/health-probe-state';
import logger from '../lib/logger';
import { errBody, okBody } from '../lib/openapi-schemas';
import { getSchedulerIntrospection } from '../lib/pg-boss-scheduler';
import { registerZenithMetrics } from '../lib/prometheus-metrics';
import { assertWorkerStorageTopology } from '../lib/storage-topology';
import { startWsFanoutSubscriber, stopWsFanoutSubscriber } from '../lib/ws-fanout';
import { startWsTrendSampling, stopWsTrendSampling } from '../lib/ws-trend';
import { withTimeout } from './shutdown';

const appVersion = process.env.npm_package_version || 'unknown';
const STARTUP_REQUIRED_CHECKS = ['process', 'application', 'scheduler'] as const;
const READINESS_REQUIRED_CHECKS = ['process', 'application', 'database', 'redis', 'scheduler'] as const;

export interface WorkerRoleHandle {
  /** 关闭健康端点监听与纯 worker 的 WS 镜像订阅 / 采样（若有） */
  stopIngress(): Promise<void>;
}

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

async function readinessProbe() {
  const infra = await checkInfraHealth();
  const checks: Record<string, HealthProbeCheckResult> = {
    process: 'ok',
    ...infra,
    application: isApplicationStartupReady() ? 'ok' : 'error',
    scheduler: schedulerCheck(),
  };
  return buildHealthProbe(checks, READINESS_REQUIRED_CHECKS, probeContext());
}

/**
 * 纯 worker 进程的探针应用：只有 health/liveness/readiness/startup/metrics，没有业务路由与鉴权面。
 * 与 api 共进程时不启动（探针走 /api/health）。
 */
export function createWorkerApp(): Hono {
  const app = new Hono();
  const registry = new Registry();
  const { printMetrics } = prometheus({ collectDefaultMetrics: true, registry });
  registerZenithMetrics(registry);

  // Compatibility endpoint retained for existing container checks and operators.
  app.get('/health', async (c) => {
    const checks: Record<string, HealthCheckResult> = await checkInfraHealth();
    checks.scheduler = schedulerCheck();
    return c.json(okBody({
      status: overallHealthStatus(checks),
      version: appVersion,
      roles: config.roles.list,
      checks,
    }), 200);
  });
  app.get('/livez', (c) => {
    const probe = buildHealthProbe({ process: 'ok' }, ['process'], probeContext());
    return c.json(okBody(probe.body, 'success'), probe.httpStatus);
  });
  app.get('/startupz', (c) => {
    const probe = startupProbe();
    return c.json(okBody(probe.body, 'success'), probe.httpStatus);
  });
  // 就绪 = 核心基础设施与 pg-boss 已启动；未就绪返回 503 让编排器暂缓把它计入可用副本
  app.get('/readyz', async (c) => {
    const probe = await readinessProbe();
    return c.json(okBody(probe.body, 'success'), probe.httpStatus);
  });
  // Legacy alias. Keep its compact response shape while using canonical readiness semantics.
  app.get('/ready', async (c) => {
    const probe = await readinessProbe();
    return c.json(okBody({ ready: probe.body.ready, roles: config.roles.list }), probe.httpStatus);
  });
  app.get('/metrics', printMetrics);
  app.notFound((c) => c.json(errBody('接口不存在', 404), 404));
  return app;
}

export async function startWorkerRole(): Promise<WorkerRoleHandle> {
  await assertWorkerStorageTopology();

  let server: ServerType | null = null;
  if (!config.roles.api) {
    server = serve({ fetch: createWorkerApp().fetch, port: config.workerHealthPort });
    logger.info(`Worker health endpoint at http://localhost:${config.workerHealthPort}/health`);
    // 纯 worker 从 api 的 wsStats 镜像采集落库窗口；不启动 presence，避免发布空的接入节点。
    await startWsFanoutSubscriber();
    startWsTrendSampling();
  }

  let stopped = false;
  return {
    async stopIngress() {
      if (stopped) return;
      stopped = true;
      if (!config.roles.api) {
        stopWsTrendSampling();
        await withTimeout('stopWorkerWsFanoutSubscriber', stopWsFanoutSubscriber(), 3_000);
      }
      if (server) {
        const s = server;
        server = null;
        await withTimeout('closeWorkerHealthServer', new Promise<void>((resolve) => s.close(() => resolve())), 3_000);
      }
    },
  };
}

/**
 * 声明全部完成后的执行期收尾（只在 worker 角色）：
 * 对账清理代码中已移除的任务与队列，并做启动期 best-effort 补齐。
 */
export async function activateWorkerJobs(): Promise<void> {
  const { purgeOrphanSystemTasks } = await import('../lib/pg-boss-scheduler');
  await purgeOrphanSystemTasks();
  // 埋点聚合断档自愈：上次每日聚合与昨日之间的缺口在启动时补齐（best-effort）
  const { catchUpRollupGaps } = await import('../services/analytics/analytics-rollup.service');
  void catchUpRollupGaps()
    .then((n) => { if (n > 0) logger.info(`[analytics] rollup catch-up rebuilt ${n} rows`); })
    .catch((err) => logger.warn('[analytics] rollup catch-up failed', err));
  // 主题代码指纹检测：变更自动重建受影响站点静态页（零维护，详见 cms-theme-watch.service）
  const { checkThemeChangesAndRebuild } = await import('../services/cms/cms-theme-watch.service');
  void checkThemeChangesAndRebuild();
}
