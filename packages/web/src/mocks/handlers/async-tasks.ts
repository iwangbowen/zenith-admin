import { http, HttpResponse } from 'msw';
import type { AsyncTask, AsyncTaskItem, AsyncTaskItemStatus, AsyncTaskStats, AsyncTaskStatus, AsyncTaskTypeMeta } from '@zenith/shared';
import { mockDateOffset, mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';

/**
 * 任务中心 Mock：用「按读取时间推进」策略模拟异步任务执行。
 * Demo 模式无 WS，前端 useMyAsyncTasks 存在进行中任务时每 3s 轮询，
 * 每次读取时按提交参数和已流逝时间重算进度（含软失败明细、硬失败自动重试）。
 */

const taskTypes: AsyncTaskTypeMeta[] = [
  {
    taskType: 'cms-static-build',
    title: 'CMS 全站静态化',
    module: 'CMS内容管理',
    description: '渲染首页、栏目分页、内容详情为静态 HTML 并生成 sitemap/robots。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 1,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'cms-search-reindex',
    title: 'CMS 检索索引重建',
    module: 'CMS内容管理',
    description: '按站点重新分词并重建全文检索索引（tsvector）。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 1,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'cms-deadlink-check',
    title: 'CMS 死链检测',
    module: 'CMS内容管理',
    description: '扫描已发布内容中的站内/外部链接并输出死链明细。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 1,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'cms-collect-run',
    title: 'CMS 采集执行',
    module: 'CMS内容管理',
    description: '按采集规则抓取列表页与详情页，清洗后入库（支持图片本地化与自动发布）。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 1,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'cms-content-import',
    title: 'CMS 内容批量导入',
    module: 'CMS内容管理',
    description: '读取 Excel（首行表头：标题/摘要/正文/作者/来源），逐行创建草稿内容并输出行级明细。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 1,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'cms-resource-governance',
    title: 'CMS 素材治理',
    module: 'CMS内容管理',
    description: '扫描/清理孤立素材或批量移动素材，输出行级治理明细。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 2,
    retryDelayMs: 3000,
    retentionDays: 30,
  },
  {
    taskType: 'cms-theme-import',
    title: 'CMS 签名主题包导入',
    module: 'CMS内容管理',
    description: '验证签名、ZIP 安全边界和声明式 DSL 后导入主题包。',
    allowConcurrent: true,
    enabled: true,
    maxAttempts: 2,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'cms-publish-build',
    title: 'CMS 统一发布',
    module: 'CMS内容管理',
    description: '统一执行内容、栏目、整站、主题与模板影响重建并记录逐路径产物。',
    allowConcurrent: true,
    enabled: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'cms-ad-events-cleanup',
    title: 'CMS 广告事件保留期清理',
    module: 'CMS内容管理',
    description: '按保留策略分批清理广告事件。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'cms-interactions-batch-status',
    title: 'CMS 互动问卷批量状态流转',
    module: 'CMS内容管理',
    description: '批量发布或关闭统一互动问卷。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 2,
    retryDelayMs: 3000,
    retentionDays: 30,
  },
  {
    taskType: 'cms-subscription-notify',
    title: 'CMS 订阅发布通知',
    module: 'CMS内容管理',
    description: '按发布内容匹配订阅者并批量发送会员站内通知。',
    allowConcurrent: true,
    enabled: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'report-dq-rule-run',
    title: '报表质量规则执行',
    module: '报表中心',
    description: '执行数据质量规则并生成评分与异常样本。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'report-dataset-materialize',
    title: '报表数据集物化',
    module: '报表中心',
    description: '生成可复用的数据集物化快照。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'report-sla-rule-evaluate',
    title: '报表 SLA 评估',
    module: '报表中心',
    description: '评估数据集 SLA 并记录违规状态。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'report-fill-sync',
    title: '报表填报同步',
    module: '报表中心',
    description: '将审核通过的填报记录同步到生成数据集。',
    allowConcurrent: true,
    enabled: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'demo-batch',
    title: '批量处理演示',
    module: '业务示例',
    description: '模拟逐条批量处理：硬失败点触发任务失败（自动重试），软失败间隔演示行级明细。',
    allowConcurrent: true,
    enabled: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    retentionDays: null,
  },
  {
    taskType: 'demo-serial',
    title: '串行阶段演示',
    module: '业务示例',
    description: '模拟多阶段长任务（不定进度）；同一用户同时只允许一个实例，演示重复提交拦截。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 1,
    retryDelayMs: 5000,
    retentionDays: null,
  },
  {
    taskType: 'analytics-rollup-rebuild',
    title: '埋点每日聚合重建',
    module: '行为分析',
    description: '按指定天数重新计算 PV/UV/会话等每日聚合数据。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 2,
    retryDelayMs: 30000,
    retentionDays: 30,
  },
  {
    taskType: 'analytics-segment-materialize',
    title: '用户分群重算',
    module: '行为分析',
    description: '根据分群规则重新计算成员快照（distinctId 集合）。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 2,
    retryDelayMs: 15000,
    retentionDays: 30,
  },
  {
    taskType: 'analytics-campaign-execute',
    title: '分群触达执行',
    module: '行为分析',
    description: '按分群成员快照分批执行邮件、站内信或 Webhook 触达。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 1,
    retryDelayMs: 15000,
    retentionDays: 30,
  },
];

const SERIAL_STAGES = ['准备数据', '汇总统计', '生成报告', '归档结果'];
/** Demo 模式重试退避固定 5 秒（真实后端为指数退避） */
const RETRY_DELAY_MS = 5000;

interface SimState {
  startedAtMs: number;
  resumeFrom: number;
  itemDelayMs: number;
  failAtItem: number | null;
  failEveryN: number | null;
  stageDelayMs: number;
}

let nextId = 3;
let nextItemId = 1;
const sims = new Map<number, SimState>();
/** 等待自动重试的任务：taskId → 重试时间戳 */
const retryAt = new Map<number, number>();
const itemsByTask = new Map<number, AsyncTaskItem[]>();

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
    maxAttempts: 3,
    nextRunAt: null,
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
    errorMessage: '模拟失败：第 30 条处理异常（自动重试已用尽，可断点恢复续跑）',
    cancelRequested: false,
    attempts: 3,
    maxAttempts: 3,
    nextRunAt: null,
    createdBy: 1,
    createdByName: '管理员',
    tenantId: null,
    startedAt: mockDateTimeOffset(-1800 * 1000),
    completedAt: mockDateTimeOffset(-1700 * 1000),
    createdAt: mockDateTimeOffset(-1800 * 1000),
    updatedAt: mockDateTimeOffset(-1700 * 1000),
  },
];

