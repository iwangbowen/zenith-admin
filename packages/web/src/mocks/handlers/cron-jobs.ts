import { cronJobContract } from '@zenith/shared/platform';
import type { CronJob, CronJobLog, CronRunStatus } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { notFound } from '@/mocks/utils/handlers';
import { mockCronJobs, getNextCronJobId } from '@/mocks/data/system';
import { mockDateTime, mockDateTimeOffset, mockDateOffset } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';

export const cronJobsHandlers = [
  // 获取可用任务处理器列表（必须在 :id 路由之前声明）
  mock(cronJobContract.handlers, ({ ok }) => ok(['emailNotification', 'dataCleanup', 'reportGeneration', 'cacheRefresh'])),

  mock(cronJobContract.validate, ({ body, ok }) => ok({ valid: body.expression.trim().split(/\s+/).length >= 5 })),

  // 全量执行日志（必须在 :id 路由之前声明）
  mock(cronJobContract.logs, ({ query, ok, paginate }) => {
    const statuses: CronRunStatus[] = ['success', 'success', 'success', 'fail', 'running'];
    const allLogs: CronJobLog[] = mockCronJobs.flatMap((job, i) =>
      Array.from({ length: 5 }, (_, j) => ({
        id: i * 5 + j + 1,
        jobId: job.id,
        jobName: job.name,
        executionCount: i * 5 + j + 1,
        startedAt: mockDateTimeOffset(-(i * 5 + j + 1) * 1800000),
        endedAt: mockDateTimeOffset(-(i * 5 + j + 1) * 1800000 + 1200 + j * 200),
        durationMs: 1200 + j * 200,
        status: statuses[j % statuses.length],
        output: statuses[j % statuses.length] === 'fail' ? 'Error: Connection timeout' : 'Completed successfully',
      }))
    ).filter((log) => !query.jobId || log.jobId === query.jobId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    return ok(paginate(allLogs));
  }),

  // 按任务 ID 查询执行日志（必须在 :id 路由之前声明）
  mock(cronJobContract.jobLogs, ({ params, ok, paginate }) => {
    const job = mockCronJobs.find((j) => j.id === params.id);
    if (!job) return notFound('任务不存在');

    const statuses: CronRunStatus[] = ['success', 'success', 'fail', 'success', 'running'];
    const logs: CronJobLog[] = Array.from({ length: 10 }, (_, j) => ({
      id: j + 1,
      jobId: job.id,
      jobName: job.name,
      executionCount: j + 1,
      startedAt: mockDateTimeOffset(-(j + 1) * 3600000),
      endedAt: mockDateTimeOffset(-(j + 1) * 3600000 + 1500 + j * 100),
      durationMs: 1500 + j * 100,
      status: statuses[j % statuses.length],
      output: statuses[j % statuses.length] === 'fail' ? 'Error: timeout' : 'OK',
    }));

    return ok(paginate(logs));
  }),

  // 任务执行统计
  mock(cronJobContract.stats, ({ ok }) => {
    const statuses: CronRunStatus[] = ['success', 'success', 'success', 'fail', 'running'];

    const perJob = mockCronJobs.map((job, i) => {
      const totalRuns = 20 + (i * 7 % 80);
      const successCount = Math.floor(totalRuns * (0.7 + (i * 3 % 30) / 100));
      const failCount = totalRuns - successCount;
      // 近 10 次执行状态（确定性生成；第 2 个任务演示连续失败告警）
      let recentResults: CronRunStatus[];
      if (i === 1) {
        recentResults = ['success', 'success', 'fail', 'success', 'success', 'success', 'fail', 'fail', 'fail', 'fail'];
      } else {
        recentResults = Array.from({ length: Math.min(10, totalRuns) }, (_, j) =>
          (j * 7 + i * 3) % 9 === 0 ? 'fail' : 'success');
      }
      let consecutiveFails = 0;
      for (let j = recentResults.length - 1; j >= 0; j--) {
        if (recentResults[j] === 'running') continue;
        if (recentResults[j] !== 'fail') break;
        consecutiveFails++;
      }
      const avgDurationMs = 800 + (i * 137 % 2600);
      return {
        jobId: job.id, jobName: job.name, totalRuns, successCount, failCount,
        successRate: Math.round((successCount / totalRuns) * 100),
        avgDurationMs,
        p95DurationMs: Math.round(avgDurationMs * (1.6 + (i % 4) * 0.45)),
        recentResults,
        consecutiveFails,
        lastRunStatus: job.lastRunStatus ?? (failCount > successCount ? 'fail' : 'success'),
        lastRunAt: job.lastRunAt ?? mockDateTimeOffset(-(i + 1) * 1800000),
      };
    });

    // 近 14 天趋势（确定性生成）
    const dailyStats = Array.from({ length: 14 }, (_, idx) => {
      const offset = idx - 13;
      const total = 12 + ((idx * 5 + 3) % 22);
      const failCount = (idx * 3) % 5;
      return {
        date: mockDateOffset(offset), total, successCount: total - failCount, failCount,
        avgDurationMs: 900 + ((idx * 173) % 1400),
      };
    });

    // 近 7 天按小时执行分布（凌晨批处理高峰 + 工作时段小幅增量）
    const hourlyStats = Array.from({ length: 24 }, (_, hour) => {
      let total = 2 + ((hour * 3) % 5);
      if (hour >= 1 && hour <= 4) total += 14 - hour * 2;
      if (hour >= 9 && hour <= 18) total += 4;
      let failCount = 0;
      if ((hour * 7) % 11 === 0) failCount = 2;
      else if (hour % 5 === 0) failCount = 1;
      return { hour, total, failCount };
    });

    // 最近 12 条执行记录
    const recentLogs = Array.from({ length: 12 }, (_, j) => {
      const job = mockCronJobs[j % mockCronJobs.length];
      const status = statuses[j % statuses.length];
      let output: string;
      if (status === 'fail') output = 'Error: Connection timeout after 30000ms';
      else if (status === 'running') output = '任务执行中…';
      else output = `任务「${job.name}」执行成功，处理 ${100 + j * 13} 条记录`;
      return {
        id: j + 1,
        jobId: job.id,
        jobName: job.name,
        status,
        durationMs: status === 'running' ? null : 600 + (j * 211 % 3200),
        startedAt: mockDateTimeOffset(-(j + 1) * 900000),
        executionCount: 1 + (j % 3),
        output,
      };
    });

    return ok({
      totalJobs: mockCronJobs.length,
      enabledJobs: mockCronJobs.filter(j => j.status === 'enabled').length,
      runningJobs: 1,
      todayRuns: 24, todaySuccesses: 21, todayFails: 3,
      todayAvgDurationMs: 1450,
      perJob,
      dailyStats,
      hourlyStats,
      recentLogs,
    });
  }),

  // 定时任务列表（分页）
  mock(cronJobContract.list, ({ query, ok, paginate }) => {
    const list = filterByKeyword(mockCronJobs, query.keyword, [(j) => j.name, (j) => j.handler]);
    return ok(paginate(list));
  }),

  // 获取单个任务
  mock(cronJobContract.detail, ({ params, ok }) => {
    const job = mockCronJobs.find((j) => j.id === params.id);
    if (!job) return notFound('任务不存在');
    return ok(job);
  }),

  // 新增任务：body 即 CreateCronJobInput（已校验、已补默认值）
  mock(cronJobContract.create, ({ body, ok }) => {
    const newJob: CronJob = {
      id: getNextCronJobId(),
      name: body.name,
      cronExpression: body.cronExpression,
      handler: body.handler,
      params: body.params ?? null,
      status: body.status,
      description: body.description,
      retryCount: body.retryCount,
      retryInterval: body.retryInterval,
      retryBackoff: body.retryBackoff,
      monitorTimeout: body.monitorTimeout ?? null,
      lastRunAt: null,
      lastRunStatus: null,
      lastRunMessage: null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockCronJobs.push(newJob);
    return ok(newJob, '新增成功');
  }),

  // 更新任务
  mock(cronJobContract.update, ({ params, body, ok }) => {
    const job = mockCronJobs.find((j) => j.id === params.id);
    if (!job) return notFound('任务不存在');
    Object.assign(job, body, { updatedAt: mockDateTime() });
    return ok(job, '更新成功');
  }),

  // 清除所有执行日志（必须在 DELETE /:id 之前声明）
  mock(cronJobContract.clearLogs, ({ query, ok }) => ok(null, `已清除 ${query.days} 天前的日志`)),

  // 清除单任务执行日志（必须在 DELETE /:id 之前声明）
  mock(cronJobContract.clearJobLogs, ({ params, query, ok }) => {
    const job = mockCronJobs.find((j) => j.id === params.id);
    if (!job) return notFound('任务不存在');
    return ok(null, `已清除「${job.name}」${query.days} 天前的日志`);
  }),

  // 删除任务
  mock(cronJobContract.remove, ({ params, ok }) => {
    const index = mockCronJobs.findIndex((j) => j.id === params.id);
    if (index === -1) return notFound('任务不存在');
    mockCronJobs.splice(index, 1);
    return ok(null, '删除成功');
  }),

  // 立即执行任务（demo 模式仅更新 lastRunAt）
  mock(cronJobContract.run, ({ params, ok }) => {
    const job = mockCronJobs.find((j) => j.id === params.id);
    if (!job) return notFound('任务不存在');
    job.lastRunAt = mockDateTime();
    job.lastRunStatus = 'success';
    job.lastRunMessage = 'Demo 模式：模拟执行成功';
    job.updatedAt = mockDateTime();
    return ok(null, '执行成功');
  }),

  // 更新任务状态
  mock(cronJobContract.setStatus, ({ params, body, ok }) => {
    const job = mockCronJobs.find((j) => j.id === params.id);
    if (!job) return notFound('任务不存在');
    job.status = body.status;
    job.updatedAt = mockDateTime();
    return ok(null, '操作成功');
  }),
];
