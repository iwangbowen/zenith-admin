import logger from '../lib/logger';

/** 给停机清理步骤加超时：任一外部资源关闭卡住不应阻塞进程退出 */
export function withTimeout(label: string, p: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p.then(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        logger.warn(`Shutdown step "${label}" timed out after ${ms}ms, continuing`);
        resolve();
      }, ms).unref();
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