export function createImmediateMockTask(input: {
  taskType: string;
  title: string;
  module?: string;
  description?: string;
  allowConcurrent?: boolean;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}): AsyncTask {
  if (!taskTypes.some((item) => item.taskType === input.taskType)) {
    taskTypes.unshift({
      taskType: input.taskType,
      title: input.title,
      module: input.module ?? '报表中心',
      description: input.description ?? null,
      allowConcurrent: input.allowConcurrent ?? true,
      enabled: true,
      maxAttempts: input.maxAttempts ?? 3,
      retryDelayMs: 5000,
      retentionDays: null,
    });
  }
  const now = mockDateTime();
  const task: AsyncTask = {
    id: nextId++,
    taskType: input.taskType,
    title: input.title,
    module: input.module ?? '报表中心',
    status: 'success',
    payload: input.payload ?? {},
    totalCount: 1,
    processedCount: 1,
    failedCount: 0,
    progressNote: '已完成',
    result: { message: `${input.title}已完成` },
    errorMessage: null,
    cancelRequested: false,
    attempts: 1,
    maxAttempts: input.maxAttempts ?? 3,
    nextRunAt: null,
    createdBy: 1,
    createdByName: '管理员',
    tenantId: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  tasks.unshift(task);
  return task;
}

export function createProgressingMockTask(input: {
  taskType: 'report-dq-rule-run' | 'report-dataset-materialize' | 'report-sla-rule-evaluate' | 'report-fill-sync' | 'analytics-rollup-rebuild' | 'analytics-segment-materialize' | 'analytics-campaign-execute' | 'cms-static-build' | 'cms-search-reindex' | 'cms-deadlink-check' | 'cms-collect-run' | 'cms-content-import' | 'cms-resource-governance' | 'cms-theme-import' | 'cms-publish-build' | 'cms-ad-events-cleanup' | 'cms-interactions-batch-status' | 'cms-subscription-notify';
  title: string;
  payload?: Record<string, unknown>;
  totalItems?: number;
  itemDelayMs?: number;
}): AsyncTask {
  const meta = taskTypes.find((item) => item.taskType === input.taskType);
  if (!meta) throw new Error(`未注册任务类型：${input.taskType}`);
  const totalItems = Math.max(1, input.totalItems ?? 5);
  const now = mockDateTime();
  const task: AsyncTask = {
    id: nextId++,
    taskType: input.taskType,
    title: input.title,
    module: meta.module,
    status: 'pending',
    payload: { ...input.payload, totalItems, itemDelayMs: input.itemDelayMs ?? 200 },
    totalCount: totalItems,
    processedCount: 0,
    failedCount: 0,
    progressNote: '任务已提交',
    result: null,
    errorMessage: null,
    cancelRequested: false,
    attempts: 0,
    maxAttempts: meta.maxAttempts,
    nextRunAt: null,
    createdBy: 1,
    createdByName: '管理员',
    tenantId: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  tasks.unshift(task);
  startSim(task);
  return task;
}

function upsertItem(taskId: number, itemKey: string, patch: Omit<AsyncTaskItem, 'id' | 'taskId' | 'itemKey' | 'createdAt' | 'updatedAt'>) {
  const list = itemsByTask.get(taskId) ?? [];
  const existing = list.find((item) => item.itemKey === itemKey);
  if (existing) {
    Object.assign(existing, patch, { updatedAt: mockDateTime() });
  } else {
    list.push({
      id: nextItemId++,
      taskId,
      itemKey,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
      ...patch,
    });
    itemsByTask.set(taskId, list);
  }
}

function finalize(task: AsyncTask, status: AsyncTaskStatus) {
  task.status = status;
  task.completedAt = mockDateTime();
  task.updatedAt = task.completedAt;
  task.nextRunAt = null;
  sims.delete(task.id);
}

function scheduleRetry(task: AsyncTask, message: string) {
  const ts = Date.now() + RETRY_DELAY_MS;
  task.status = 'pending';
  task.errorMessage = message;
  task.progressNote = `执行失败，${Math.round(RETRY_DELAY_MS / 1000)} 秒后自动重试（第 ${task.attempts + 1}/${task.maxAttempts} 次）`;
  task.nextRunAt = mockDateTimeOffset(RETRY_DELAY_MS);
  task.updatedAt = mockDateTime();
  retryAt.set(task.id, ts);
  sims.delete(task.id);
}

/** 按流逝时间推进单个任务（含重试等待 → 自动重启） */
function tickTask(task: AsyncTask) {
  // 等待重试的任务到点自动重新执行
  if (task.status === 'pending' && retryAt.has(task.id)) {
    if (Date.now() >= (retryAt.get(task.id) ?? 0)) {
      retryAt.delete(task.id);
      task.errorMessage = null;
      task.nextRunAt = null;
      startSim(task);
    }
    return;
  }
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

  // demo-batch：逐条推进 + 软失败明细 + 硬失败重试
  const total = task.totalCount ?? 100;
  const reached = Math.min(sim.resumeFrom + Math.floor(elapsed / sim.itemDelayMs), total);
  // 从断点已有的失败数开始重算本轮区间
  let failed = task.failedCount;
  for (let i = task.processedCount + 1; i <= reached; i++) {
    // 硬失败：仅第一次执行触发
    const alwaysFail = (task.payload as { alwaysFail?: unknown }).alwaysFail === true;
    if (sim.failAtItem !== null && i === sim.failAtItem && (task.attempts === 1 || alwaysFail)) {
      task.processedCount = i - 1;
      task.progressNote = `已处理 ${task.processedCount}/${total} 条`;
      const message = `模拟失败：第 ${sim.failAtItem} 条处理异常（自动重试后从断点续跑）`;
      if (task.attempts < task.maxAttempts) {
        scheduleRetry(task, message);
      } else {
        task.errorMessage = message;
        finalize(task, 'failed');
      }
      return;
    }
    const softFailed = sim.failEveryN !== null && i % sim.failEveryN === 0;
    if (softFailed) failed++;
    upsertItem(task.id, `item-${i}`, {
      label: `第 ${i} 条记录`,
      status: softFailed ? 'failed' : 'success',
      message: softFailed ? `模拟软失败：第 ${i} 条数据校验不通过` : null,
      data: null,
      attempt: task.attempts,
    });
    task.processedCount = i;
  }
  task.failedCount = failed;
  task.progressNote = `已处理 ${task.processedCount}/${total} 条${failed > 0 ? `，失败 ${failed} 条` : ''}`;
  if (task.cancelRequested) {
    finalize(task, 'cancelled');
    return;
  }
  if (task.processedCount >= total) {
    task.result = { processed: task.processedCount, failed, message: `批量处理完成，共 ${task.processedCount} 条${failed > 0 ? `，失败 ${failed} 条` : ''}` };
    finalize(task, 'success');
    return;
  }
  task.updatedAt = mockDateTime();
}

function tickAll() {
  for (const task of tasks) tickTask(task);
}

function serialResumeStage(task: AsyncTask): number {
  const match = task.progressNote?.match(/^阶段 (\d+)\//);
  return match ? Math.max(Number(match[1]) - 1, 0) : 0;
}

function startSim(task: AsyncTask) {
  const payload = task.payload as { totalItems?: number; itemDelayMs?: number; failAtItem?: number; failEveryN?: number; stageDelayMs?: number };
  task.status = 'running';
  task.attempts += 1;
  task.startedAt = task.startedAt ?? mockDateTime();
  task.updatedAt = mockDateTime();
  sims.set(task.id, {
    startedAtMs: Date.now(),
    resumeFrom: task.taskType === 'demo-serial' ? serialResumeStage(task) : task.processedCount,
    itemDelayMs: Math.max(Number(payload.itemDelayMs ?? 200), 10),
    failAtItem: payload.failAtItem ? Number(payload.failAtItem) : null,
    failEveryN: payload.failEveryN && Number(payload.failEveryN) > 1 ? Number(payload.failEveryN) : null,
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
  const createdBy = url.searchParams.get('createdBy') ?? '';
  const filtered = source.filter((task) => {
    if (taskType && task.taskType !== taskType) return false;
    if (status && task.status !== status) return false;
    if (keyword && !task.title.includes(keyword) && !task.taskType.includes(keyword)) return false;
    if (createdBy && !(task.createdByName ?? '').includes(createdBy)) return false;
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

  http.put('/api/async-tasks/types/:taskType/config', async ({ params, request }) => {
    const meta = taskTypes.find((item) => item.taskType === String(params.taskType));
    if (!meta) return HttpResponse.json({ code: 404, message: '任务类型未注册', data: null }, { status: 404 });
    const body = await request.json() as Partial<AsyncTaskTypeMeta>;
    meta.enabled = body.enabled ?? meta.enabled;
    meta.allowConcurrent = body.allowConcurrent ?? meta.allowConcurrent;
    meta.maxAttempts = body.maxAttempts ?? meta.maxAttempts;
    meta.retryDelayMs = body.retryDelayMs ?? meta.retryDelayMs;
    meta.retentionDays = body.retentionDays !== undefined ? body.retentionDays : meta.retentionDays;
    return HttpResponse.json({ code: 0, message: '策略已更新', data: meta });
  }),

  http.get('/api/async-tasks/stats', () => {
    tickAll();
    const counts: Record<string, number> = { pending: 0, running: 0, success: 0, failed: 0, cancelled: 0 };
    for (const task of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
    const stats: AsyncTaskStats = {
      total: tasks.length,
      pending: counts.pending,
      running: counts.running,
      success: counts.success,
      failed: counts.failed,
      cancelled: counts.cancelled,
      avgDurationMs: 12_400,
      daily: Array.from({ length: 7 }, (_, i) => ({
        date: mockDateOffset(-(6 - i)),
        submitted: [3, 5, 2, 6, 4, 7, tasks.length][i] ?? 3,
        failed: [0, 1, 0, 1, 0, 2, counts.failed][i] ?? 0,
      })),
    };
    return HttpResponse.json({ code: 0, message: 'ok', data: stats });
  }),

  http.get('/api/async-tasks/mine', ({ request }) => {
    tickAll();
    return HttpResponse.json({ code: 0, message: 'ok', data: paginate(new URL(request.url), tasks) });
  }),

  http.get('/api/async-tasks', ({ request }) => {
    tickAll();
    return HttpResponse.json({ code: 0, message: 'ok', data: paginate(new URL(request.url), tasks) });
  }),

  http.post('/api/async-tasks/cleanup', () => {
    return HttpResponse.json({ code: 0, message: '已清理 0 条任务记录', data: { cleaned: 0 } });
  }),

  http.post('/api/async-tasks/batch-cancel', async ({ request }) => {
    tickAll();
    const { ids } = await request.json() as { ids: number[] };
    let affected = 0;
    for (const id of ids) {
      const task = findTask(id);
      if (!task) continue;
      if (task.status === 'pending') {
        retryAt.delete(task.id);
        task.cancelRequested = true;
        finalize(task, 'cancelled');
        affected++;
      } else if (task.status === 'running') {
        task.cancelRequested = true;
        affected++;
      }
    }
    return HttpResponse.json({ code: 0, message: `已请求取消 ${affected} 个任务`, data: { affected } });
  }),

  http.post('/api/async-tasks/batch-delete', async ({ request }) => {
    const { ids } = await request.json() as { ids: number[] };
    let affected = 0;
    for (const id of ids) {
      const index = tasks.findIndex((item) => item.id === id && ['success', 'failed', 'cancelled'].includes(item.status));
      if (index >= 0) {
        itemsByTask.delete(tasks[index].id);
        tasks.splice(index, 1);
        affected++;
      }
    }
    return HttpResponse.json({ code: 0, message: `已删除 ${affected} 个任务记录`, data: { affected } });
  }),

  http.get('/api/async-tasks/:id/items', ({ params, request }) => {
    tickAll();
    const taskId = Number(params.id);
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 10;
    const status = (url.searchParams.get('status') ?? '') as AsyncTaskItemStatus | '';
    const all = (itemsByTask.get(taskId) ?? []).filter((item) => !status || item.status === status)
      .sort((a, b) => b.id - a.id);
    return HttpResponse.json({
      code: 0,
      message: 'ok',
      data: { list: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize },
    });
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
      retryAt.delete(task.id);
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
    task.nextRunAt = null;
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
    task.nextRunAt = null;
    itemsByTask.delete(task.id);
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
    itemsByTask.delete(tasks[index].id);
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
      failEveryN?: number | null;
      stageDelayMs?: number;
    };
    const meta = taskTypes.find((item) => item.taskType === body.taskType);
    if (!meta) return HttpResponse.json({ code: 400, message: '任务类型未注册', data: null }, { status: 400 });
    if (!meta.enabled) {
      return HttpResponse.json({ code: 400, message: `「${meta.title}」已暂停提交，请联系管理员`, data: null }, { status: 400 });
    }
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
        ? {
            totalItems,
            itemDelayMs: body.itemDelayMs ?? 200,
            ...(body.failAtItem ? { failAtItem: body.failAtItem } : {}),
            ...(body.failEveryN ? { failEveryN: body.failEveryN } : {}),
          }
        : { stageDelayMs: body.stageDelayMs ?? 4000 },
      totalCount: body.taskType === 'demo-batch' ? totalItems : null,
      processedCount: 0,
      failedCount: 0,
      progressNote: null,
      result: null,
      errorMessage: null,
      cancelRequested: false,
      attempts: 0,
      maxAttempts: meta.maxAttempts,
      nextRunAt: null,
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
