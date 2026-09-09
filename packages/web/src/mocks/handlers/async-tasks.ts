import type { QueryOf } from '@zenith/shared/core';
import { percentOf } from '@zenith/shared/core';
import { asyncTaskContract, taskDemoContract, isAsyncTaskTerminal } from '@zenith/shared/tasks';
import type { AsyncTask, AsyncTaskItem, AsyncTaskStats, AsyncTaskStatus, AsyncTaskTypeMeta } from '@zenith/shared/tasks';
import dayjs from 'dayjs';
import { mock } from '@/mocks/utils/contract';
import { badRequest, notFound } from '@/mocks/utils/handlers';
import { mockDateOffset, mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { includesKeyword } from '@/mocks/utils/filter';

/**
 * 任务中心 Mock：用「按读取时间推进」策略模拟异步任务执行。
 * Demo 模式无 WS，前端 useMyAsyncTasks 存在进行中任务时每 3s 轮询，
 * 每次读取时按提交参数和已流逝时间重算进度（含软失败明细、硬失败自动重试）。
 */

const taskTypes: AsyncTaskTypeMeta[] = [
  {
    taskType: 'messaging-broadcast',
    title: '运营群发',
    module: '通知管理',
    description: '分批经通知派发层投递群发活动(站内信/推送/邮件)。',
    allowConcurrent: true,
    enabled: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'directory-sync-run',
    title: '通讯录同步',
    module: '通讯录同步',
    description: '手动触发的通讯录同步 / 差异预览。',
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
    taskType: 'cms-publish-build',
    title: 'CMS 统一发布',
    module: 'CMS内容管理',
    description: '统一执行内容、栏目、整站与主题影响重建并记录逐路径产物。',
    allowConcurrent: true,
    enabled: true,
    maxAttempts: 3,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'cms-widget-batch',
    title: 'CMS 页面部件批量操作',
    module: 'CMS内容管理',
    description: '批量发布、下线或删除页面部件。',
    allowConcurrent: false,
    enabled: true,
    maxAttempts: 1,
    retryDelayMs: 5000,
    retentionDays: 30,
  },
  {
    taskType: 'cms-widget-refresh',
    title: 'CMS 页面部件引用刷新',
    module: 'CMS内容管理',
    description: '刷新页面部件影响的搭建页、首页和缓存。',
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
    taskType: 'cms-distribution-sync',
    title: 'CMS 内容分发同步',
    module: 'CMS内容管理',
    description: '按站群分发规则同步已发布内容并输出行级成功、跳过、冲突和失败结果。',
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
    retryDelayMs: 5000,
    nextRunAt: null,
    createdBy: 1,
    createdByName: '管理员',
    tenantId: null,
    traceId: null,
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
    retryDelayMs: 5000,
    nextRunAt: null,
    createdBy: 1,
    createdByName: '管理员',
    tenantId: null,
    traceId: null,
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
    retryDelayMs: 5000,
    nextRunAt: null,
    createdBy: 1,
    createdByName: '管理员',
    tenantId: null,
    traceId: null,
    startedAt: now,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  tasks.unshift(task);
  return task;
}

export function createProgressingMockTask(input: {
  taskType: 'report-dq-rule-run' | 'report-dataset-materialize' | 'report-sla-rule-evaluate' | 'report-fill-sync' | 'analytics-rollup-rebuild' | 'analytics-segment-materialize' | 'analytics-campaign-execute' | 'cms-search-reindex' | 'cms-deadlink-check' | 'cms-collect-run' | 'cms-content-import' | 'cms-resource-governance' | 'cms-resource-ref-rebuild' | 'cms-publish-build' | 'cms-widget-batch' | 'cms-widget-refresh' | 'cms-ad-events-cleanup' | 'cms-interactions-batch-status' | 'cms-subscription-notify' | 'cms-distribution-sync' | 'messaging-broadcast';
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
    retryDelayMs: meta.retryDelayMs,
    nextRunAt: null,
    createdBy: 1,
    createdByName: '管理员',
    tenantId: null,
    traceId: null,
    startedAt: null,
    completedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  tasks.unshift(task);
  startSim(task);
  return task;
}

export function setMockTaskItems(taskId: number, items: AsyncTaskItem[]): void {
  itemsByTask.set(taskId, items);
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
  const delayMs = Math.min(task.retryDelayMs * 2 ** Math.max(task.attempts - 1, 0), 900_000);
  const ts = Date.now() + delayMs;
  task.status = 'pending';
  task.errorMessage = message;
  task.progressNote = `执行失败，${Math.round(delayMs / 1000)} 秒后自动重试（第 ${task.attempts + 1}/${task.maxAttempts} 次）`;
  task.nextRunAt = mockDateTimeOffset(delayMs);
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
    const configuredOutcome = task.payload.outcome;
    task.result = configuredOutcome && typeof configuredOutcome === 'object' && !Array.isArray(configuredOutcome)
      ? configuredOutcome as Record<string, unknown>
      : { processed: task.processedCount, failed, message: `批量处理完成，共 ${task.processedCount} 条${failed > 0 ? `，失败 ${failed} 条` : ''}` };
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

type TaskListQuery = QueryOf<typeof asyncTaskContract.list>;

/** 按契约查询参数筛选（服务端语义：类型 / 状态精确匹配，关键字匹配标题与类型，内容匹配入参与产出，提交人匹配昵称） */
function filterTasks(query: TaskListQuery, source: AsyncTask[]) {
  const content = (query.content ?? '').toLowerCase();
  return source.filter((task) => {
    if (query.taskType && task.taskType !== query.taskType) return false;
    if (query.status && task.status !== query.status) return false;
    if (query.keyword && !includesKeyword(query.keyword, task.title, task.taskType)) return false;
    if (content && !(
      JSON.stringify(task.payload ?? {}).toLowerCase().includes(content)
      || JSON.stringify(task.result ?? {}).toLowerCase().includes(content)
    )) return false;
    if (query.createdBy && !(task.createdByName ?? '').includes(query.createdBy)) return false;
    return true;
  }).sort((a, b) => b.id - a.id);
}

export const asyncTasksHandlers = [
  mock(asyncTaskContract.types, ({ ok }) => ok(taskTypes)),

  mock(asyncTaskContract.updateTypePolicy, ({ params, body, ok }) => {
    const meta = taskTypes.find((item) => item.taskType === params.taskType);
    if (!meta) return notFound('任务类型未注册', { status: 404 });
    meta.enabled = body.enabled;
    meta.allowConcurrent = body.allowConcurrent;
    meta.maxAttempts = body.maxAttempts;
    meta.retryDelayMs = body.retryDelayMs;
    meta.retentionDays = body.retentionDays !== undefined ? body.retentionDays : meta.retentionDays;
    return ok(meta, '策略已更新');
  }),

  mock(asyncTaskContract.stats, ({ ok }) => {
    tickAll();
    const counts: Record<string, number> = { pending: 0, running: 0, success: 0, failed: 0, cancelled: 0 };
    for (const task of tasks) counts[task.status] = (counts[task.status] ?? 0) + 1;
    const settled = counts.success + counts.failed;
    const byTypeMap = new Map<string, { total: number; running: number; success: number; failed: number }>();
    for (const task of tasks) {
      const row = byTypeMap.get(task.taskType) ?? { total: 0, running: 0, success: 0, failed: 0 };
      row.total += 1;
      if (task.status === 'running') row.running += 1;
      if (task.status === 'success') row.success += 1;
      if (task.status === 'failed') row.failed += 1;
      byTypeMap.set(task.taskType, row);
    }
    const stats: AsyncTaskStats = {
      total: tasks.length,
      pending: counts.pending,
      running: counts.running,
      success: counts.success,
      failed: counts.failed,
      cancelled: counts.cancelled,
      avgDurationMs: 12_400,
      duration: { p50: 8_600, p95: 46_200, max: 128_000 },
      today: {
        submitted: tasks.length,
        success: counts.success,
        failed: counts.failed,
        yesterdaySubmitted: 5,
      },
      daily: Array.from({ length: 14 }, (_, i) => {
        const submitted = [2, 4, 3, 6, 5, 3, 7, 3, 5, 2, 6, 4, 7, tasks.length][i] ?? 3;
        const failed = [0, 1, 0, 1, 0, 0, 2, 0, 1, 0, 1, 0, 2, counts.failed][i] ?? 0;
        return {
          date: mockDateOffset(-(13 - i)),
          submitted,
          failed,
          success: Math.max(submitted - failed - (i === 13 ? counts.pending + counts.running : 0), 0),
        };
      }),
      hourly: Array.from({ length: 24 }, (_, i) => {
        const submitted = [0, 0, 1, 0, 0, 0, 0, 2, 3, 5, 4, 2, 1, 2, 4, 3, 2, 1, 0, 1, 0, 0, 0, 0][i] ?? 0;
        return {
          hour: dayjs().startOf('hour').subtract(23 - i, 'hour').format('YYYY-MM-DD HH:00'),
          submitted,
          failed: submitted > 3 ? 1 : 0,
        };
      }),
      successRate: percentOf(counts.success, settled),
      backlog: {
        pending: counts.pending,
        oldestPendingMinutes: counts.pending > 0 ? 12 : null,
      },
      retried: tasks.filter((task) => task.attempts > 1).length,
      retriedRecovered: tasks.filter((task) => task.attempts > 1 && task.status === 'success').length,
      items: {
        processed: tasks.reduce((sum, task) => sum + task.processedCount, 0),
        failed: tasks.reduce((sum, task) => sum + task.failedCount, 0),
      },
      topSubmitters: [
        { userId: 1, username: '管理员', count: 18, failed: 1 },
        { userId: 2, username: '张三', count: 9, failed: 0 },
        { userId: 3, username: '李四', count: 6, failed: 2 },
        { userId: null, username: '系统', count: 4, failed: 0 },
      ],
      byType: [...byTypeMap.entries()]
        .map(([taskType, row]) => {
          const meta = taskTypes.find((item) => item.taskType === taskType);
          const settledOfType = row.success + row.failed;
          return {
            taskType,
            title: meta?.title ?? taskType,
            module: meta?.module ?? null,
            total: row.total,
            running: row.running,
            success: row.success,
            failed: row.failed,
            successRate: percentOf(row.success, settledOfType),
            avgDurationMs: row.success > 0 ? 9800 : null,
          };
        })
        .sort((a, b) => b.total - a.total),
    };
    return ok(stats);
  }),

  mock(asyncTaskContract.mine, ({ query, ok, paginate }) => {
    tickAll();
    return ok(paginate(filterTasks(query, tasks)));
  }),

  mock(asyncTaskContract.list, ({ query, ok, paginate }) => {
    tickAll();
    return ok(paginate(filterTasks(query, tasks)));
  }),

  mock(asyncTaskContract.cleanup, ({ ok }) => ok({ cleaned: 0 }, '已清理 0 条任务记录')),

  mock(asyncTaskContract.batchCancel, ({ body, ok }) => {
    tickAll();
    let affected = 0;
    for (const id of body.ids) {
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
    return ok({ affected }, `已请求取消 ${affected} 个任务`);
  }),

  mock(asyncTaskContract.batchDelete, ({ body, ok }) => {
    let affected = 0;
    for (const id of body.ids) {
      const index = tasks.findIndex((item) => item.id === id && isAsyncTaskTerminal(item.status));
      if (index >= 0) {
        itemsByTask.delete(tasks[index].id);
        tasks.splice(index, 1);
        affected++;
      }
    }
    return ok({ affected }, `已删除 ${affected} 个任务记录`);
  }),

  mock(asyncTaskContract.items, ({ params, query, ok, paginate }) => {
    tickAll();
    const all = (itemsByTask.get(params.id) ?? [])
      .filter((item) => !query.status || item.status === query.status)
      .sort((a, b) => b.id - a.id);
    return ok(paginate(all));
  }),

  mock(asyncTaskContract.detail, ({ params, ok }) => {
    tickAll();
    const task = findTask(params.id);
    if (!task) return notFound('任务不存在', { status: 404 });
    return ok(task);
  }),

  mock(asyncTaskContract.cancel, ({ params, ok }) => {
    tickAll();
    const task = findTask(params.id);
    if (!task) return notFound('任务不存在', { status: 404 });
    if (task.status === 'pending') {
      retryAt.delete(task.id);
      task.cancelRequested = true;
      finalize(task, 'cancelled');
    } else if (task.status === 'running') {
      task.cancelRequested = true; // 协作式取消：下一次轮询 tick 生效
      task.updatedAt = mockDateTime();
    } else {
      return badRequest('仅待执行或执行中的任务可以取消', { status: 400 });
    }
    return ok(task, '已请求取消');
  }),

  mock(asyncTaskContract.resume, ({ params, ok }) => {
    const task = findTask(params.id);
    if (!task) return notFound('任务不存在', { status: 404 });
    if (!['failed', 'cancelled'].includes(task.status)) {
      return badRequest('仅失败或已取消的任务可以断点恢复', { status: 400 });
    }
    task.cancelRequested = false;
    task.errorMessage = null;
    task.completedAt = null;
    task.nextRunAt = null;
    startSim(task); // 保留 processedCount 作为断点续跑起点
    return ok(task, '已从断点恢复');
  }),

  mock(asyncTaskContract.restart, ({ params, ok }) => {
    const task = findTask(params.id);
    if (!task) return notFound('任务不存在', { status: 404 });
    if (!isAsyncTaskTerminal(task.status)) {
      return badRequest('仅已结束的任务可以重新开始', { status: 400 });
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
    return ok(task, '已重新开始');
  }),

  mock(asyncTaskContract.remove, ({ params, ok }) => {
    const index = tasks.findIndex((item) => item.id === params.id);
    if (index === -1) return notFound('任务不存在', { status: 404 });
    if (!isAsyncTaskTerminal(tasks[index].status)) {
      return badRequest('进行中的任务不能删除，请先取消', { status: 400 });
    }
    sims.delete(tasks[index].id);
    itemsByTask.delete(tasks[index].id);
    tasks.splice(index, 1);
    return ok(null, '已删除');
  }),

  mock(taskDemoContract.submit, ({ body, ok }) => {
    tickAll();
    const meta = taskTypes.find((item) => item.taskType === body.taskType);
    if (!meta) return badRequest('任务类型未注册', { status: 400 });
    if (!meta.enabled) {
      return badRequest(`「${meta.title}」已暂停提交，请联系管理员`, { status: 400 });
    }
    if (!meta.allowConcurrent) {
      const unfinished = tasks.some((t) => t.taskType === body.taskType && ['pending', 'running'].includes(t.status));
      if (unfinished) {
        return badRequest(`已有进行中的「${meta.title}」任务，请等待其结束后再提交`, { status: 400 });
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
      retryDelayMs: meta.retryDelayMs,
      nextRunAt: null,
      createdBy: 1,
      createdByName: '管理员',
      tenantId: null,
      traceId: null,
      startedAt: null,
      completedAt: null,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    tasks.unshift(task);
    startSim(task); // Demo 模式立即开始执行
    return ok(task, '任务已提交，可在下方列表查看进度');
  }),
];
