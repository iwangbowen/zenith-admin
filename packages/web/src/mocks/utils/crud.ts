import { MockHttpError } from './contract';
import { notFound } from './handlers';

export function requireItem<T extends { id: number }>(list: readonly T[], id: number, message: string): T {
  const item = list.find((entry) => entry.id === id);
  if (!item) throw new MockHttpError(notFound(message));
  return item;
}

export function updateItem<T extends { id: number }, P extends object>(
  list: readonly T[],
  id: number,
  patch: P,
  { notFoundMessage, now }: { notFoundMessage: string; now?: () => string },
): T & P {
  const item = requireItem(list, id, notFoundMessage) as T & P & { updatedAt?: string };
  Object.assign(item, patch, now ? { updatedAt: now() } : undefined);
  return item;
}

export function removeByIds<T extends { id: number }>(list: T[], ids: readonly number[]): number {
  const selected = new Set(ids);
  let removed = 0;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (selected.has(list[index].id)) {
      list.splice(index, 1);
      removed += 1;
    }
  }
  return removed;
}
