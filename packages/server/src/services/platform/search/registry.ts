import type { GlobalSearchType } from '@zenith/shared/platform';
import { hasPermission } from '../../../lib/context';
import logger from '../../../lib/logger';
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
import type { GlobalSearchAdapter, GlobalSearchInput } from './types';

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
];

const ADAPTER_TIMEOUT_MS = 800;

function selectedAdapters(types: string | undefined, adapters: readonly GlobalSearchAdapter[]): GlobalSearchAdapter[] {
  if (!types?.trim()) return [...adapters];
  const requested = new Set(types.split(',').map((value) => value.trim()).filter(Boolean));
  return adapters.filter((adapter) => requested.has(adapter.type));
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

export async function runGlobalSearch(
  input: GlobalSearchInput,
  types?: string,
  adapters: readonly GlobalSearchAdapter[] = globalSearchAdapters,
  timeoutMs = ADAPTER_TIMEOUT_MS,
): Promise<GlobalSearchRunResult> {
  const selected = selectedAdapters(types, adapters);
  const settled = await Promise.all(selected.map(async (adapter) => {
    try {
      if (adapter.permissions !== 'authenticated' && !(await hasPermission(...adapter.permissions))) {
        return { type: adapter.type, results: [], failed: false } as const;
      }
      return { type: adapter.type, results: await withTimeout(adapter.search(input), timeoutMs), failed: false } as const;
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
