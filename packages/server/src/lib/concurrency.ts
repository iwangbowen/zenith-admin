/**
 * 并发受限映射：最多 concurrency 个并发执行 mapper，保持结果与输入顺序一致。
 * 用于仪表盘批量取数等「一次请求扇出 N 个子查询」的场景，防止大盘一次性打爆连接池/外部数据源。
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface ConcurrencyLimiter {
  /** 在限流器内执行任务：有空位立即开始，否则按先来后到排队 */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** 正在执行的任务数 */
  readonly active: number;
  /** 排队等待空位的任务数 */
  readonly pending: number;
}

/**
 * 进程级并发限流器：限制的是「跨调用方的总在飞数」，与 `mapWithConcurrency` 的「一批之内」互补。
 * 用于渠道出站这类多个入口（定时补投、请求内立即派发）会同时触发、而下游连接数有硬上限的场景。
 */
export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  const limit = Math.max(1, Math.floor(max));
  let active = 0;
  const waiters: Array<() => void> = [];
  // 释放时若有人在等，直接把名额交给它（active 不变），避免「减一 → 新来者插队 → 等待者再加一」瞬时超限
  const release = () => {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  };
  return {
    async run(task) {
      if (active >= limit) await new Promise<void>((resolve) => waiters.push(resolve));
      else active += 1;
      try {
        return await task();
      } finally {
        release();
      }
    },
    get active() {
      return active;
    },
    get pending() {
      return waiters.length;
    },
  };
}
