import { http, HttpResponse } from 'msw';
import type { AsyncTask, AsyncTaskStatus, AsyncTaskTypeMeta } from '@zenith/shared';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';

/**
 * 任务中心 Mock：用「按读取时间推进」策略模拟异步任务执行。
 * Demo 模式无 WS，前端 useMyAsyncTasks 存在进行中任务时每 3s 轮询，
 * 每次读取时按提交参数和已流逝时间重算进度，效果与真实后台执行一致。
 */

const taskTypes: AsyncTaskTypeMeta[] = [
  {
    taskType: 'demo-batch',
    title: '批量处理演示',
    module: '业务示例',
    description: '模拟逐条批量处理：可配置总条数、单条耗时与模拟失败点；失败/取消后支持断点恢复续跑。',
    allowConcurrent: true,
  },
  {
    taskType: 'demo-serial',
    title: '串行阶段演示',
    module: '业务示例',
    description: '模拟多阶段长任务（不定进度）；同一用户同时只允许一个实例，演示重复提交拦截。',
    allowConcurrent: false,
  },
];

const SERIAL_STAGES = ['准备数据', '汇总统计', '生成报告', '归档结果'];

/** 运行态模拟参数（不随 AsyncTask 返回，仅 mock 内部使用） */
interface SimState {
  /** 本次执行开始的毫秒时间戳 */
  startedAtMs: number;
  /** 本次执行的起点（断点恢复时 = 已处理数 / 已完成阶段数） */
  resumeFrom: number;
  itemDelayMs: number;
  failAtItem: number | null;
  stageDelayMs: number;
}

let nextId = 3;
const sims = new Map<number, SimState>();

const tasks: AsyncTask[] = [
  {
    id: 1,
    taskType: 'demo-batch',
    title: '批量处理演示（120 条）',
    module: '业务示例',
    status: 'success',
    payload: { totalItems: 120, itemDelayMs: 100 },
    totalCount: 120,
    processedCount: 120,
    failedCount: 0,
    progressNote: '已处理 120/120 条',
    result: { processed: 120, failed: 0, message: '批量处理完成，共 120 条' },
    errorMessage: null,
    cancelRequested: false,
    attempts: 1,
    createdBy: 1,
    createdByName: '管理员',
    tenantId: null,
    startedAt: mockDateTimeOffset(-3600 * 1000),
    completedAt: mockDateTimeOffset(-3588 * 1000),
    createdAt: mockDateTimeOffset(-3600 * 1000),
    updatedAt: mockDateTimeOffset(-3588 * 1000),
  },
  {
    id: 2,
    taskType: 'demo-batch',
    title: '批量处理演示（80 条）',
    module: '业务示例',
    status: 'failed',
    payload: { totalItems: 80, itemDelayMs: 100, failAtItem: 30 },
    totalCount: 80,
    processedCount: 29,
    failedCount: 0,
    progressNote: '已处理 29/80 条',
    result: null,
    errorMessage: '模拟失败：第 30 条处理异常（断点恢复后将从第 30 条继续）',
    cancelRequested: false,
    attempts: 1,
    createdBy: 1,
    createdByName: '管理员',
    tenantId: null,
    startedAt: mockDateTimeOffset(-1800 * 1000),
    completedAt: mockDateTimeOffset(-1797 * 1000),
    createdAt: mockDateTimeOffset(-1800 * 1000),
    updatedAt: mockDateTimeOffset(-1797 * 1000),
  },
];

function finalize(task: AsyncTask, status: AsyncTaskStatus) {
  task.status = status;
  task.completedAt = mockDateTime();
  task.updatedAt = task.completedAt;
  sims.delete(task.id);
}

