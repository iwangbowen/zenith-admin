import { and, eq, isNull, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import {
  SETTINGS_MODULES,
  SETTINGS_MODULE_KEYS,
  SETTINGS_MODULE_PATHS,
  diffSettings,
  mySettingsSchema,
  pickSettingsFields,
  publicSettingsSchema,
  resolveSettings,
  settingsOverriddenPaths,
  type MySettings,
  type PublicSettings,
  type SettingsDoc,
  type SettingsModuleDef,
  type SettingsModuleKey,
  type SettingsModuleMeta,
  type SettingsOf,
} from '@zenith/shared/settings';
import { config } from '../../config';
import { db } from '../../db';
import { systemSettings, tenants } from '../../db/schema';
import { currentUserOrNull } from '../context';
import { formatNullableDateTime } from '../datetime';
import { onInvalidate, onInvalidationReset } from '../invalidation-bus';
import { isFeatureEnabled } from '../licensing';
import logger from '../logger';
import { currentMemberOrNull } from '../member-context';
import { getUserPermissions, isSuperAdmin } from '../permissions';
import { getEffectiveTenantId, getTenantScopeId, isPlatformAdmin } from '../tenant';
import { getTenantPackageFeatureSet } from '../tenant-package';
import { TtlCache } from '../ttl-cache';
import type { JwtPayload } from '../../middleware/auth';

/**
 * 运行时设置读取 / 写入的唯一入口。
 *
 * 读取：`getSettings(module)` 返回解析后的完整文档（默认 ← 平台 ← 租户），命中进程内副本时零查询。
 * 副本按模块分桶，由 `cache_invalidate` 通知（`system_settings` 触发器）失效，TTL 只是兜底。
 *
 * 作用域：
 * - `platform` 模块永远读平台行；
 * - `tenant` 模块按显式 `tenantId` → 当前管理员的有效租户（平台管理员切换视角优先）→ 当前会员租户 → 平台。
 * - 后台任务没有请求上下文，读 `tenant` 模块必须显式传 `tenantId`（注册表自检要求被任务读取的模块为 platform）。
 *
 * ⚠ 持有 `db.transaction` 的代码路径不得调用本模块（冷加载会向全局连接池借连接，池满即死锁）：
 * 在事务外读取后以参数传入。
 */

export type SettingsTenantOptions = {
  /** 显式租户；`null` = 平台。缺省时从请求上下文推导 */
  readonly tenantId?: number | null;
};

interface SettingsEntry<M extends SettingsModuleKey = SettingsModuleKey> {
  readonly module: M;
  readonly tenantId: number | null;
  readonly effective: SettingsOf<M>;
  readonly inherited: SettingsOf<M>;
  readonly own: SettingsDoc;
  readonly version: number;
  readonly updatedAt: Date | null;
}

// ─── 进程内副本 ──────────────────────────────────────────────────────────────

const caches = new Map<SettingsModuleKey, TtlCache<string, SettingsEntry>>();

function cacheOf(module: SettingsModuleKey): TtlCache<string, SettingsEntry> {
  let cache = caches.get(module);
  if (!cache) {
    cache = new TtlCache<string, SettingsEntry>(config.settings.cacheTtlMs);
    caches.set(module, cache);
  }
  return cache;
}

const scopeKey = (tenantId: number | null) => (tenantId === null ? 'platform' : String(tenantId));

/** 清空某模块所有作用域的副本（平台行改动会影响所有继承它的租户，故按模块整段清） */
export function invalidateSettings(module: SettingsModuleKey): void {
  caches.get(module)?.clear();
}

/** 清空全部副本（监听重建 / 测试） */
export function resetSettingsCache(): void {
  for (const cache of caches.values()) cache.clear();
  tenantIdByCode.clear();
}

onInvalidate('system_settings', (message) => {
  const module = message.key;
  if (module && Object.hasOwn(SETTINGS_MODULES, module)) invalidateSettings(module as SettingsModuleKey);
  else resetSettingsCache();
});
onInvalidationReset(resetSettingsCache);

// ─── 加载与解析 ──────────────────────────────────────────────────────────────

type SettingsRow = typeof systemSettings.$inferSelect;

async function loadRows(module: SettingsModuleKey, tenantId: number | null): Promise<{ platform: SettingsRow | null; tenant: SettingsRow | null }> {
  const scope = tenantId === null
    ? isNull(systemSettings.tenantId)
    : or(isNull(systemSettings.tenantId), eq(systemSettings.tenantId, tenantId));
  const rows = await db.select().from(systemSettings).where(and(eq(systemSettings.module, module), scope));
  return {
    platform: rows.find((row) => row.tenantId === null) ?? null,
    tenant: tenantId === null ? null : rows.find((row) => row.tenantId === tenantId) ?? null,
  };
}

function resolveLogged<M extends SettingsModuleKey>(module: M, tenantId: number | null, layers: SettingsDoc[]): SettingsOf<M> {
  const resolved = resolveSettings(module, layers);
  if (resolved.degraded) {
    logger.error('[settings] stored document no longer matches schema, degraded to defaults for invalid fields', {
      module, tenantId, droppedPaths: resolved.droppedPaths,
    });
  }
  return resolved.value;
}

function buildEntry<M extends SettingsModuleKey>(module: M, tenantId: number | null, rows: { platform: SettingsRow | null; tenant: SettingsRow | null }): SettingsEntry<M> {
  const platformData = rows.platform?.data ?? {};
  const platformEffective = resolveLogged(module, null, [platformData]);
  if (tenantId === null) {
    return {
      module,
      tenantId,
      effective: platformEffective,
      inherited: resolveSettings(module, []).value,
      own: platformData,
      version: rows.platform?.version ?? 0,
      updatedAt: rows.platform?.updatedAt ?? null,
    };
  }
  const tenantData = rows.tenant?.data ?? {};
  return {
    module,
    tenantId,
    effective: resolveLogged(module, tenantId, [platformData, tenantData]),
    inherited: platformEffective,
    own: tenantData,
    version: rows.tenant?.version ?? 0,
    updatedAt: rows.tenant?.updatedAt ?? null,
  };
}

async function loadEntry<M extends SettingsModuleKey>(module: M, tenantId: number | null): Promise<SettingsEntry<M>> {
  return cacheOf(module).get(scopeKey(tenantId), async () => buildEntry(module, tenantId, await loadRows(module, tenantId))) as Promise<SettingsEntry<M>>;
}

// ─── 作用域解析 ──────────────────────────────────────────────────────────────

function readTenantId(module: SettingsModuleKey, options?: SettingsTenantOptions): number | null {
  if (SETTINGS_MODULES[module].scope === 'platform' || !config.multiTenantMode) return null;
  if (options?.tenantId !== undefined) return options.tenantId;
  const user = currentUserOrNull();
  if (user) return getEffectiveTenantId(user);
  const member = currentMemberOrNull();
  if (member) return member.tenantId ?? null;
  return null;
}

/**
 * 写入作用域：平台级模块在多租户下只有平台管理员可写；租户级模块——平台管理员在全平台视角写平台行、
 * 切换租户视角写该租户行，租户管理员只能写自身租户（越权到平台级 / 他租户在此处直接 403）。
 */
function writeTenantId(module: SettingsModuleKey, user: JwtPayload): number | null {
  if (!config.multiTenantMode) return null;
  if (SETTINGS_MODULES[module].scope === 'platform') {
    if (!isPlatformAdmin(user)) throw new HTTPException(403, { message: '平台级设置仅平台管理员可修改' });
    return null;
  }
  if (isPlatformAdmin(user)) return getTenantScopeId(user) ?? null;
  return user.tenantId ?? null;
}

// ─── 读取 ────────────────────────────────────────────────────────────────────

/** 模块生效文档（命中副本零查询）。 */
export async function getSettings<M extends SettingsModuleKey>(module: M, options?: SettingsTenantOptions): Promise<SettingsOf<M>> {
  const entry = await loadEntry(module, readTenantId(module, options));
  return entry.effective;
}

export interface SettingsEnvelope<M extends SettingsModuleKey> {
  module: M;
  scope: SettingsModuleDef['scope'];
  tenantId: number | null;
  version: number;
  effective: SettingsOf<M>;
  inherited: SettingsOf<M>;
  overriddenPaths: string[];
  updatedAt: string | null;
}

function toEnvelope<M extends SettingsModuleKey>(entry: SettingsEntry<M>): SettingsEnvelope<M> {
  return {
    module: entry.module,
    scope: SETTINGS_MODULES[entry.module].scope,
    tenantId: entry.tenantId,
    version: entry.version,
    effective: entry.effective,
    inherited: entry.inherited,
    overriddenPaths: settingsOverriddenPaths(entry.own),
    updatedAt: formatNullableDateTime(entry.updatedAt),
  };
}

/** 管理界面读取：生效值 + 上级值 + 覆盖路径 + 版本（写入时回传） */
export async function getSettingsEnvelope<M extends SettingsModuleKey>(module: M): Promise<SettingsEnvelope<M>> {
  const user = currentUserOrNull();
  const tenantId = user ? writeScopeOrRead(module, user) : readTenantId(module);
  return toEnvelope(await loadEntry(module, tenantId));
}

/** 管理界面读的是「我保存时会写到哪一行」；租户管理员越权读平台级模块时按读取语义降级（页面只读） */
function writeScopeOrRead(module: SettingsModuleKey, user: JwtPayload): number | null {
  try {
    return writeTenantId(module, user);
  } catch {
    return readTenantId(module);
  }
}

// ─── 写入 ────────────────────────────────────────────────────────────────────

export interface SaveSettingsInput<M extends SettingsModuleKey> {
  readonly version: number;
  readonly data: SettingsOf<M>;
}

/**
 * 整体替换保存：`data` 是完整生效文档（契约已按写入 schema 校验），落库前对上级生效值做叶级 diff，
 * 只存差异（等值即继承）。`version` 与当前行不一致 → 409；无行时 `version` 必须为 0。
 */
export async function saveSettings<M extends SettingsModuleKey>(module: M, user: JwtPayload, input: SaveSettingsInput<M>): Promise<SettingsEnvelope<M>> {
  const def = SETTINGS_MODULES[module];
  const tenantId = writeTenantId(module, user);
  const normalized = def.schema.parse(input.data) as SettingsOf<M>;

  await db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: systemSettings.id, version: systemSettings.version })
      .from(systemSettings)
      .where(and(eq(systemSettings.module, module), tenantId === null ? isNull(systemSettings.tenantId) : eq(systemSettings.tenantId, tenantId)))
      .for('update');
    const currentVersion = existing?.version ?? 0;
    if (currentVersion !== input.version) {
      throw new HTTPException(409, { message: '设置已被他人修改，请刷新后重试' });
    }

    let inherited: SettingsDoc;
    if (tenantId === null) {
      inherited = resolveSettings(module, []).value as SettingsDoc;
    } else {
      const [platformRow] = await tx.select({ data: systemSettings.data }).from(systemSettings)
        .where(and(eq(systemSettings.module, module), isNull(systemSettings.tenantId)));
      inherited = resolveSettings(module, [platformRow?.data ?? {}]).value as SettingsDoc;
    }
    const own = diffSettings(normalized as SettingsDoc, inherited);

    if (existing) {
      await tx.update(systemSettings)
        .set({ data: own, version: currentVersion + 1 })
        .where(eq(systemSettings.id, existing.id));
    } else {
      await tx.insert(systemSettings).values({ module, tenantId, data: own, version: 1 });
    }
  });

  // 触发器会广播失效；本实例同步清一次，保证保存后立即回显新值
  invalidateSettings(module);
  return toEnvelope(await loadEntry(module, tenantId));
}

