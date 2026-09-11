/**
 * 服务启动编排。
 *
 * 本文件只负责"把进程按角色跑起来"：校验密钥与角色 → 遥测初始化 → 公共运行时（失效总线、采样器）→
 * 按 ZENITH_ROLES 启动接入面（api）/ 执行面（worker）→ 后台作业声明与事件订阅 → 执行期收尾 → 优雅停机。
 *
 * 角色（config.roles）：
 * - api：监听业务端口、承载 WS、订阅跨进程推送；pg-boss 只投递不执行（见 bootstrap/run-api.ts）
 * - worker：执行任务中心 / cron / 系统作业；纯 worker 只暴露健康端口（见 bootstrap/run-worker.ts）
 * - 两者同时（缺省仅限开发；生产用 ZENITH_ROLES=all 显式声明）= 单机全量进程
 * 声明（注册表 / 队列 / schedule）对所有角色一致，见 bootstrap/workers.ts；应用装配在 src/app.ts 的 createApp()。
 */
// ⚠ 必须是第一条 import：本模块只依赖 Node 内置模块并在 import 时自装
// uncaughtException / unhandledRejection 兜底，后续模块图（config / 路由 / 服务）
// 在加载阶段抛错同样会被兜住。详见 lib/fatal-handlers.ts。
import { isFatalShutdownInProgress } from './lib/fatal-handlers';
// ⚠ 必须是第二条 import：@hono/zod-openapi 在加载时把 .openapi() 补丁到 ZodType 原型，
// 而 zod v4 实例只在构造时拷贝原型方法。@zenith/shared 的契约 schema 在各自模块加载时构造，
// 必须晚于此补丁，lib/openapi-schemas 与路由层对它们调 .openapi(...) 才成立。
import '@hono/zod-openapi';
import { validateSettingsRegistry } from '@zenith/shared/settings';
import { startApiRole, type ApiRoleHandle } from './bootstrap/run-api';
import { activateWorkerJobs, startWorkerRole, type WorkerRoleHandle } from './bootstrap/run-worker';
import { withTimeout } from './bootstrap/shutdown';
import { registerEventSubscribers } from './bootstrap/subscribers';
import { declareBackgroundJobs } from './bootstrap/workers';
import { assertRuntimeRoles, assertRuntimeSecrets, config } from './config';
import { closeDb } from './db';
import { startInvalidationBus } from './lib/invalidation-bus';
import logger from './lib/logger';
import { metricsSampler } from './lib/metrics-sampler';
import { logPdfFontStatus } from './lib/pdf-font';
import { stopAllJobs } from './lib/pg-boss-scheduler';
import { closeRedis } from './lib/redis';
import { initTelemetry, shutdownTelemetry } from './lib/telemetry';
import { registerOpenWebhookSubscriber } from './services/open-platform/app-webhooks.service';

// 密钥不合规（非开发环境缺失 JWT_SECRET / FIELD_ENCRYPTION_KEY 或仍是默认值）时在开始监听前终止
assertRuntimeSecrets(logger);
// 非开发环境必须显式声明进程角色，避免 api 集群里的副本静默以全量模式执行后台作业
assertRuntimeRoles(logger);

// 运行时设置注册表自检：默认文档不可解析 / 字段命名越界 / 路径冲突都在监听前终止，而不是留到首个请求抛错
{
  const registryErrors = validateSettingsRegistry();
  if (registryErrors.length > 0) {
    logger.error(`[settings] 注册表自检失败，服务不会启动：\n${registryErrors.map((e) => `  - ${e}`).join('\n')}`);
    process.exit(1);
  }
}

await initTelemetry();
logger.info(`Process roles: ${config.roles.label}${config.roles.explicit ? '' : ' (default)'}`);

// ─── 公共运行时（所有角色）────────────────────────────────────────────────────
// 指标采集副作用（不属于 app 装配，故不放进 createApp）：
// 监控页轻量采样器 + DB/Redis 时序指标（连接数 / 内存 / 命中率）；worker 的 /metrics 同样读它
metricsSampler.start();
void import('./services/platform/monitor.service')
  .then((m) => m.registerMonitorExtCollector())
  .catch(() => {});

// 开放平台 Webhook 订阅者：领域事件在哪个进程发出就在哪个进程投递
registerOpenWebhookSubscriber();

