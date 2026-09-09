import { MockHttpError } from './contract';
import { notFound } from './handlers';

/** mock 行的主键：绝大多数为自增数字，少数（评测集 / 实验等）用字符串 */
type WithId = { id: number | string };

/**
 * 按 id 取行，找不到抛 `MockHttpError`（`mock()` 映射为 `notFound(message, init)` 响应）。
 * `init` 与 `notFound` 的第二参数一致：需要与真实后端同样返回 HTTP 404 时传 `{ status: 404 }`，
 * 省略则沿用历史上「HTTP 200 + code 404」的写法。
 */
export function requireItem<T extends WithId>(list: readonly T[], id: T['id'], message: string, init?: ResponseInit): T {
  const item = list.find((entry) => entry.id === id);
  if (!item) throw new MockHttpError(notFound(message, init));
  return item;
}

export function updateItem<T extends WithId, P extends object>(
  list: readonly T[],
  id: T['id'],
  patch: P,
  { notFoundMessage, now, init }: { notFoundMessage: string; now?: () => string; init?: ResponseInit },
): T & P {
  const item = requireItem(list, id, notFoundMessage, init) as T & P & { updatedAt?: string };
  Object.assign(item, patch, now ? { updatedAt: now() } : undefined);
  return item;
}

export function removeByIds<T extends WithId>(list: T[], ids: readonly T['id'][]): number {
  const selected = new Set<T['id']>(ids);
  let removed = 0;
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (selected.has(list[index].id)) {
      list.splice(index, 1);
      removed += 1;
    }
  }
  return removed;
}

/** 按 id 删除一行并返回它；找不到抛 `MockHttpError`（等价于 findIndex → notFound → splice 三行样板） */
export function removeItem<T extends WithId>(list: T[], id: T['id'], message: string, init?: ResponseInit): T {
  const item = requireItem(list, id, message, init);
  removeByIds(list, [id]);
  return item;
}
