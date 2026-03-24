import { http, HttpResponse } from 'msw';
import { mockCronJobs, getNextCronJobId } from '../data/system';
import type { CronJob } from '@zenith/shared';

export const cronJobsHandlers = [
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
      lastRunAt: null,
      nextRunAt: null,
      lastRunStatus: null,
      lastRunMessage: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockCronJobs.push(newJob);
    return HttpResponse.json({ code: 0, message: '新增成功', data: newJob });
  }),

  // 更新任务
  http.put('/api/cron-jobs/:id', async ({ params, request }) => {
    const job = mockCronJobs.find((j) => j.id === Number(params.id));
    if (!job) return HttpResponse.json({ code: 404, message: '任务不存在', data: null });
    const body = await request.json() as Partial<CronJob>;
    Object.assign(job, body, { updatedAt: new Date().toISOString() });
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
    job.lastRunAt = new Date().toISOString();
    job.lastRunStatus = 'success';
    job.lastRunMessage = 'Demo 模式：模拟执行成功';
    job.updatedAt = new Date().toISOString();
    return HttpResponse.json({ code: 0, message: '执行成功', data: job });
  }),

  // 启用/禁用任务
  http.put('/api/cron-jobs/:id/toggle', ({ params }) => {
    const job = mockCronJobs.find((j) => j.id === Number(params.id));
    if (!job) return HttpResponse.json({ code: 404, message: '任务不存在', data: null });
    job.status = job.status === 'active' ? 'disabled' : 'active';
    job.updatedAt = new Date().toISOString();
    return HttpResponse.json({ code: 0, message: '操作成功', data: job });
  }),
];