/** 按流逝时间推进单个 running 任务 */
function tickTask(task: AsyncTask) {
  if (task.status !== 'running') return;
  const sim = sims.get(task.id);
  if (!sim) return;
  const elapsed = Date.now() - sim.startedAtMs;

  if (task.taskType === 'demo-serial') {
    const stage = Math.min(sim.resumeFrom + Math.floor(elapsed / sim.stageDelayMs), SERIAL_STAGES.length);
    if (task.cancelRequested) {
      finalize(task, 'cancelled');
      return;
    }
    if (stage >= SERIAL_STAGES.length) {
      task.progressNote = '全部阶段完成';
      task.result = { stages: SERIAL_STAGES.length, message: '串行任务完成' };
      finalize(task, 'success');
      return;
    }
    task.progressNote = `阶段 ${stage + 1}/${SERIAL_STAGES.length}：${SERIAL_STAGES[stage]}…`;
    task.updatedAt = mockDateTime();
    return;
  }

  // demo-batch
  const total = task.totalCount ?? 100;
  const reached = Math.min(sim.resumeFrom + Math.floor(elapsed / sim.itemDelayMs), total);
  // 仅首次执行在失败点抛错（断点恢复后 attempts > 1 跳过）
  if (sim.failAtItem !== null && task.attempts === 1 && reached >= sim.failAtItem) {
    task.processedCount = sim.failAtItem - 1;
    task.progressNote = `已处理 ${task.processedCount}/${total} 条`;
    task.errorMessage = `模拟失败：第 ${sim.failAtItem} 条处理异常（断点恢复后将从第 ${sim.failAtItem} 条继续）`;
    finalize(task, 'failed');
    return;
  }
  task.processedCount = reached;
  task.progressNote = `已处理 ${reached}/${total} 条`;
  if (task.cancelRequested) {
    finalize(task, 'cancelled');
    return;
  }
  if (reached >= total) {
    task.result = { processed: reached, failed: task.failedCount, message: `批量处理完成，共 ${reached} 条` };
    finalize(task, 'success');
    return;
  }
  task.updatedAt = mockDateTime();
}

function tickAll() {
  for (const task of tasks) tickTask(task);
}

