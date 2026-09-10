/**
 * 后台调度域告警指标源：供监控告警评估器（monitor-alert）实时采集的派生指标。
 *
 * - schedulerWorkerNodes：近期有心跳的 worker 角色进程数。为 0 时作业只会排队；该指标同时由 api 进程的
 *   watchdog（lib/worker-watchdog.ts）评估——worker 全部下线时 cron 评估器本身已停，只有 api 还能发出告警。
 * - schedulerQueueBacklog：全部 pg-boss 队列中已到执行时间、等待领取的作业总数，worker 扩容信号。
 */
import { countActiveWorkerNodes, getQueueBacklog } from '../../lib/pg-boss-scheduler';

export interface SchedulerAlertMetrics {
  schedulerWorkerNodes: number;
  schedulerQueueBacklog: number;
}

export async function getSchedulerAlertMetrics(): Promise<SchedulerAlertMetrics> {
  const [schedulerWorkerNodes, schedulerQueueBacklog] = await Promise.all([
    countActiveWorkerNodes(),
    getQueueBacklog(),
  ]);
  return { schedulerWorkerNodes, schedulerQueueBacklog };
}
