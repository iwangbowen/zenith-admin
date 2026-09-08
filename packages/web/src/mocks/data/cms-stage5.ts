import type { CmsDistributionRule, CmsDistributionRun } from '@zenith/shared/cms';
import { SEED_CMS_DISTRIBUTION_RULES, SEED_CMS_DISTRIBUTION_TASK_ITEMS, SEED_CMS_DISTRIBUTION_TASKS } from '@zenith/shared/seed';
import type { AsyncTaskItem } from '@zenith/shared/tasks';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockCmsDistributionRules: CmsDistributionRule[] =
  SEED_CMS_DISTRIBUTION_RULES.map((rule) => structuredClone(rule));

export const mockCmsDistributionRuns: CmsDistributionRun[] =
  SEED_CMS_DISTRIBUTION_TASKS.map((task) => {
    const result = task.result;
    return {
      ...task,
      module: 'CMS内容管理',
      errorMessage: null,
      cancelRequested: false,
      retryDelayMs: 5000,
      nextRunAt: null,
      createdBy: 1,
      createdByName: '管理员',
      tenantId: null,
      traceId: null,
      ruleId: Number(task.payload.ruleId),
      ruleName: SEED_CMS_DISTRIBUTION_RULES.find((rule) => rule.id === Number(task.payload.ruleId))?.name ?? null,
      sourceSiteId: Number(task.payload.sourceSiteId),
      sourceSiteName: 'Zenith 官方网站',
      targetSiteId: Number(task.payload.targetSiteId),
      targetSiteName: 'Zenith 技术子站',
      trigger: task.payload.trigger as CmsDistributionRun['trigger'],
      succeeded: Number(result.succeeded),
      skipped: Number(result.skipped),
      conflicts: Number(result.conflicts),
    };
  });

export const mockCmsDistributionItems = new Map<number, AsyncTaskItem[]>([
  [
    mockCmsDistributionRuns[0].id,
    SEED_CMS_DISTRIBUTION_TASK_ITEMS.map((item, index) => ({
      id: index + 1,
      taskId: mockCmsDistributionRuns[0].id,
      itemKey: item.key,
      label: item.label,
      status: item.status,
      message: item.message,
      data: structuredClone(item.data),
      attempt: 1,
      createdAt: mockCmsDistributionRuns[0].createdAt,
      updatedAt: mockCmsDistributionRuns[0].updatedAt,
    })),
  ],
]);

let nextRuleId = nextIdFrom(mockCmsDistributionRules);
let nextRunId = nextIdFrom(mockCmsDistributionRuns);
let nextItemId = Math.max(0, ...[...mockCmsDistributionItems.values()].flat().map((item) => item.id)) + 1;

export function getNextCmsDistributionRuleId(): number {
  return nextRuleId++;
}

export function getNextCmsDistributionRunId(): number {
  return nextRunId++;
}

export function getNextCmsDistributionItemId(): number {
  return nextItemId++;
}
