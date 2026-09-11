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
import type { HealthCheckResult } from '@zenith/shared/platform';
import { config } from '../config';
import { checkInfraHealth, overallHealthStatus } from '../lib/health-checks';
import logger from '../lib/logger';
import { errBody, okBody } from '../lib/openapi-schemas';
import { getSchedulerIntrospection } from '../lib/pg-boss-scheduler';
import { registerZenithMetrics } from '../lib/prometheus-metrics';
import { assertWorkerStorageTopology } from '../lib/storage-topology';
import { withTimeout } from './shutdown';

export interface WorkerRoleHandle {
  /** 关闭健康端点监听（若有） */
  stopIngress(): Promise<void>;
}

/**
 * 纯 worker 进程的探针应用：只有 /health、/ready、/metrics，没有任何业务路由与鉴权面。
 * 与 api 共进程时不启动（探针走 /api/health）。
 */
export function createWorkerApp(): Hono {
  const app = new Hono();
  const registry = new Registry();
  const { printMetrics } = prometheus({ collectDefaultMetrics: true, registry });
  registerZenithMetrics(registry);

  app.get('/health', async (c) => {
    const checks: Record<string, HealthCheckResult> = await checkInfraHealth();
    checks.scheduler = getSchedulerIntrospection().initialized ? 'ok' : 'error';
    return c.json(okBody({ status: overallHealthStatus(checks), roles: config.roles.list, checks }), 200);
  });
  // 就绪 = pg-boss 已启动并完成声明；未就绪返回 503 让编排器暂缓把它计入可用副本
  app.get('/ready', (c) => {
    const ready = getSchedulerIntrospection().initialized;
    return c.json(okBody({ ready, roles: config.roles.list }), ready ? 200 : 503);
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
  }

  return {
    async stopIngress() {
      if (!server) return;
      const s = server;
      await withTimeout('closeWorkerHealthServer', new Promise<void>((resolve) => s.close(() => resolve())), 3_000);
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
