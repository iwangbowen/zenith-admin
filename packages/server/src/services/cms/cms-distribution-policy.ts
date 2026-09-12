import { HTTPException } from 'hono/http-exception';
import type { CmsDistributionConflictStrategy, CmsDistributionFilters, CmsDistributionMode } from '@zenith/shared/cms';

export function assertCmsDistributionScope(input: {
  sourceSiteId: number;
  sourceChannelId: number | null;
  targetSiteId: number;
  targetChannelId: number;
  mode: CmsDistributionMode;
  scheduleCron: string | null;
  filters: CmsDistributionFilters;
}): void {
  if (input.sourceSiteId === input.targetSiteId) {
    throw new HTTPException(400, { message: '来源站点与目标站点不能相同' });
  }
  if (input.sourceChannelId != null && input.sourceChannelId === input.targetChannelId) {
    throw new HTTPException(400, { message: '来源栏目与目标栏目不能相同' });
  }
  if (input.filters.statuses.length !== 1 || input.filters.statuses[0] !== 'published') {
    throw new HTTPException(400, { message: '分发规则仅允许处理已发布内容，禁止草稿跨站泄露' });
  }
  if (input.mode === 'scheduled' && !input.scheduleCron) {
    throw new HTTPException(400, { message: '定时同步必须配置 Cron 表达式' });
  }
  if (input.mode !== 'scheduled' && input.scheduleCron) {
    throw new HTTPException(400, { message: '仅定时同步模式可配置 Cron 表达式' });
  }
}

export type CmsDistributionConflictDecision =
  | 'create'
  | 'update-tracked'
  | 'skip'
  | 'overwrite'
  | 'create-new'
  | 'locked';

export function decideCmsDistributionConflict(input: {
  tracked: boolean;
  conflict: boolean;
  locked: boolean;
  strategy: CmsDistributionConflictStrategy;
}): CmsDistributionConflictDecision {
  if (input.locked) return 'locked';
  if (input.tracked) return 'update-tracked';
  if (!input.conflict) return 'create';
  return input.strategy;
}

export function cmsDistributionIdempotencyKey(input: {
  ruleId: number;
  revision: number;
  trigger: 'manual' | 'scheduled' | 'mapping-update';
  watermark: string;
}): string {
  return `cms-dist:${input.ruleId}:r${input.revision}:${input.trigger}:${input.watermark}`.slice(0, 128);
}
