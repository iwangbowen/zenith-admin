import dayjs from 'dayjs';
import { cronJobContract } from '@zenith/shared/platform';
import type { CronJob } from '@zenith/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { requireItem, updateItem, removeByIds } from '@/mocks/utils/crud';
import { notFound } from '@/mocks/utils/handlers';
import { mockCronJobs, getNextCronJobId } from '@/mocks/data/system';
import { mockCronJobLogs } from '@/mocks/data/cron-job-logs';
import { mockDateTime } from '@/mocks/utils/date';
import { filterByKeyword } from '@/mocks/utils/filter';
import { buildMockCronJobDetailStats, buildMockCronJobStats } from './cron-job-stats';

export const cronJobsHandlers = [
  // 获取可用任务处理器列表（必须在 :id 路由之前声明）
  mock(cronJobContract.handlers, ({ ok }) => ok(['emailNotification', 'dataCleanup', 'reportGeneration', 'cacheRefresh'])),

  mock(cronJobContract.validate, ({ body, ok }) => ok({ valid: body.expression.trim().split(/\s+/).length >= 5 })),

  // 全量执行日志（必须在 :id 路由之前声明）：与执行概览共用同一份 Demo 日志
  mock(cronJobContract.logs, ({ query, ok, paginate }) => {
    const from = query.startTime ? dayjs(query.startTime).valueOf() : null;
    const to = query.endTime ? dayjs(query.endTime.length === 10 ? `${query.endTime} 23:59:59` : query.endTime).valueOf() : null;
    const list = filterByKeyword(mockCronJobLogs, query.keyword, [(l) => l.jobName, (l) => l.output], { caseInsensitive: true })
      .filter((l) => (!query.jobId || l.jobId === query.jobId)
        && (!query.status || l.status === query.status)
        && (from == null || l.ts >= from)
        && (to == null || l.ts <= to));
    return ok(paginate(list));
  }),

  // 按任务 ID 查询执行日志（必须在 :id 路由之前声明）
  mock(cronJobContract.jobLogs, ({ params, ok, paginate }) => {
    requireItem(mockCronJobs, params.id, '任务不存在');
    return ok(paginate(mockCronJobLogs.filter((l) => l.jobId === params.id)));
  }),

  // 任务执行统计：全部由 Demo 日志聚合而来，健康判定复用 shared 的同一套阈值
  mock(cronJobContract.stats, ({ query, ok }) => ok(buildMockCronJobStats(query.days))),

  // 单任务下钻统计
  mock(cronJobContract.jobStats, ({ params, query, ok }) => {
    const detail = buildMockCronJobDetailStats(params.id, query.days);
    if (!detail) return notFound('任务不存在');
    return ok(detail);
  }),

  // 定时任务列表（分页）
  mock(cronJobContract.list, ({ query, ok, paginate }) => {
    const list = filterByKeyword(mockCronJobs, query.keyword, [(j) => j.name, (j) => j.handler]);
    return ok(paginate(list));
  }),

  // 获取单个任务
  mock(cronJobContract.detail, ({ params, ok }) => {
    const job = requireItem(mockCronJobs, params.id, '任务不存在');
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
    const job = updateItem(mockCronJobs, params.id, body, { notFoundMessage: '任务不存在', now: mockDateTime });
    return ok(job, '更新成功');
  }),

  // 清除所有执行日志（必须在 DELETE /:id 之前声明）
  mock(cronJobContract.clearLogs, ({ query, ok }) => ok(null, `已清除 ${query.days} 天前的日志`)),

  // 清除单任务执行日志（必须在 DELETE /:id 之前声明）
  mock(cronJobContract.clearJobLogs, ({ params, query, ok }) => {
    const job = requireItem(mockCronJobs, params.id, '任务不存在');
    return ok(null, `已清除「${job.name}」${query.days} 天前的日志`);
  }),

  // 删除任务
  mock(cronJobContract.remove, ({ params, ok }) => {
    requireItem(mockCronJobs, params.id, '任务不存在');
    removeByIds(mockCronJobs, [params.id]);
    return ok(null, '删除成功');
  }),

  // 立即执行任务（demo 模式仅更新 lastRunAt）
  mock(cronJobContract.run, ({ params, ok }) => {
    const job = requireItem(mockCronJobs, params.id, '任务不存在');
    job.lastRunAt = mockDateTime();
    job.lastRunStatus = 'success';
    job.lastRunMessage = 'Demo 模式：模拟执行成功';
    job.updatedAt = mockDateTime();
    return ok(null, '执行成功');
  }),

  // 更新任务状态
  mock(cronJobContract.setStatus, ({ params, body, ok }) => {
    const job = requireItem(mockCronJobs, params.id, '任务不存在');
    job.status = body.status;
    job.updatedAt = mockDateTime();
    return ok(null, '操作成功');
  }),
];
