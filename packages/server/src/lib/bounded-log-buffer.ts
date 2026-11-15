import logger from './logger';

/** Bounded batch sink with counters; no database work starts on the request stack. */
export function createBoundedLogBuffer<T>(label: string, write: (entries: T[]) => Promise<unknown>) {
  const queue: T[] = [];
  const stats = { accepted: 0, stored: 0, dropped: 0, flushFailures: 0 };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let stopped = false;
  let lastWarn = 0;
  const warn = () => {
    if (Date.now() - lastWarn < 30_000) return;
    lastWarn = Date.now();
    logger.warn(label + ' entries dropped', { ...stats, pending: queue.length });
  };
  const flush = (): Promise<void> => {
    if (timer) { clearTimeout(timer); timer = undefined; }
    if (inFlight) return inFlight;
    if (queue.length === 0) return Promise.resolve();
    inFlight = (async () => {
      while (queue.length > 0) {
        const batch = queue.splice(0, 100);
        try { await write(batch); stats.stored += batch.length; }
        catch (error) {
          stats.flushFailures += 1;
          stats.dropped += batch.length;
          // Report the SQLSTATE only: database errors may otherwise embed the request snapshot.
          const raw = error as { code?: string; cause?: { code?: string } } | null | undefined;
          const code = raw?.code ?? raw?.cause?.code ?? null;
          if (stats.flushFailures === 1) logger.warn(label + ' persistence failed', { sqlState: code, errorType: error instanceof Error ? error.name : typeof error });
          warn();
        }
      }
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  return {
    enqueue(entry: T): void {
      if (stopped) { stats.dropped += 1; return; }
      stats.accepted += 1;
      if (queue.length >= 2_000) { stats.dropped += 1; warn(); return; }
      queue.push(entry);
      if (!timer && !inFlight) timer = setTimeout(() => { void flush().catch(warn); }, 50).unref();
    },
    flush,
    async stop(): Promise<void> { stopped = true; await flush(); },
    stats: () => ({ ...stats, pending: queue.length, flushing: inFlight !== undefined }),
  };
}