// PDF 导出字体自检（api 同步导出 / worker 异步导出都会用到）：记录选用的字体（全量 / 子集 / 自定义），缺失只告警，不阻断启动
logPdfFontStatus(logger);

// 跨实例缓存失效总线（PG LISTEN/NOTIFY）：只能在进程入口启动一次；失败进入降级、定时重试，不阻断服务。
// 两种角色都需要——worker 的设置 / 脱敏策略 / 鉴权缓存同样要跟随变更
void startInvalidationBus();

// ─── 按角色启动 ─────────────────────────────────────────────────────────────
let apiRole: ApiRoleHandle | null = null;
let workerRole: WorkerRoleHandle | null = null;

if (config.roles.api) {
  apiRole = await startApiRole();
}
if (config.roles.worker) {
  try {
    workerRole = await startWorkerRole();
  } catch (err) {
    logger.error(`❌ worker 角色启动前自检失败，拒绝启动：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

// ─── 优雅停机 ───────────────────────────────────────────────────────────────
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down gracefully...`);
  // 硬闸：无论清理卡在哪一步，超时后强制退出（api 15s 断连接即可；纯 worker 缺省 120s 排空在飞作业）。
  // 此前 stopAllJobs/closeDb/closeRedis 无超时，任一环节挂起会导致
  // 「监听已关闭但进程永不退出」，tsx watch 等不到子进程退出也不会重启。
  setTimeout(() => {
    logger.error(`Graceful shutdown deadline (${config.shutdownGraceMs}ms) exceeded, forcing exit`);
    process.exit(1);
  }, config.shutdownGraceMs).unref();
  try {
    // 先停接入：不再接受新请求 / 新连接 / 新推送
    if (apiRole) await apiRole.stopIngress();
    if (workerRole) await workerRole.stopIngress();
    metricsSampler.stop();
    // flush OTel span 缓冲：BatchSpanProcessor 按批发送（默认 ~5s 一批），不 flush 则每次停机
    // 固定丢失最后一批未导出的 span。放在清理链前部：监听已关闭、span 已完整，且导出走
    // 独立 HTTP 出口，不依赖后续 DB/Redis；未启用 OTel 时为 no-op
    await withTimeout('shutdownTelemetry', shutdownTelemetry(), 5_000);
    // pg-boss：worker 等在飞作业收尾（预算 = 硬闸留出 10s 给后续步骤，并传入 pg-boss 的 graceful timeout），
    // api 的 send-only 实例没有在飞作业，即时关闭
    const drainBudgetMs = Math.max(config.shutdownGraceMs - 10_000, 5_000);
    await withTimeout('stopAllJobs', stopAllJobs(drainBudgetMs - 1_000), drainBudgetMs);
    if (apiRole) await apiRole.drainRuntime();
    await withTimeout('closeDb', closeDb(), 5_000);
    await withTimeout('closeRedis', closeRedis(), 5_000);
    logger.info('Server shutdown complete');
  } catch (err) {
    logger.error('Error during shutdown', err);
  } finally {
    process.exit(0);
  }
}

// 重复收到信号（如连续 Ctrl+C）或 fatal 兜底处理期间收到信号时立即强退，
// 不进入优雅停机路径——fatal 与 graceful 两条清理链并发会互相踩踏
process.on('SIGINT', () => { if (shuttingDown || isFatalShutdownInProgress()) process.exit(130); void shutdown('SIGINT'); });
process.on('SIGTERM', () => { if (shuttingDown || isFatalShutdownInProgress()) process.exit(143); void shutdown('SIGTERM'); });

// ─── 后台作业声明 + 事件订阅（所有角色）→ 执行期收尾（worker）──────────────────
const declared = await declareBackgroundJobs();
registerEventSubscribers();
if (declared && config.roles.worker) {
  await activateWorkerJobs().catch((err) => logger.error('Failed to activate worker jobs', err));
}

// 崩溃哨兵补投：上一次进程异常退出（uncaughtException / unhandledRejection）的告警
// 由本次健康进程读取哨兵后经通知中心补发；失败保留哨兵下次重试，绝不阻断启动
void import('./services/platform/crash-report.service')
  .then((m) => m.replayCrashSentinelsOnStartup())
  .catch((err) => logger.error('[crash-report] 崩溃哨兵补投模块加载失败', err));
