import { eq, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { analyticsSettings } from '../../db/schema';
import type { AnalyticsSettingsRow } from '../../db/schema';
import type { UpdateAnalyticsSettingsInput, AnalyticsPublicConfig } from '@zenith/shared';
import { tenantScope, currentCreateTenantId } from '../../lib/tenant';
import { formatDateTime } from '../../lib/datetime';

export function mapSettings(row: AnalyticsSettingsRow) {
  return {
    id: row.id,
    enabled: row.enabled,
    sampleRate: row.sampleRate,
    trackPageviews: row.trackPageviews,
    trackClicks: row.trackClicks,
    trackPerformance: row.trackPerformance,
    trackErrors: row.trackErrors,
    trackApi: row.trackApi,
    maskInputs: row.maskInputs,
    respectDnt: row.respectDnt,
    anonymizeIp: row.anonymizeIp,
    blacklistPaths: row.blacklistPaths ?? [],
    retentionDays: row.retentionDays,
    errorRetentionDays: row.errorRetentionDays,
    sessionTimeoutMinutes: row.sessionTimeoutMinutes,
    createdAt: formatDateTime(row.createdAt),
    updatedAt: formatDateTime(row.updatedAt),
  };
}

/** 获取（不存在则创建）当前租户的采集设置。 */
export async function getSettings() {
  const [row] = await db.select().from(analyticsSettings).where(tenantScope(analyticsSettings)).orderBy(analyticsSettings.id).limit(1);
  if (row) return mapSettings(row);
  const [created] = await db.insert(analyticsSettings).values({ tenantId: currentCreateTenantId() }).returning();
  return mapSettings(created);
}

export async function updateSettings(input: UpdateAnalyticsSettingsInput) {
  const current = await getSettings();
  const [row] = await db
    .update(analyticsSettings)
    .set({
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.sampleRate !== undefined ? { sampleRate: input.sampleRate } : {}),
      ...(input.trackPageviews !== undefined ? { trackPageviews: input.trackPageviews } : {}),
      ...(input.trackClicks !== undefined ? { trackClicks: input.trackClicks } : {}),
      ...(input.trackPerformance !== undefined ? { trackPerformance: input.trackPerformance } : {}),
      ...(input.trackErrors !== undefined ? { trackErrors: input.trackErrors } : {}),
      ...(input.trackApi !== undefined ? { trackApi: input.trackApi } : {}),
      ...(input.maskInputs !== undefined ? { maskInputs: input.maskInputs } : {}),
      ...(input.respectDnt !== undefined ? { respectDnt: input.respectDnt } : {}),
      ...(input.anonymizeIp !== undefined ? { anonymizeIp: input.anonymizeIp } : {}),
      ...(input.blacklistPaths !== undefined ? { blacklistPaths: input.blacklistPaths } : {}),
      ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
      ...(input.errorRetentionDays !== undefined ? { errorRetentionDays: input.errorRetentionDays } : {}),
      ...(input.sessionTimeoutMinutes !== undefined ? { sessionTimeoutMinutes: input.sessionTimeoutMinutes } : {}),
    })
    .where(eq(analyticsSettings.id, current.id))
    .returning();
  return mapSettings(row);
}

const DEFAULT_PUBLIC_CONFIG: AnalyticsPublicConfig = {
  enabled: true,
  sampleRate: 1,
  trackPageviews: true,
  trackClicks: true,
  trackPerformance: true,
  trackErrors: true,
  trackApi: true,
  maskInputs: true,
  respectDnt: false,
  blacklistPaths: [],
};

/** 服务端采集行为配置（匿名化等，不下发 SDK）。 */
export async function getIngestPolicy(): Promise<{ anonymizeIp: boolean }> {
  const [row] = await db.select({ anonymizeIp: analyticsSettings.anonymizeIp }).from(analyticsSettings).orderBy(analyticsSettings.id).limit(1);
  return { anonymizeIp: row?.anonymizeIp ?? false };
}

/** SDK 公开配置（无需鉴权，匿名亦可获取）。 */
export async function getPublicConfig(): Promise<AnalyticsPublicConfig> {
  const [row] =
    (await db.select().from(analyticsSettings).where(isNull(analyticsSettings.tenantId)).limit(1)) ||
    [];
  const r = row ?? (await db.select().from(analyticsSettings).orderBy(analyticsSettings.id).limit(1))[0];
  if (!r) return DEFAULT_PUBLIC_CONFIG;
  return {
    enabled: r.enabled,
    sampleRate: r.sampleRate,
    trackPageviews: r.trackPageviews,
    trackClicks: r.trackClicks,
    trackPerformance: r.trackPerformance,
    trackErrors: r.trackErrors,
    trackApi: r.trackApi,
    maskInputs: r.maskInputs,
    respectDnt: r.respectDnt,
    blacklistPaths: r.blacklistPaths ?? [],
  };
}
