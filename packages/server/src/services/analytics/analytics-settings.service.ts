import { eq, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { analyticsSettings } from '../../db/schema';
import type { AnalyticsSettingsRow } from '../../db/schema';
import type { UpdateAnalyticsSettingsInput, AnalyticsPublicConfig } from '@zenith/shared';
import { currentCreateTenantId, getCreateTenantId } from '../../lib/tenant';
import { formatDateTime } from '../../lib/datetime';
import { currentUserOrNull } from '../../lib/context';
import { currentMemberOrNull } from '../../lib/member-context';
import { broadcast } from '../../lib/ws-manager';
import { resolveSiteByKey } from './analytics-sites.service';

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
  const tenantId = currentCreateTenantId();
  const [row] = await db.select().from(analyticsSettings).where(settingsTenantWhere(tenantId)).limit(1);
  if (row) return mapSettings(row);
  const [created] = await db.insert(analyticsSettings).values({ tenantId }).onConflictDoNothing().returning();
  if (created) return mapSettings(created);
  const [concurrent] = await db.select().from(analyticsSettings).where(settingsTenantWhere(tenantId)).limit(1);
  return mapSettings(concurrent);
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
  // 设置热更新：通知已连接的后台管理端（tracker.ts）立即重拉配置。不下发配置内容，仅广播 tenantId。
  try { broadcast({ type: 'analytics:config-updated', payload: { tenantId: row.tenantId } }); } catch { /* ignore */ }
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
  sessionTimeoutMinutes: 30,
};

function settingsTenantWhere(tenantId: number | null) {
  return tenantId === null ? isNull(analyticsSettings.tenantId) : eq(analyticsSettings.tenantId, tenantId);
}

async function findSettingsWithGlobalFallback(tenantId: number | null): Promise<AnalyticsSettingsRow | undefined> {
  const [tenantRow] = await db.select().from(analyticsSettings).where(settingsTenantWhere(tenantId)).limit(1);
  if (tenantRow || tenantId === null) return tenantRow;
  const [globalRow] = await db.select().from(analyticsSettings).where(isNull(analyticsSettings.tenantId)).limit(1);
  return globalRow;
}

/** 服务端采集行为配置（匿名化等，不下发 SDK）。 */
export async function getIngestPolicy(tenantId: number | null): Promise<{ anonymizeIp: boolean }> {
  const row = await findSettingsWithGlobalFallback(tenantId);
  return { anonymizeIp: row?.anonymizeIp ?? false };
}

/** SDK 公开配置（无需鉴权，匿名亦可获取）。 */
export async function getPublicConfig(siteKey?: string | null): Promise<AnalyticsPublicConfig> {
  const user = currentUserOrNull();
  const member = user ? undefined : currentMemberOrNull();
  const site = (!user && !member) ? await resolveSiteByKey(siteKey).catch(() => null) : null;
  const tenantId = user ? getCreateTenantId(user) : member ? (member.tenantId ?? null) : (site?.tenantId ?? null);
  const r = await findSettingsWithGlobalFallback(tenantId);
  if (!r) return site ? { ...DEFAULT_PUBLIC_CONFIG, siteId: site.id, appId: site.appId } : DEFAULT_PUBLIC_CONFIG;
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
    sessionTimeoutMinutes: r.sessionTimeoutMinutes,
    ...(site ? { siteId: site.id, appId: site.appId } : {}),
  };
}