// ─── 投影：匿名 / 登录用户 ─────────────────────────────────────────────────────

const tenantIdByCode = new TtlCache<string, number | null>(60_000);

async function tenantIdFromCode(tenantCode: string | undefined): Promise<number | null> {
  if (!config.multiTenantMode || !tenantCode) return null;
  return tenantIdByCode.get(tenantCode, async () => {
    const [row] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.code, tenantCode)).limit(1);
    return row?.id ?? null;
  });
}

/** 匿名投影：登录 / 注册页需要的开关与密码规则；`tenantCode` 无效时返回平台值（不泄露租户是否存在） */
export async function getPublicSettings(tenantCode?: string): Promise<PublicSettings> {
  const tenantId = await tenantIdFromCode(tenantCode);
  const result: Record<string, unknown> = {};
  for (const module of Object.keys(publicSettingsSchema.shape) as SettingsModuleKey[]) {
    result[module] = pickSettingsFields(module, await getSettings(module, { tenantId }), ['public']);
  }
  return result as PublicSettings;
}

async function moduleAvailable(def: SettingsModuleDef, tenantId: number | null): Promise<boolean> {
  if (!def.feature) return true;
  if (!(await isFeatureEnabled(def.feature))) return false;
  const featureSet = await getTenantPackageFeatureSet(tenantId);
  return featureSet === null || featureSet.has(def.feature);
}

