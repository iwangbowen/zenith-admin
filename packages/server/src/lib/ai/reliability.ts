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
