import type { DbExecutor } from '../db/types';

const effects = new WeakMap<DbExecutor, Map<string, () => Promise<unknown>>>();
/** Hints are disposable; durable work must already be stored by the caller's transaction. */
export function rememberTransactionEffect(tx: DbExecutor, key: string, effect: () => Promise<unknown>): void {
  const pending = effects.get(tx) ?? new Map();
  pending.set(key, effect); effects.set(tx, pending);
}
/** Only call after commit. A rolled back executor is never flushed. */
export async function flushTransactionEffects(tx: DbExecutor): Promise<void> {
  const pending = effects.get(tx); effects.delete(tx);
  await Promise.allSettled([...(pending?.values() ?? [])].map((effect) => Promise.resolve().then(effect)));
}
