import { AsyncLocalStorage } from 'node:async_hooks';

const consumerContext = new AsyncLocalStorage<string>();
export function runInEventConsumer<T>(key: string, operation: () => Promise<T>): Promise<T> {
  return consumerContext.run(key, operation);
}
export function assertOutsideEventConsumer(): void {
  const key = consumerContext.getStore();
  if (key) throw new Error(`External HTTP is forbidden inside event consumer transaction: ${key}`);
}
