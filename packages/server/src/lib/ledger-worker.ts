/** Scheduler-owned execution pool for a durable database ledger. Notifications are hints;
 * polling and completion refill always consult the ledger, including old IDs and future jobs. */
export interface LedgerWorkerRegistration<T> {
  concurrency: number;
  pollingIntervalMs?: number;
  claim: (available: number) => Promise<T[]>;
  execute: (item: T) => Promise<unknown>;
  onError: (error: unknown) => void;
}

export function createLedgerWorker<T>(registration: LedgerWorkerRegistration<T>) {
  const concurrency = Math.max(1, Math.floor(registration.concurrency));
  const inFlight = new Set<Promise<unknown>>();
  let stopped = true;
  let pumping: Promise<void> | null = null;
  let notified = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const armPoll = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => { timer = null; wake(); }, registration.pollingIntervalMs ?? 2000);
    timer.unref?.();
  };
  const pump = async () => {
    try {
      do {
        notified = false;
        while (!stopped && inFlight.size < concurrency) {
          const items = await registration.claim(concurrency - inFlight.size);
          if (!items.length) break;
          // Claim only free slots: leases must never sit in an in-memory waiting queue.
          for (const item of items) {
            const execution = Promise.resolve().then(() => registration.execute(item))
              .catch(registration.onError).finally(() => { inFlight.delete(execution); wake(); });
            inFlight.add(execution);
          }
        }
      } while (notified && !stopped && inFlight.size < concurrency);
    } catch (error) {
      registration.onError(error);
    } finally {
      pumping = null;
      armPoll();
    }
  };
  function wake() {
    if (stopped) return;
    notified = true;
    if (!pumping) pumping = Promise.resolve().then(pump);
    armPoll();
  }
  return {
    start() { stopped = false; wake(); },
    wake,
    get active() { return inFlight.size; },
    get concurrency() { return concurrency; },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await pumping;
      await Promise.allSettled([...inFlight]);
    },
  };
}
