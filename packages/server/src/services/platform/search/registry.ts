import type { GlobalSearchType } from '@zenith/shared/platform';
import { hasPermission } from '../../../lib/context';
import logger from '../../../lib/logger';
import { memberSearchAdapter } from './adapters/member.adapter';
import { orderSearchAdapter } from './adapters/order.adapter';
import { userSearchAdapter } from './adapters/user.adapter';
import type { GlobalSearchAdapter, GlobalSearchInput } from './types';

/**
 * 统一搜索注册表：新增领域只需实现一个适配器并在这里注册，编排层和顶部搜索无需改动。
 * 适配器自己仍保留权限与查询边界检查，注册表权限元数据用于快速跳过无权领域。
 */
export const globalSearchAdapters: readonly GlobalSearchAdapter[] = [
  userSearchAdapter,
  memberSearchAdapter,
  orderSearchAdapter,
];

const ADAPTER_TIMEOUT_MS = 800;

function selectedAdapters(types?: string): GlobalSearchAdapter[] {
  if (!types?.trim()) return [...globalSearchAdapters];
  const requested = new Set(types.split(',').map((value) => value.trim()).filter(Boolean));
  return globalSearchAdapters.filter((adapter) => requested.has(adapter.type));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('search adapter timeout')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

export interface GlobalSearchRunResult {
  readonly results: Awaited<ReturnType<GlobalSearchAdapter['search']>>;
  readonly failedTypes: GlobalSearchType[];
}

export async function runGlobalSearch(input: GlobalSearchInput, types?: string): Promise<GlobalSearchRunResult> {
  const adapters = selectedAdapters(types);
  const settled = await Promise.all(adapters.map(async (adapter) => {
    try {
      if (!(await hasPermission(...adapter.permissions))) {
        return { type: adapter.type, results: [], failed: false } as const;
      }
      return { type: adapter.type, results: await withTimeout(adapter.search(input), ADAPTER_TIMEOUT_MS), failed: false } as const;
    } catch (error) {
      logger.warn('[global-search] adapter failed', {
        type: adapter.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return { type: adapter.type, results: [], failed: true } as const;
    }
  }));
  return {
    results: settled.flatMap((item) => item.results),
    failedTypes: settled.filter((item) => item.failed).map((item) => item.type),
  };
}