function serialResumeStage(task: AsyncTask): number {
  // 与后端一致：checkpoint 在执行阶段前保存 → 恢复时重跑中断的那个阶段
  const match = task.progressNote?.match(/^阶段 (\d+)\//);
  return match ? Math.max(Number(match[1]) - 1, 0) : 0;
}

function startSim(task: AsyncTask) {
  const payload = task.payload as { totalItems?: number; itemDelayMs?: number; failAtItem?: number; stageDelayMs?: number };
  task.status = 'running';
  task.attempts += 1;
  task.startedAt = task.startedAt ?? mockDateTime();
  task.updatedAt = mockDateTime();
  sims.set(task.id, {
    startedAtMs: Date.now(),
    resumeFrom: task.taskType === 'demo-serial' ? serialResumeStage(task) : task.processedCount,
    itemDelayMs: Math.max(Number(payload.itemDelayMs ?? 200), 10),
    failAtItem: payload.failAtItem ? Number(payload.failAtItem) : null,
    stageDelayMs: Math.max(Number(payload.stageDelayMs ?? 4000), 500),
  });
}

function findTask(id: number) {
  return tasks.find((item) => item.id === id);
}

function paginate(url: URL, source: AsyncTask[]) {
  const page = Number(url.searchParams.get('page')) || 1;
  const pageSize = Number(url.searchParams.get('pageSize')) || 10;
  const taskType = url.searchParams.get('taskType') ?? '';
  const status = (url.searchParams.get('status') ?? '') as AsyncTaskStatus | '';
  const keyword = url.searchParams.get('keyword') ?? '';
  const filtered = source.filter((task) => {
    if (taskType && task.taskType !== taskType) return false;
    if (status && task.status !== status) return false;
    if (keyword && !task.title.includes(keyword) && !task.taskType.includes(keyword)) return false;
    return true;
  }).sort((a, b) => b.id - a.id);
  return {
    list: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
  };
}

export const asyncTasksHandlers = [
  http.get('/api/async-tasks/types', () => HttpResponse.json({ code: 0, message: 'ok', data: taskTypes })),

  http.get('/api/async-tasks/mine', ({ request }) => {
    tickAll();
    return HttpResponse.json({ code: 0, message: 'ok', data: paginate(new URL(request.url), tasks) });
  }),

  http.get('/api/async-tasks', ({ request }) => {
    tickAll();
    return HttpResponse.json({ code: 0, message: 'ok', data: paginate(new URL(request.url), tasks) });
  }),

  http.post('/api/async-tasks/cleanup', () => {
    // Demo 数据都在保留期内，仅演示接口联通
    return HttpResponse.json({ code: 0, message: '已清理 0 条任务记录', data: { cleaned: 0 } });
  }),

  http.get('/api/async-tasks/:id', ({ params }) => {
    tickAll();
    const task = findTask(Number(params.id));
    if (!task) return HttpResponse.json({ code: 404, message: '任务不存在', data: null }, { status: 404 });
    return HttpResponse.json({ code: 0, message: 'ok', data: task });
  }),

  http.post('/api/async-tasks/:id/cancel', ({ params }) => {
    tickAll();
    const task = findTask(Number(params.id));
    if (!task) return HttpResponse.json({ code: 404, message: '任务不存在', data: null }, { status: 404 });
    if (task.status === 'pending') {
      task.cancelRequested = true;
      finalize(task, 'cancelled');
    } else if (task.status === 'running') {
      task.cancelRequested = true; // 协作式取消：下一次轮询 tick 生效
      task.updatedAt = mockDateTime();
    } else {
      return HttpResponse.json({ code: 400, message: '仅待执行或执行中的任务可以取消', data: null }, { status: 400 });
    }
    return HttpResponse.json({ code: 0, message: '已请求取消', data: task });
  }),

  http.post('/api/async-tasks/:id/resume', ({ params }) => {
    const task = findTask(Number(params.id));
    if (!task) return HttpResponse.json({ code: 404, message: '任务不存在', data: null }, { status: 404 });
    if (!['failed', 'cancelled'].includes(task.status)) {
      return HttpResponse.json({ code: 400, message: '仅失败或已取消的任务可以断点恢复', data: null }, { status: 400 });
    }
    task.cancelRequested = false;
    task.errorMessage = null;
    task.completedAt = null;
    startSim(task); // 保留 processedCount 作为断点续跑起点
    return HttpResponse.json({ code: 0, message: '已从断点恢复', data: task });
  }),

  http.post('/api/async-tasks/:id/restart', ({ params }) => {
    const task = findTask(Number(params.id));
    if (!task) return HttpResponse.json({ code: 404, message: '任务不存在', data: null }, { status: 404 });
    if (!['success', 'failed', 'cancelled'].includes(task.status)) {
      return HttpResponse.json({ code: 400, message: '仅已结束的任务可以重新开始', data: null }, { status: 400 });
    }
    task.processedCount = 0;
    task.failedCount = 0;
    task.progressNote = null;
    task.result = null;
    task.errorMessage = null;
    task.cancelRequested = false;
    task.attempts = 0;
    task.startedAt = null;
    task.completedAt = null;
    startSim(task);
    return HttpResponse.json({ code: 0, message: '已重新开始', data: task });
  }),

  http.delete('/api/async-tasks/:id', ({ params }) => {
    const index = tasks.findIndex((item) => item.id === Number(params.id));
    if (index === -1) return HttpResponse.json({ code: 404, message: '任务不存在', data: null }, { status: 404 });
    if (!['success', 'failed', 'cancelled'].includes(tasks[index].status)) {
      return HttpResponse.json({ code: 400, message: '进行中的任务不能删除，请先取消', data: null }, { status: 400 });
    }
    sims.delete(tasks[index].id);
    tasks.splice(index, 1);
    return HttpResponse.json({ code: 0, message: '已删除', data: null });
  }),

  http.post('/api/task-demo/submit', async ({ request }) => {
    tickAll();
    const body = await request.json() as {
      taskType: 'demo-batch' | 'demo-serial';
      totalItems?: number;
      itemDelayMs?: number;
      failAtItem?: number | null;
      stageDelayMs?: number;
    };
    const meta = taskTypes.find((item) => item.taskType === body.taskType);
    if (!meta) return HttpResponse.json({ code: 400, message: '任务类型未注册', data: null }, { status: 400 });
    if (!meta.allowConcurrent) {
      const unfinished = tasks.some((t) => t.taskType === body.taskType && ['pending', 'running'].includes(t.status));
      if (unfinished) {
        return HttpResponse.json({ code: 400, message: `已有进行中的「${meta.title}」任务，请等待其结束后再提交`, data: null }, { status: 400 });
      }
    }
    const id = nextId++;
    const totalItems = Math.min(Math.max(Number(body.totalItems ?? 100), 1), 10000);
    const task: AsyncTask = {
      id,
      taskType: body.taskType,
      title: body.taskType === 'demo-batch' ? `批量处理演示（${totalItems} 条）` : '串行阶段演示',
      module: '业务示例',
      status: 'pending',
      payload: body.taskType === 'demo-batch'
        ? { totalItems, itemDelayMs: body.itemDelayMs ?? 200, ...(body.failAtItem ? { failAtItem: body.failAtItem } : {}) }
        : { stageDelayMs: body.stageDelayMs ?? 4000 },
      totalCount: body.taskType === 'demo-batch' ? totalItems : null,
      processedCount: 0,
      failedCount: 0,
      progressNote: null,
      result: null,
      errorMessage: null,
      cancelRequested: false,
      attempts: 0,
      createdBy: 1,
      createdByName: '管理员',
      tenantId: null,
      startedAt: null,
      completedAt: null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    tasks.unshift(task);
    startSim(task); // Demo 模式立即开始执行
    return HttpResponse.json({ code: 0, message: '任务已提交，可在下方列表查看进度', data: task });
  }),
];
