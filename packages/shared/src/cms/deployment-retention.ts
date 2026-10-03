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
};
/** Keep recent count OR recent age; incomplete, active and referenced generations always win over retention rules. */
export function cmsDeploymentRetentionDecisions(rows: CmsDeploymentRetentionFacts[], policy: CmsDeploymentRetentionRules, now = new Date()): Map<number, string[]> {
  const recent = new Set(rows.filter(row => row.status !== 'failed' && row.storageState === 'available').sort((a, b) => Date.parse(b.ageFrom) - Date.parse(a.ageFrom) || b.id - a.id).slice(0, policy.retainCount).map(row => row.id));
  return new Map(rows.map(row => [row.id, cmsDeploymentRetentionReasons(row, policy, recent.has(row.id), now)]));
}
export function cmsDeploymentRetentionReasons(row: CmsDeploymentRetentionFacts, policy: CmsDeploymentRetentionRules, retainedByCount: boolean, now = new Date()): string[] {
    const reasons = [...row.protectedBy];
    if (row.storageState === 'purged') reasons.push('存储已回收');
    if (row.pinned) reasons.push('已设为重要版本');
    if (['active', 'ready', 'building'].includes(row.status)) reasons.push(row.status === 'active' ? '当前在线部署' : row.status === 'ready' ? '待激活候选部署' : '正在构建');
    if (['building', 'ready', 'scheduled'].includes(row.releaseStatus)) reasons.push('发布单仍在构建或等待激活');
    if (row.storageState === 'available') {
      if (row.status !== 'failed' && retainedByCount) reasons.push(`保留最近 ${policy.retainCount} 个版本`);
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
