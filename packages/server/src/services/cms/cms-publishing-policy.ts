import { uniquePositiveInts } from '@zenith/shared/core';
import { createHash } from 'node:crypto';
import type { CmsPublishSubmitInput } from '@zenith/shared/cms';

/** 递归按 key 排序的 canonical JSON（用于提交去重指纹） */
function canonicalizeCmsJson(value: unknown): string {
  const canonical = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') {
      return Object.fromEntries(
        Object.keys(input as Record<string, unknown>).sort().map((key) => [key, canonical((input as Record<string, unknown>)[key])]),
      );
    }
    return input;
  };
  return JSON.stringify(canonical(value));
}

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
  return uniquePositiveInts(ids).sort((a, b) => a - b);
}

export function remainingCmsContentTargets(ids: readonly number[], lastId: number): number[] {
  return stableCmsContentTargets(ids).filter((id) => id > lastId);
}

export function cmsPublishingTaskSiteIds(row: { payload: unknown }): number[] {
  const payload = row.payload as { siteId?: unknown } | null;
  const siteId = Number(payload?.siteId);
  return Number.isInteger(siteId) && siteId > 0 ? [siteId] : [];
}
