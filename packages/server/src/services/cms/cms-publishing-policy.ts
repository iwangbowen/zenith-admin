import { createHash } from 'node:crypto';
import type { CmsPublishSubmitInput } from '@zenith/shared';
import { canonicalizeCmsJson } from '../../cms/templates/dsl';

export const CMS_REUSABLE_PUBLISH_TASK_STATUSES = ['pending', 'running'] as const;

export function isReusableCmsPublishTaskStatus(status: string): boolean {
  return (CMS_REUSABLE_PUBLISH_TASK_STATUSES as readonly string[]).includes(status);
}

export function canAccessCmsPublishingTask(input: {
  userId: number;
  createdBy: number | null;
  siteIds: readonly number[];
  accessibleSiteIds: readonly number[];
  global: boolean;
}): boolean {
  if (input.siteIds.length === 0 || input.siteIds.some((siteId) => !Number.isInteger(siteId) || siteId <= 0)) return false;
  if (input.global) return true;
  return input.createdBy === input.userId
    && input.siteIds.every((siteId) => input.accessibleSiteIds.includes(siteId));
}

export function buildCmsPublishDedupeFingerprint(
  input: CmsPublishSubmitInput,
  userId: number,
): string {
  const normalized = {
    userId,
    ...input,
    contentIds: [...new Set(input.contentIds ?? [])].sort((a, b) => a - b),
  };
  return createHash('sha256')
    .update(canonicalizeCmsJson(normalized))
    .digest('hex')
    .slice(0, 48);
}

export function stableCmsContentTargets(ids: readonly number[]): number[] {
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].sort((a, b) => a - b);
}

export function remainingCmsContentTargets(ids: readonly number[], lastId: number): number[] {
  return stableCmsContentTargets(ids).filter((id) => id > lastId);
}

export function cmsPublishingTaskSiteIds(row: { taskType: string; payload: unknown }): number[] {
  const payload = row.payload as { siteId?: unknown; siteIds?: unknown } | null;
  if (row.taskType === 'cms-theme-rebuild' && Array.isArray(payload?.siteIds)) {
    return [...new Set(payload.siteIds.map(Number).filter((siteId) => Number.isInteger(siteId) && siteId > 0))]
      .sort((a, b) => a - b);
  }
  const siteId = Number(payload?.siteId);
  return Number.isInteger(siteId) && siteId > 0 ? [siteId] : [];
}
