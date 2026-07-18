import redis from '../redis';
import { config } from '../../config';
import dayjs from 'dayjs';
import logger from '../logger';

const REQ_PREFIX = `${config.redis.keyPrefix}ai:req:`;
const ERR_PREFIX = `${config.redis.keyPrefix}ai:err:`;
/** 计数保留 40 天，覆盖常用统计窗口 */
const TTL_SECONDS = 40 * 24 * 60 * 60;

function today(): string {
  return dayjs().format('YYYY-MM-DD');
}

async function incr(key: string) {
  try {
    await redis.multi().incr(key).expire(key, TTL_SECONDS).exec();
  } catch (err) {
    logger.warn('[ai-reliability] counter incr failed', err);
  }
}

/** 记录一次 AI 对话请求（开始生成时调用） */
export function recordAiRequest(): void {
  void incr(`${REQ_PREFIX}${today()}`);
}

/** 记录一次 AI 对话失败（上游错误 / 异常时调用；用户主动中断不计） */
export function recordAiError(): void {
  void incr(`${ERR_PREFIX}${today()}`);
}

export interface AiReliability {
  /** 范围内请求总数（无数据为 0） */
  requests: number;
  errors: number;
  /** 成功率（0-100），无请求数据时为 null */
  successRate: number | null;
}

/**
 * 读取日期范围内的请求/失败计数（含两端，最多回溯 92 天）。
 */
export async function getAiReliability(startDate?: string, endDate?: string): Promise<AiReliability> {
  const end = endDate ? dayjs(endDate) : dayjs();
  let start = startDate ? dayjs(startDate) : end.subtract(29, 'day');
  if (!start.isValid() || !end.isValid()) return { requests: 0, errors: 0, successRate: null };
  if (end.diff(start, 'day') > 92) start = end.subtract(92, 'day');

  const dates: string[] = [];
  for (let d = start; !d.isAfter(end, 'day'); d = d.add(1, 'day')) {
    dates.push(d.format('YYYY-MM-DD'));
  }
  if (dates.length === 0) return { requests: 0, errors: 0, successRate: null };

  try {
    const [reqVals, errVals] = await Promise.all([
      redis.mget(dates.map((d) => `${REQ_PREFIX}${d}`)),
      redis.mget(dates.map((d) => `${ERR_PREFIX}${d}`)),
    ]);
    const sum = (vals: (string | null)[]) => vals.reduce((acc, v) => acc + (Number(v) || 0), 0);
    const requests = sum(reqVals);
    const errors = sum(errVals);
    const successRate = requests > 0 ? Math.round(((requests - errors) / requests) * 10000) / 100 : null;
    return { requests, errors, successRate };
  } catch (err) {
    logger.warn('[ai-reliability] counter read failed', err);
    return { requests: 0, errors: 0, successRate: null };
  }
}

// ─── 并发信号量（per 服务商配置） ────────────────────────────────────────────

interface Semaphore {
  active: number;
  queue: Array<{ resolve: (release: () => void) => void; timer: NodeJS.Timeout }>;
}

const semaphores = new Map<number, Semaphore>();

/** 排队等待上限（毫秒），超时报错而非无限挂起 */
const ACQUIRE_TIMEOUT_MS = 15_000;

function releaseSlot(configId: number) {
  const sem = semaphores.get(configId);
  if (!sem) return;
  const next = sem.queue.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve(() => releaseSlot(configId));
  } else {
    sem.active = Math.max(0, sem.active - 1);
    if (sem.active === 0 && sem.queue.length === 0) semaphores.delete(configId);
  }
}

/**
 * 获取指定服务商配置的并发槽位。返回释放函数；maxConcurrent 为 null/0 表示不限（直接放行）。
 * 排队超过 15s 抛错，防止请求无限堆积。
 */
export async function acquireProviderSlot(configId: number | undefined, maxConcurrent: number | null | undefined): Promise<() => void> {
  if (!configId || !maxConcurrent || maxConcurrent <= 0) return () => {};
  let sem = semaphores.get(configId);
  if (!sem) {
    sem = { active: 0, queue: [] };
    semaphores.set(configId, sem);
  }
  if (sem.active < maxConcurrent) {
    sem.active += 1;
    return () => releaseSlot(configId);
  }
  return new Promise<() => void>((resolve, reject) => {
    const entry = {
      resolve,
      timer: setTimeout(() => {
        const idx = sem!.queue.indexOf(entry);
        if (idx >= 0) sem!.queue.splice(idx, 1);
        reject(new Error('当前模型并发繁忙，请稍后重试'));
      }, ACQUIRE_TIMEOUT_MS),
    };
    sem!.queue.push(entry);
  });
}