/** 登录用户投影：布局开关、密码规则、终端录屏等；带 License 门控的模块按部署授权与租户套餐过滤 */
export async function getMySettings(): Promise<MySettings> {
  const user = currentUserOrNull();
  const tenantId = user ? getEffectiveTenantId(user) : (currentMemberOrNull()?.tenantId ?? null);
  const result: Record<string, unknown> = {};
  for (const module of Object.keys(mySettingsSchema.shape) as SettingsModuleKey[]) {
    const def: SettingsModuleDef = SETTINGS_MODULES[module];
    if (!(await moduleAvailable(def, tenantId))) continue;
    result[module] = pickSettingsFields(module, await getSettings(module), ['public', 'authenticated']);
  }
  return result as MySettings;
}

// ─── 模块清单 ────────────────────────────────────────────────────────────────

async function canRead(def: SettingsModuleDef, user: JwtPayload, permissions: string[] | null): Promise<boolean> {
  if (def.readPermission === null || isSuperAdmin(user)) return true;
  return (permissions ?? []).includes(def.readPermission);
}

/** 当前用户可读的模块清单（含版本与覆盖数，供通用设置页导航） */
export async function listSettingsModules(user: JwtPayload): Promise<SettingsModuleMeta[]> {
  const permissions = isSuperAdmin(user) ? null : await getUserPermissions(user.userId);
  const tenantId = getEffectiveTenantId(user);
  const result: SettingsModuleMeta[] = [];
  for (const module of SETTINGS_MODULE_KEYS) {
    const def: SettingsModuleDef = SETTINGS_MODULES[module];
    if (!(await canRead(def, user, permissions))) continue;
    if (!(await moduleAvailable(def, tenantId))) continue;
    const entry = await loadEntry(module, writeScopeOrRead(module, user));
    const canWrite = isSuperAdmin(user) || (permissions ?? []).includes(def.writePermission);
    result.push({
      module,
      path: SETTINGS_MODULE_PATHS[module],
      title: def.title,
      description: def.description,
      scope: def.scope,
      feature: def.feature ?? null,
      page: def.page ?? null,
      canWrite: canWrite && canWriteScope(module, user),
      version: entry.version,
      overriddenCount: settingsOverriddenPaths(entry.own).length,
      updatedAt: formatNullableDateTime(entry.updatedAt),
    });
  }
  return result.sort((a, b) => SETTINGS_MODULES[a.module].sort - SETTINGS_MODULES[b.module].sort);
}

function canWriteScope(module: SettingsModuleKey, user: JwtPayload): boolean {
  try {
    writeTenantId(module, user);
    return true;
  } catch {
    return false;
  }
}
