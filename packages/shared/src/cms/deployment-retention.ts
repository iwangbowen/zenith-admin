import * as z from 'zod';
import type { CMS_DEPLOYMENT_STATUSES, CMS_RELEASE_STATUSES } from './release-validation';
import type { CMS_DEPLOYMENT_STORAGE_STATES } from './constants';

export const saveCmsDeploymentRetentionSchema = z.object({ expectedVersion: z.int().min(0), retainCount: z.int().min(1).max(1000), retainDays: z.int().min(1).max(3650), failedRetainDays: z.int().min(0).max(3650), automatic: z.boolean() });
export const pinCmsDeploymentSchema = z.object({ expectedVersion: z.int().min(0), pinned: z.boolean(), reason: z.string().trim().max(500).nullable().default(null) });
export const cleanupCmsDeploymentsSchema = z.object({ fingerprint: z.string().length(64), deploymentIds: z.array(z.int().positive()).min(1).max(1000) });
export type CmsDeploymentRetentionRules = Omit<z.output<typeof saveCmsDeploymentRetentionSchema>, 'expectedVersion'>;
/** Sites without a saved policy use these rules, including the daily automatic cleanup. */
export const CMS_DEFAULT_DEPLOYMENT_RETENTION: CmsDeploymentRetentionRules = { retainCount: 10, retainDays: 30, failedRetainDays: 7, automatic: true };
export type CmsDeploymentRetentionFacts = {
  id: number; status: typeof CMS_DEPLOYMENT_STATUSES[number]; releaseStatus: typeof CMS_RELEASE_STATUSES[number]; pinned: boolean;
  storageState: typeof CMS_DEPLOYMENT_STORAGE_STATES[number]; ageFrom: string; protectedBy: string[];
  /** See isCmsPendingCandidate: false once the candidate can no longer be activated as-is. */
  pendingCandidate: boolean;
};
/** Only versions that have been online are rollback targets, so only they occupy the "recent N" slots. */
export const CMS_RETAINED_VERSION_STATUSES = ['active', 'retired'] as const satisfies readonly (typeof CMS_DEPLOYMENT_STATUSES[number])[];
/**
 * Activation requires the release to still target this deployment and its base to be the live generation;
 * a cancelled, re-targeted or stale-base candidate can never go online and is retained only by count/age rules.
 */
export function isCmsPendingCandidate(deploymentId: number, release: { status: typeof CMS_RELEASE_STATUSES[number]; deploymentId: number | null; baseGenerationId: number | null }, activeGenerationId: number | null): boolean {
  if (release.deploymentId !== deploymentId) return false;
  if (release.status === 'building') return true;
  return (release.status === 'ready' || release.status === 'scheduled') && release.baseGenerationId === activeGenerationId;
}
/** Keep recent count OR recent age; active, pending and referenced generations always win over retention rules. */
export function cmsDeploymentRetentionDecisions(rows: CmsDeploymentRetentionFacts[], policy: CmsDeploymentRetentionRules, now = new Date()): Map<number, string[]> {
  const versions: readonly string[] = CMS_RETAINED_VERSION_STATUSES;
  const recent = new Set(rows.filter(row => versions.includes(row.status) && row.storageState === 'available').sort((a, b) => Date.parse(b.ageFrom) - Date.parse(a.ageFrom) || b.id - a.id).slice(0, policy.retainCount).map(row => row.id));
  return new Map(rows.map(row => [row.id, cmsDeploymentRetentionReasons(row, policy, recent.has(row.id), now)]));
}
export function cmsDeploymentRetentionReasons(row: CmsDeploymentRetentionFacts, policy: CmsDeploymentRetentionRules, retainedByCount: boolean, now = new Date()): string[] {
    const reasons = [...row.protectedBy];
    if (row.storageState === 'purged') reasons.push('存储已回收');
    if (row.pinned) reasons.push('已设为重要版本');
    if (row.status === 'active') reasons.push('当前在线部署');
    else if (row.pendingCandidate) reasons.push(row.releaseStatus === 'building' ? '正在构建' : '待激活候选部署');
    if (row.storageState === 'available') {
      if (retainedByCount) reasons.push(`保留最近 ${policy.retainCount} 个上线版本`);
      const days = row.status === 'failed' ? policy.failedRetainDays : policy.retainDays;
      if (Date.parse(row.ageFrom) + days * 86400000 > now.getTime()) reasons.push(`仍在 ${days} 天保留期内`);
    }
    return [...new Set(reasons)];
}
/** Nested delivery/build payloads may refer to one or several generations; cleanup tasks are excluded by their caller. */
export function cmsTaskDeploymentReferences(payload: Record<string, unknown>): number[] {
  const ids = new Set<number>();
  const walk = (value: unknown, key = '') => {
    if (Array.isArray(value)) { value.forEach(item => walk(item, key)); return; }
    if (value && typeof value === 'object') { Object.entries(value).forEach(([childKey, child]) => walk(child, childKey)); return; }
    if (/(?:generation|deployment)ids?$/iu.test(key)) { const id = Number(value); if (Number.isSafeInteger(id) && id > 0) ids.add(id); }
  };
  walk(payload); return [...ids];
}
