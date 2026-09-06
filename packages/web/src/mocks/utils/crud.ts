import { MockHttpError } from './contract';
import { notFound } from './handlers';

/**
 * 按 id 取行，找不到抛 `MockHttpError`（`mock()` 映射为 `notFound(message, init)` 响应）。
 * `init` 与 `notFound` 的第二参数一致：需要与真实后端同样返回 HTTP 404 时传 `{ status: 404 }`，
 * 省略则沿用历史上「HTTP 200 + code 404」的写法。
 */
export function requireItem<T extends { id: number }>(list: readonly T[], id: number, message: string, init?: ResponseInit): T {
  const item = list.find((entry) => entry.id === id);
  if (!item) throw new MockHttpError(notFound(message, init));
  return item;
}

export function updateItem<T extends { id: number }, P extends object>(
  list: readonly T[],
  id: number,
  patch: P,
  { notFoundMessage, now, init }: { notFoundMessage: string; now?: () => string; init?: ResponseInit },
): T & P {
  const item = requireItem(list, id, notFoundMessage, init) as T & P & { updatedAt?: string };
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
