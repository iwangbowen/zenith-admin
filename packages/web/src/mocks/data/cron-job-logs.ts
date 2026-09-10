import type { CronJobLog } from '@zenith/shared/platform';
import { mockCronJobs } from '@/mocks/data/system';
import { mockDateTime } from '@/mocks/utils/date';

/** 带毫秒时间戳的 Demo 执行日志，供日志列表与执行概览统计共用同一份数据 */
export interface MockCronJobLog extends CronJobLog {
  readonly ts: number;
}

const HOUR_MS = 3_600_000;
const LOGS_PER_JOB = 80;

const FAIL_MESSAGES = [
  'Error: Connection timeout after 30000ms',
  'Error: connect ECONNREFUSED 10.0.0.12:5432',
  'TypeError: Cannot read properties of undefined (reading "rows")',
  'Error: 上游接口返回 502，batchId=48213',
];

/**
 * 确定性生成：每个任务按固定间隔往前铺 80 条记录，
 * 第 2 个任务末尾连续失败、第 4 个任务最近一次仍在运行，用于演示健康提醒与运行中状态。
 */
function generateLogs(now: number): MockCronJobLog[] {
  const logs: MockCronJobLog[] = [];
  let id = 1;
  mockCronJobs.forEach((job, i) => {
    const intervalHours = 2 + (i % 5);
    const total = LOGS_PER_JOB - (i % 7) * 3;
    for (let k = total - 1; k >= 0; k--) {
      const ts = now - (k * intervalHours * HOUR_MS) - (i * 7 * 60_000) - 2 * 60_000;
      const executionCount = total - k;
      let status: CronJobLog['status'] = (k * 7 + i * 3) % 11 === 0 ? 'fail' : 'success';
      if (i === 1 && k < 4) status = 'fail';
      if (i === 3 && k === 0) status = 'running';
      const durationMs = status === 'fail'
        ? 300 + ((k * 91 + i * 17) % 900)
        : 800 + ((k * 137 + i * 53) % 2600) + (k % 9 === 0 ? 4000 : 0);
      let output: string | null;
      if (status === 'running') output = null;
      else if (status === 'fail') output = FAIL_MESSAGES[(k + i) % FAIL_MESSAGES.length];
      else output = `任务「${job.name}」执行成功，处理 ${100 + (k * 13 + i * 7) % 900} 条记录`;
      logs.push({
        id: id++,
        jobId: job.id,
        jobName: job.name,
        executionCount,
        startedAt: mockDateTime(ts),
        endedAt: status === 'running' ? null : mockDateTime(ts + durationMs),
        durationMs: status === 'running' ? null : durationMs,
        status,
        output,
        ts,
      });
    }
  });
  return logs.sort((a, b) => b.ts - a.ts);
}

export const mockCronJobLogs: MockCronJobLog[] = generateLogs(Date.now());
