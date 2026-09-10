import dayjs from 'dayjs';
import { CronExpressionParser } from 'cron-parser';
import type {
  CronJobAlert,
  CronJobRunSummary,
  CronJobStats,
  CronJobStatsPerJob,
  CronJobTopError,
  CronJobUpcomingRun,
} from '@zenith/shared/platform';
import {
  CRON_HEALTH_RULES,
  CRON_ALERT_TYPE_LABELS,
  countConsecutiveFails,
  cronSuccessRatePercent,
  isCronLowSuccessRate,
  isCronNearTimeout,
  isCronSlowTail,
} from '@zenith/shared/platform';
import { mockCronJobs } from '@/mocks/data/system';
import { mockCronJobLogs, type MockCronJobLog } from '@/mocks/data/cron-job-logs';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';

const DAY_MS = 86_400_000;
const RECENT_LIMIT = 20;

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo));
}

function average(values: number[]): number | null {
  return values.length === 0 ? null : Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

function summarize(logs: readonly MockCronJobLog[]): CronJobRunSummary {
  const durations = logs.map((l) => l.durationMs).filter((d): d is number => d != null);
  const latencies = logs.map((l) => l.latencyMs).filter((d): d is number => d != null && d >= 0);
  return {
    total: logs.length,
    successCount: logs.filter((l) => l.status === 'success').length,
    failCount: logs.filter((l) => l.status === 'fail').length,
    timeoutCount: logs.filter((l) => l.status === 'timeout').length,
    runningCount: logs.filter((l) => l.status === 'running').length,
    retryCount: logs.filter((l) => l.trigger === 'retry').length,
    manualCount: logs.filter((l) => l.trigger === 'manual').length,
    avgDurationMs: average(durations),
    p95DurationMs: percentile(durations, 0.95),
    avgLatencyMs: average(latencies),
  };
}

function nextRuns(expression: string, from: Date, limit: number, deadline: number): Date[] {
  try {
    const interval = CronExpressionParser.parse(expression, { currentDate: from });
    const out: Date[] = [];
    for (let i = 0; i < limit; i++) {
      const next = interval.next().toDate();
      if (next.getTime() > deadline) break;
      out.push(next);
    }
    return out;
  } catch {
    return [];
  }
}

/** Demo 模式的执行概览：从同一份 Demo 日志聚合，口径与服务端 getCronJobStats 对齐 */
export function buildMockCronJobStats(days: number): CronJobStats {
  const now = Date.now();
  const startOfToday = dayjs(now).startOf('day').valueOf();
  const periodStart = startOfToday - (days - 1) * DAY_MS;
  const prevStart = startOfToday - (2 * days - 1) * DAY_MS;
  const inRange = (from: number, to: number) => (l: MockCronJobLog) => l.ts >= from && l.ts < to;
  const logs = mockCronJobLogs;

  const periodLogs = logs.filter(inRange(periodStart, Number.POSITIVE_INFINITY));
  const prevLogs = logs.filter(inRange(prevStart, periodStart));

  const perJob: CronJobStatsPerJob[] = mockCronJobs.map((job) => {
    const all = logs.filter((l) => l.jobId === job.id);
    const period = all.filter((l) => l.ts >= periodStart);
    const prev = all.filter(inRange(prevStart, periodStart));
    const todayLogs = all.filter((l) => l.ts >= startOfToday);
    const recent = all.slice(0, RECENT_LIMIT).reverse();
    const periodDurations = period.map((l) => l.durationMs).filter((d): d is number => d != null);
    const prevDurations = prev.map((l) => l.durationMs).filter((d): d is number => d != null);
    const lastFail = all.find((l) => l.status === 'fail' || l.status === 'timeout') ?? null;
    const lastSuccess = all.find((l) => l.status === 'success') ?? null;
    const latest = all[0] ?? null;
    const successCount = period.filter((l) => l.status === 'success').length;
    const prevSuccessCount = prev.filter((l) => l.status === 'success').length;
    const enabled = job.status === 'enabled';
    const [next] = enabled ? nextRuns(job.cronExpression, new Date(now), 1, Number.POSITIVE_INFINITY) : [];
    return {
      jobId: job.id,
      jobName: job.name,
      handler: job.handler,
      enabled,
      cronExpression: job.cronExpression,
      monitorTimeout: job.monitorTimeout,
      nextRunAt: next ? mockDateTime(next) : null,
      lastRunAt: latest?.startedAt ?? null,
      lastRunStatus: latest?.status ?? null,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      lastFailAt: lastFail?.startedAt ?? null,
      lastError: lastFail?.errorMessage ?? null,
      totalRuns: all.length,
      runs: period.length,
      successCount,
      failCount: period.filter((l) => l.status === 'fail').length,
      timeoutCount: period.filter((l) => l.status === 'timeout').length,
      retryCount: period.filter((l) => l.trigger === 'retry').length,
      successRate: cronSuccessRatePercent(successCount, period.length),
      prevSuccessRate: cronSuccessRatePercent(prevSuccessCount, prev.length),
      todayRuns: todayLogs.length,
      todayFailCount: todayLogs.filter((l) => l.status === 'fail').length,
      avgDurationMs: average(periodDurations),
      prevAvgDurationMs: average(prevDurations),
      p95DurationMs: percentile(periodDurations, 0.95),
      maxDurationMs: periodDurations.length ? Math.max(...periodDurations) : null,
      avgLatencyMs: average(period.map((l) => l.latencyMs).filter((d): d is number => d != null && d >= 0)),
      recentResults: recent.map((l) => l.status),
      recentDurations: recent.map((l) => l.durationMs),
      consecutiveFails: countConsecutiveFails(recent.map((l) => l.status)),
    };
  }).sort((a, b) => b.runs - a.runs || a.jobName.localeCompare(b.jobName));

  const alerts: CronJobAlert[] = [];
  for (const stat of perJob) {
    const job = mockCronJobs.find((j) => j.id === stat.jobId);
    if (!job) continue;
    const push = (type: CronJobAlert['type'], level: CronJobAlert['level'], message: string, detail: string | null = null) => {
      alerts.push({ type, level, jobId: stat.jobId, jobName: stat.jobName, message, detail });
    };
    if (stat.consecutiveFails >= CRON_HEALTH_RULES.consecutiveFailThreshold) {
      push('consecutive_fail', 'danger', `连续失败 ${stat.consecutiveFails} 次`, stat.lastError);
    } else if (isCronLowSuccessRate(stat.successRate, stat.runs)) {
      push('low_success_rate', 'warning', `成功率仅 ${stat.successRate}%（失败 ${stat.failCount} · 超时 ${stat.timeoutCount} / ${stat.runs} 次）`, stat.lastError);
    }
    if (isCronNearTimeout(stat.avgDurationMs, job.monitorTimeout)) {
      push('near_timeout', 'warning', `平均耗时 ${Math.round((stat.avgDurationMs ?? 0) / 1000)} 秒，接近监控超时 ${job.monitorTimeout} 秒，有超时风险`);
    }
    if (stat.runs >= CRON_HEALTH_RULES.successRateMinRuns && isCronSlowTail(stat.avgDurationMs, stat.p95DurationMs)) {
      push('slow_tail', 'info', `最慢 5% 的执行耗时约 ${Math.round((stat.p95DurationMs ?? 0) / 1000)} 秒，是平均值的 ${((stat.p95DurationMs ?? 0) / Math.max(stat.avgDurationMs ?? 1, 1)).toFixed(1)} 倍`);
    }
    if (stat.enabled && stat.totalRuns === 0) {
      push('never_run', 'info', CRON_ALERT_TYPE_LABELS.never_run, stat.nextRunAt ? `下次执行 ${stat.nextRunAt}` : null);
    }
  }
  const levelOrder = { danger: 0, warning: 1, info: 2 } as const;
  alerts.sort((a, b) => levelOrder[a.level] - levelOrder[b.level] || a.jobName.localeCompare(b.jobName));

  const dailyMap = new Map<string, MockCronJobLog[]>();
  for (const l of periodLogs) {
    const key = l.startedAt.slice(0, 10);
    dailyMap.set(key, [...(dailyMap.get(key) ?? []), l]);
  }
  const dailyStats = [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => {
    const s = summarize(list);
    return { date, total: s.total, successCount: s.successCount, failCount: s.failCount, timeoutCount: s.timeoutCount, avgDurationMs: s.avgDurationMs, p95DurationMs: s.p95DurationMs };
  });

  const dowHourMap = new Map<string, { dow: number; hour: number; total: number; failCount: number }>();
  for (const l of periodLogs) {
    const d = dayjs(l.ts);
    const dow = ((d.day() + 6) % 7) + 1;
    const key = `${dow}-${d.hour()}`;
    const cell = dowHourMap.get(key) ?? { dow, hour: d.hour(), total: 0, failCount: 0 };
    cell.total += 1;
    if (l.status === 'fail' || l.status === 'timeout') cell.failCount += 1;
    dowHourMap.set(key, cell);
  }

  const errorMap = new Map<string, { count: number; jobNames: Set<string>; lastTs: number }>();
  for (const l of periodLogs) {
    if (l.status !== 'fail' && l.status !== 'timeout') continue;
    const message = (l.errorMessage ?? l.output ?? '').replaceAll(/\d+/g, '#').slice(0, 200);
    const entry = errorMap.get(message) ?? { count: 0, jobNames: new Set<string>(), lastTs: 0 };
    entry.count += 1;
    entry.jobNames.add(l.jobName);
    entry.lastTs = Math.max(entry.lastTs, l.ts);
    errorMap.set(message, entry);
  }
  const topErrors: CronJobTopError[] = [...errorMap.entries()]
    .sort(([, a], [, b]) => b.count - a.count || b.lastTs - a.lastTs)
    .slice(0, 10)
    .map(([message, e]) => ({ message, count: e.count, jobNames: [...e.jobNames], lastAt: mockDateTime(e.lastTs) }));

  // 每个启用任务的下一次执行；日频次按相邻两次触发间隔估算（与服务端口径一致）
  const deadline = now + DAY_MS;
  const upcoming: CronJobUpcomingRun[] = mockCronJobs
    .filter((j) => j.status === 'enabled')
    .flatMap((j) => {
      const [first, second] = nextRuns(j.cronExpression, new Date(now), 2, Number.POSITIVE_INFINITY);
      if (!first || first.getTime() > deadline) return [];
      const gapMs = second ? second.getTime() - first.getTime() : 0;
      return [{ jobId: j.id, jobName: j.name, cronExpression: j.cronExpression, at: first, runsPerDay: gapMs > 0 ? Math.max(1, Math.round(DAY_MS / gapMs)) : null }];
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map(({ at, ...rest }) => ({ ...rest, runAt: mockDateTime(at) }));

  return {
    days,
    totalJobs: mockCronJobs.length,
    enabledJobs: mockCronJobs.filter((j) => j.status === 'enabled').length,
    runningJobs: logs.filter((l) => l.status === 'running').length,
    today: summarize(logs.filter((l) => l.ts >= startOfToday)),
    yesterday: summarize(logs.filter(inRange(startOfToday - DAY_MS, startOfToday))),
    yesterdaySameTime: summarize(logs.filter(inRange(startOfToday - DAY_MS, now - DAY_MS))),
    period: summarize(periodLogs),
    prevPeriod: summarize(prevLogs),
    scheduler: {
      online: true,
      nodeId: 'demo-node:4321',
      hostname: 'demo-node',
      pid: 4321,
      activeNodes: 1,
      lastHeartbeatAt: mockDateTimeOffset(-12_000),
      wipCount: logs.filter((l) => l.status === 'running').length,
    },
    alerts,
    perJob,
    dailyStats,
    dowHourStats: [...dowHourMap.values()],
    topErrors,
    upcoming,
  };
}
