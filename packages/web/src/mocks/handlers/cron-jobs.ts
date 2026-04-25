import { http, HttpResponse } from 'msw';
import { mockCronJobs, getNextCronJobId } from '@/mocks/data/system';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import type { CronJob } from '@zenith/shared';

export const cronJobsHandlers = [
  // 获取可用任务处理器列表（必须在 :id 路由之前声明）
  http.get('/api/cron-jobs/handlers', () => {
    return HttpResponse.json({ code: 0, message: 'ok', data: ['emailNotification', 'dataCleanup', 'reportGeneration', 'cacheRefresh'] });
  }),

  // 全量执行日志（必须在 :id 路由之前声明）
  http.get('/api/cron-jobs/logs', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;

    const statuses: Array<'success' | 'fail' | 'running'> = ['success', 'success', 'success', 'fail', 'running'];
    const allLogs = mockCronJobs.flatMap((job, i) =>
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
    ).sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    const total = allLogs.length;
    const list = allLogs.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 按任务 ID 查询执行日志（必须在 :id 路由之前声明）
  http.get('/api/cron-jobs/:id/logs', ({ params, request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;
    const job = mockCronJobs.find((j) => j.id === Number(params.id));
    if (!job) return HttpResponse.json({ code: 404, message: '任务不存在', data: null });

    const statuses: Array<'success' | 'fail' | 'running'> = ['success', 'success', 'fail', 'success', 'running'];
    const logs = Array.from({ length: 10 }, (_, j) => ({
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

    const total = logs.length;
    const list = logs.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 定时任务列表（分页）
  http.get('/api/cron-jobs', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const keyword = url.searchParams.get('keyword') ?? '';

    let list = mockCronJobs.filter((j) => {
      if (keyword && !j.name.includes(keyword) && !j.handler.includes(keyword)) return false;
      return true;
    });
    const total = list.length;
    list = list.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({ code: 0, message: 'ok', data: { list, total, page, pageSize } });
  }),

  // 获取单个任务
  http.get('/api/cron-jobs/:id', ({ params }) => {
    const job = mockCronJobs.find((j) => j.id === Number(params.id));
    if (!job) return HttpResponse.json({ code: 404, message: '任务不存在', data: null });
    return HttpResponse.json({ code: 0, message: 'ok', data: job });
  }),

  // 新增任务
  http.post('/api/cron-jobs', async ({ request }) => {
    const body = await request.json() as Partial<CronJob>;
    const newJob: CronJob = {
      id: getNextCronJobId(),
      name: body.name ?? '',
      cronExpression: body.cronExpression ?? '0 * * * * *',
      handler: body.handler ?? '',
      params: body.params ?? null,
      status: body.status ?? 'active',
      description: body.description ?? '',
      retryCount: body.retryCount ?? 0,
      retryInterval: body.retryInterval ?? 0,
      monitorTimeout: body.monitorTimeout ?? null,
      lastRunAt: null,
      nextRunAt: null,
      lastRunStatus: null,
      lastRunMessage: null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockCronJobs.push(newJob);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newJob });
  }),

  // 更新任务
  http.put('/api/cron-jobs/:id', async ({ params, request }) => {
    const job = mockCronJobs.find((j) => j.id === Number(params.id));
    if (!job) return HttpResponse.json({ code: 404, message: '任务不存在', data: null });
    const body = await request.json() as Partial<CronJob>;
    Object.assign(job, body, { updatedAt: mockDateTime() });
    return HttpResponse.json({ code: 0, message: '更新成功', data: job });
  }),

  // 删除任务
  http.delete('/api/cron-jobs/:id', ({ params }) => {
    const index = mockCronJobs.findIndex((j) => j.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '任务不存在', data: null });
    mockCronJobs.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '删除成功', data: null });
  }),

  // 立即执行任务（demo 模式仅更新 lastRunAt）
  http.post('/api/cron-jobs/:id/run', ({ params }) => {
    const job = mockCronJobs.find((j) => j.id === Number(params.id));
    if (!job) return HttpResponse.json({ code: 404, message: '任务不存在', data: null });
    job.lastRunAt = mockDateTime();
    job.lastRunStatus = 'success';
    job.lastRunMessage = 'Demo 模式：模拟执行成功';
    job.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '执行成功', data: job });
  }),

  // 启用/禁用任务
  http.put('/api/cron-jobs/:id/toggle', ({ params }) => {
    const job = mockCronJobs.find((j) => j.id === Number(params.id));
    if (!job) return HttpResponse.json({ code: 404, message: '任务不存在', data: null });
    job.status = job.status === 'active' ? 'disabled' : 'active';
    job.updatedAt = mockDateTime();
    return HttpResponse.json({ code: 0, message: '操作成功', data: job });
  }),
];
