import type { CronRunStatus } from './constants';

/**
 * 定时任务健康判定阈值（执行概览提醒 / 任务表高亮 / Mock 共用同一口径）。
 * 服务端聚合与 Demo Mock 都从这里取规则，不得各写一份数字。
 */
export const CRON_HEALTH_RULES = {
  /** 连续失败达到该次数触发「连续失败」 */
  consecutiveFailThreshold: 2,
  /** 周期内执行次数达到该值后才评估成功率 */
  successRateMinRuns: 5,
  /** 成功率低于该百分比视为「成功率偏低」 */
  lowSuccessRatePercent: 70,
  /** P95 超过平均耗时的倍数视为「耗时波动大」 */
  slowTailRatio: 2.5,
  /** 平均耗时达到监控超时的比例视为「接近超时」 */
  nearTimeoutRatio: 0.8,
  /** 「未按计划执行」判定容差：应执行时刻之后超过该时长仍无执行记录 */
  missedRunGraceMs: 2 * 60_000,
  /** 调度节点心跳超过该时长视为离线 */
  schedulerHeartbeatStaleMs: 90_000,
} as const;

/** 当前连续失败次数：从最新往回数 fail，running 跳过不中断，遇到 success 归零 */
export function countConsecutiveFails(recentResults: readonly CronRunStatus[]): number {
  let count = 0;
  for (let i = recentResults.length - 1; i >= 0; i--) {
    const status = recentResults[i];
    if (status === 'running') continue;
    if (status !== 'fail') break;
    count++;
  }
  return count;
}

/** 成功率百分比（四舍五入到整数），无执行时为 null */
export function cronSuccessRatePercent(successCount: number, total: number): number | null {
  return total > 0 ? Math.round((successCount / total) * 100) : null;
}

/** P95 显著高于平均：一部分执行特别慢，耗时不稳定 */
export function isCronSlowTail(avgDurationMs: number | null, p95DurationMs: number | null): boolean {
  return avgDurationMs != null && p95DurationMs != null && avgDurationMs > 0
    && p95DurationMs > avgDurationMs * CRON_HEALTH_RULES.slowTailRatio;
}

/** 平均耗时逼近监控超时（`monitorTimeoutSeconds` 为秒） */
export function isCronNearTimeout(avgDurationMs: number | null, monitorTimeoutSeconds: number | null): boolean {
  return avgDurationMs != null && monitorTimeoutSeconds != null && monitorTimeoutSeconds > 0
    && avgDurationMs >= monitorTimeoutSeconds * 1000 * CRON_HEALTH_RULES.nearTimeoutRatio;
}

/** 运行中记录已超过监控超时（`monitorTimeoutSeconds` 为秒） */
export function isCronRunningTimeout(startedAtMs: number, nowMs: number, monitorTimeoutSeconds: number | null): boolean {
  return monitorTimeoutSeconds != null && monitorTimeoutSeconds > 0
    && nowMs - startedAtMs > monitorTimeoutSeconds * 1000;
}

/** 成功率是否偏低（样本不足时不评估） */
export function isCronLowSuccessRate(successRatePercent: number | null, total: number): boolean {
  return successRatePercent != null
    && total >= CRON_HEALTH_RULES.successRateMinRuns
    && successRatePercent < CRON_HEALTH_RULES.lowSuccessRatePercent;
}
