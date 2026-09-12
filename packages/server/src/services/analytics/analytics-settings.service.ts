import { eq, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { analyticsSettings } from '../../db/schema';
import type { AnalyticsSettingsRow } from '../../db/schema';
import type { UpdateAnalyticsSettingsInput, AnalyticsPublicConfig } from '@zenith/shared/analytics';
import { currentCreateTenantId, getCreateTenantId, exactTenantCondition } from '../../lib/tenant';
import { formatTimestamps } from '../../lib/datetime';
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
    errorIgnorePatterns: row.errorIgnorePatterns ?? [],
    retentionDays: row.retentionDays,
    errorRetentionDays: row.errorRetentionDays,
    sessionTimeoutMinutes: row.sessionTimeoutMinutes,
    trackReplay: row.trackReplay,
    replaySessionSampleRate: row.replaySessionSampleRate,
    replayOnError: row.replayOnError,
    replayMaskAllText: row.replayMaskAllText,
    replayBlockSelector: row.replayBlockSelector,
    replayRetentionDays: row.replayRetentionDays,
    replayStorageQuotaMb: row.replayStorageQuotaMb,
    ...formatTimestamps(row),
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
      ...(input.errorIgnorePatterns !== undefined ? { errorIgnorePatterns: input.errorIgnorePatterns } : {}),
      ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
      ...(input.errorRetentionDays !== undefined ? { errorRetentionDays: input.errorRetentionDays } : {}),
      ...(input.sessionTimeoutMinutes !== undefined ? { sessionTimeoutMinutes: input.sessionTimeoutMinutes } : {}),
      ...(input.trackReplay !== undefined ? { trackReplay: input.trackReplay } : {}),
      ...(input.replaySessionSampleRate !== undefined ? { replaySessionSampleRate: input.replaySessionSampleRate } : {}),
      ...(input.replayOnError !== undefined ? { replayOnError: input.replayOnError } : {}),
      ...(input.replayMaskAllText !== undefined ? { replayMaskAllText: input.replayMaskAllText } : {}),
      ...(input.replayBlockSelector !== undefined ? { replayBlockSelector: input.replayBlockSelector } : {}),
      ...(input.replayRetentionDays !== undefined ? { replayRetentionDays: input.replayRetentionDays } : {}),
      ...(input.replayStorageQuotaMb !== undefined ? { replayStorageQuotaMb: input.replayStorageQuotaMb } : {}),
    })
    .where(eq(analyticsSettings.id, current.id))
    .returning();
  ignorePatternCache.clear();
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
  trackReplay: false,
  replaySessionSampleRate: 0,
  replayOnError: true,
  replayMaskAllText: false,
  replayBlockSelector: '',
};

function settingsTenantWhere(tenantId: number | null) {
  return exactTenantCondition(analyticsSettings.tenantId, tenantId);
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

// ─── 错误忽略规则（正则缓存，60s TTL；updateSettings 广播即时失效由 SDK 侧配置热更新覆盖）───
const IGNORE_CACHE_TTL_MS = 60_000;
const ignorePatternCache = new Map<number, { at: number; regexps: RegExp[] }>();

function compileIgnorePatterns(patterns: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const p of patterns) {
    try { out.push(new RegExp(p, 'i')); } catch { /* 非法正则跳过，不拖垮整组规则 */ }
  }
  return out;
}

/** 判断错误 message 是否命中租户配置的忽略规则（命中即丢弃上报）。 */
export async function isErrorIgnored(tenantId: number | null, message: string): Promise<boolean> {
  const cacheKey = tenantId ?? 0;
  const cached = ignorePatternCache.get(cacheKey);
  let regexps: RegExp[];
  if (cached && Date.now() - cached.at < IGNORE_CACHE_TTL_MS) {
    regexps = cached.regexps;
  } else {
    const row = await findSettingsWithGlobalFallback(tenantId);
    regexps = compileIgnorePatterns(row?.errorIgnorePatterns ?? []);
    ignorePatternCache.set(cacheKey, { at: Date.now(), regexps });
  }
  return regexps.some((re) => re.test(message));
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
    trackReplay: r.trackReplay,
    replaySessionSampleRate: r.replaySessionSampleRate,
    replayOnError: r.replayOnError,
    replayMaskAllText: r.replayMaskAllText,
    replayBlockSelector: r.replayBlockSelector,
    ...(site ? { siteId: site.id, appId: site.appId } : {}),
  };
}
