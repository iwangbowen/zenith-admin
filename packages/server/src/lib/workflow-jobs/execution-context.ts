import { AsyncLocalStorage } from 'node:async_hooks';
import type { WorkflowJobContext } from './types';

const executionStorage = new AsyncLocalStorage<WorkflowJobContext>();
const deferredEffects = new WeakMap<WorkflowJobContext, Promise<unknown>[]>();

export const currentWorkflowJobContext = () => executionStorage.getStore();

export function runWithWorkflowJobContext<T>(context: WorkflowJobContext, fn: () => T): T {
  return executionStorage.run(context, fn);
}

export function deferWorkflowJobEffect(context: WorkflowJobContext, effect: Promise<unknown>): void {
  const effects = deferredEffects.get(context) ?? [];
  effects.push(effect);
  deferredEffects.set(context, effects);
  void effect.catch(() => undefined);
}

/** Drain all effects registered by synchronous post-transaction adapters before final success. */
export async function flushWorkflowJobEffects(context: WorkflowJobContext): Promise<void> {
  while (true) {
    const effects = deferredEffects.get(context);
    if (!effects?.length) {
      deferredEffects.delete(context);
      return;
    }
    deferredEffects.set(context, []);
    await Promise.all(effects);
  }
}
