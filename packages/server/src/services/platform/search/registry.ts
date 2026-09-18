import type { GlobalSearchType } from '@zenith/shared/platform';
import { hasPermission } from '../../../lib/context';
import logger from '../../../lib/logger';
import { createConcurrencyLimiter } from '../../../lib/concurrency';
import { memberSearchAdapter } from './adapters/member.adapter';
import { orderSearchAdapter } from './adapters/order.adapter';
import { userSearchAdapter } from './adapters/user.adapter';
import { workflowSearchAdapter } from './adapters/workflow.adapter';
import { iotAlarmSearchAdapter, iotDeviceSearchAdapter } from './adapters/iot.adapter';
import { driveSearchAdapter } from './adapters/drive.adapter';
import { announcementSearchAdapter } from './adapters/announcement.adapter';
import { cmsContentSearchAdapter } from './adapters/cms.adapter';
import { wikiDocumentSearchAdapter } from './adapters/wiki.adapter';
import { chatMessageSearchAdapter } from './adapters/chat.adapter';
import { bizLeaveSearchAdapter } from './adapters/biz-leave.adapter';
import { reportDashboardSearchAdapter, reportDatasetSearchAdapter } from './adapters/report.adapter';
import { aiKnowledgeBaseSearchAdapter, asyncTaskSearchAdapter } from './adapters/ai-task.adapter';
import { exceptionLogSearchAdapter, operationLogSearchAdapter } from './adapters/log.adapter';
import type { GlobalSearchAdapter, GlobalSearchInput } from './types';
import { recordGlobalSearchMetric } from './metrics';

/**
 * 统一搜索注册表：新增领域只需实现一个适配器并在这里注册，编排层和顶部搜索无需改动。
 * 适配器自己仍保留权限与查询边界检查，注册表权限元数据用于快速跳过无权领域。
 */
export const globalSearchAdapters: readonly GlobalSearchAdapter[] = [
  userSearchAdapter,
  memberSearchAdapter,
  orderSearchAdapter,
  workflowSearchAdapter,
  iotDeviceSearchAdapter,
  iotAlarmSearchAdapter,
  driveSearchAdapter,
  cmsContentSearchAdapter,
  wikiDocumentSearchAdapter,
  announcementSearchAdapter,
  chatMessageSearchAdapter,
  bizLeaveSearchAdapter,
  reportDashboardSearchAdapter,
  reportDatasetSearchAdapter,
  aiKnowledgeBaseSearchAdapter,
  asyncTaskSearchAdapter,
  operationLogSearchAdapter,
  exceptionLogSearchAdapter,
];

const ADAPTER_TIMEOUT_MS = 1200;
const SLOW_ADAPTER_LOG_MS = 400;
const MAX_MERGED_RESULTS = 30;
const globalSearchQueryLimiter = createConcurrencyLimiter(6);

function selectedAdapters(types: string | undefined, adapters: readonly GlobalSearchAdapter[]): GlobalSearchAdapter[] {
  if (!types?.trim()) return [...adapters];
  const requested = new Set(types.split(',').map((value) => value.trim()).filter(Boolean));
  return adapters.filter((adapter) => requested.has(adapter.type));
}

function withTimeout<T>(task: () => Promise<T>, timeoutMs: number): Promise<T> {
  const promise = globalSearchQueryLimiter.run(task);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('search adapter timeout')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

function scoreResult(item: Awaited<ReturnType<GlobalSearchAdapter['search']>>[number], query: string): number {
  const q = query.trim().toLocaleLowerCase();
  const title = item.title.toLocaleLowerCase();
  if (title === q) return 100;
  if (title.startsWith(q)) return 85;
  if (title.includes(q)) return 70;
  if (item.subtitle?.toLocaleLowerCase().includes(q)) return 50;
  if (item.highlights.some((highlight) => highlight.text.toLocaleLowerCase().includes(q))) return 40;
  if (item.description?.toLocaleLowerCase().includes(q)) return 25;
  return 0;
}

function rankAndDedupe(
  results: Awaited<ReturnType<GlobalSearchAdapter['search']>>,
  query: string,
): Awaited<ReturnType<GlobalSearchAdapter['search']>> {
  const byIdentity = new Map<string, { item: Awaited<ReturnType<GlobalSearchAdapter['search']>>[number]; score: number; index: number }>();
  results.forEach((item, index) => {
    const score = scoreResult(item, query);
    const key = `${item.type}:${item.id}`;
    const existing = byIdentity.get(key);
    if (!existing || score > existing.score) byIdentity.set(key, { item, score, index });
  });
  return [...byIdentity.values()]
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MAX_MERGED_RESULTS)
    .map(({ item }) => item);
}

export interface GlobalSearchRunResult {
  readonly results: Awaited<ReturnType<GlobalSearchAdapter['search']>>;
  readonly failedTypes: GlobalSearchType[];
}

export async function runGlobalSearch(
  input: GlobalSearchInput,
  types?: string,
  adapters: readonly GlobalSearchAdapter[] = globalSearchAdapters,
  timeoutMs = ADAPTER_TIMEOUT_MS,
): Promise<GlobalSearchRunResult> {
  const selected = selectedAdapters(types, adapters);
  const settled = await Promise.all(selected.map(async (adapter) => {
    const startedAt = Date.now();
    try {
      if (adapter.permissions !== 'authenticated' && !(await hasPermission(...adapter.permissions))) {
        return { type: adapter.type, results: [], failed: false } as const;
      }
      const results = await withTimeout(() => adapter.search(input), adapter.timeoutMs ?? timeoutMs);
      const durationMs = Date.now() - startedAt;
      recordGlobalSearchMetric(adapter.type, 'success', durationMs);
      if (durationMs >= SLOW_ADAPTER_LOG_MS) logger.debug('[global-search] slow adapter', { type: adapter.type, durationMs });
      return { type: adapter.type, results, failed: false } as const;
    } catch (error) {
      recordGlobalSearchMetric(adapter.type, error instanceof Error && error.message.includes('timeout') ? 'timeout' : 'failure', Date.now() - startedAt);
      logger.warn('[global-search] adapter failed', {
        type: adapter.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return { type: adapter.type, results: [], failed: true } as const;
    }
  }));
  return {
    results: rankAndDedupe(settled.flatMap((item) => item.results), input.q),
    failedTypes: settled.filter((item) => item.failed).map((item) => item.type),
  };
}
