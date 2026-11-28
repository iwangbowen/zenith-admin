/**
 * api 侧 worker 缺失 watchdog。
 *
 * 例行监控告警评估由 worker 角色的系统调度执行：worker 全部下线时，
 * 「worker 缺失」这条告警恰恰无人评估。api 进程因此每分钟自查一次有心跳的 worker 数——**只在为 0 时**
 * 按指标子集 `schedulerWorkerNodes` 调用同一个评估器：复用规则、收件人、渠道、持续时间与静默期，
 * 触发 / 重复通知 / 事件落库都与其他监控告警同一套。worker 恢复后它自己的 cron 评估会把规则从 firing
 * 置回 ok 并发恢复通知。规则评估器负责处理角色交接时的并发。
 *
 * 这是进程级健康探测（与调度器心跳、指标采样器同类），不是业务作业，因此不接任务中心。
 */
import { config } from '../config';
import logger from './logger';
import { countActiveWorkerNodes } from './pg-boss-scheduler';

const CHECK_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastMissing = false;

async function check(evaluateMissingWorkers: () => Promise<void>): Promise<void> {
  if (running) return;
  running = true;
  try {
    const workers = await countActiveWorkerNodes();
    if (workers > 0) {
      if (lastMissing) logger.info(`[worker-watchdog] 检测到 ${workers} 个 worker 进程恢复心跳`);
      lastMissing = false;
      return;
    }
    if (!lastMissing) logger.warn('[worker-watchdog] 近期没有任何 worker 进程心跳，投递的后台作业将排队等待；开始在本进程评估 worker 缺失告警规则');
    lastMissing = true;
    await evaluateMissingWorkers();
  } catch (err) {
    logger.warn('[worker-watchdog] 检查失败', err);
  } finally {
    running = false;
  }
}

/** 纯 api 角色启动后调用（同时承担 worker 的进程自己就是执行者，无需探测） */
export function startWorkerWatchdog(evaluateMissingWorkers: () => Promise<void>): void {
  if (timer || config.roles.worker) return;
  // 首次检查延后一个周期：刚启动时 worker 可能同样在启动，心跳尚未写入
  timer = setInterval(() => { void check(evaluateMissingWorkers); }, CHECK_INTERVAL_MS);
  timer.unref?.();
}

export function stopWorkerWatchdog(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** 仅测试 */
export async function runWorkerWatchdogCheckForTest(evaluateMissingWorkers: () => Promise<void>): Promise<void> {
  await check(evaluateMissingWorkers);
}
