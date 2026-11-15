import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import * as z from 'zod';
import { HTTPException } from 'hono/http-exception';
import {
  SETTINGS_MODULES,
  SETTINGS_MODULE_KEYS,
  SETTINGS_MODULE_PATHS,
  parseSettingsOverrides,
  stableSettingsSerialize,
  mergeSettingsLayers,
  getSettingsDefinition,
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
  type SettingsEnvelope,
  type SettingsWriteBody,
  type SettingsOf,
} from '@zenith/shared/settings';
import { config } from '../../config';
import { db } from '../../db';
import { systemSettings, systemSettingsRevisions, tenants } from '../../db/schema';
import type { DbExecutor } from '../../db/types';
import { requireRow } from '../db-assert';
import { getByPath } from '@zenith/shared/core';
import { currentUserOrNull, setAuditBefore, setAuditAfter } from '../context';
import { redactBody } from '../sanitize';
import { formatNullableDateTime } from '../datetime';
import { onInvalidate, onInvalidationReset } from '../invalidation-bus';
import { isFeatureEnabled } from '../licensing';
import logger from '../logger';
import { currentMemberOrNull } from '../member-context';
import { getUserPermissions, isSuperAdmin } from '../permissions';
import { exactTenantCondition, getEffectiveTenantId, getTenantScopeId, inheritedTenantCondition, isPlatformAdmin } from '../tenant';
import { getTenantPackageFeatureSet } from '../tenant-package';
import { TtlCache } from '../ttl-cache';
import { onBroadcastMessage, scheduleBroadcast } from '../ws-manager';
import type { JwtPayload } from '../../middleware/auth';
import { assertIpAccessChange } from './ip-access-guard';

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

export interface SettingsEntry<M extends SettingsModuleKey = SettingsModuleKey> {
  readonly degraded: boolean;
  readonly module: M;
  readonly tenantId: number | null;
  readonly effective: SettingsOf<M>;
  readonly inherited: SettingsOf<M>;
  readonly own: SettingsDoc;
  readonly currentRevisionId: number | null;
  readonly inheritedVersion: number;
  readonly definitionHash: string;
  readonly baseToken: string;
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
  // 废弃整个实例，旧的在途 loader 即使完成也只能写回已失效的实例。
  caches.delete(module);
}

/** 清空全部副本（监听重建 / 测试） */
export function resetSettingsCache(): void {
  caches.clear();
  tenantIdByCode.clear();
}

onInvalidate('system_settings', (message) => {
  const module = message.key;
  if (module && Object.hasOwn(SETTINGS_MODULES, module)) invalidateSettings(module as SettingsModuleKey);
  else resetSettingsCache();
});
onInvalidationReset(resetSettingsCache);
// Redis 推送可能早于 PG NOTIFY 抵达；在浏览器重拉前先清掉本进程的旧策略。
onBroadcastMessage((message) => {
  if (message.type === 'preferences:policy-updated') invalidateSettings('ui');
});

// ─── 加载与解析 ──────────────────────────────────────────────────────────────

type SettingsLayerRow = {
  id: number;
  tenantId: number | null;
  currentRevisionId: number | null;
  data: SettingsDoc | null;
  version: number | null;
  updatedAt: Date | null;
};

/** 配置定义随代码部署变化，参与生效指纹，避免旧表单覆盖新的默认值。 */
const definitions = new Map<SettingsModuleKey, { hash: string; snapshot: SettingsDoc }>();
export function settingsDefinition(module: SettingsModuleKey) {
  let definition = definitions.get(module);
  if (!definition) {
    const snapshot = getSettingsDefinition(module);
    definition = { hash: createHash('sha256').update(stableSettingsSerialize(snapshot)).digest('hex'), snapshot };
    definitions.set(module, definition);
  }
  return definition;
}

async function loadRows(module: SettingsModuleKey, tenantId: number | null, executor: DbExecutor = db): Promise<{ platform: SettingsLayerRow | null; tenant: SettingsLayerRow | null }> {
  const scope = inheritedTenantCondition(systemSettings.tenantId, tenantId);
  const rows = await executor.select({
    id: systemSettings.id, tenantId: systemSettings.tenantId, currentRevisionId: systemSettings.currentRevisionId,
    data: systemSettingsRevisions.overrides, version: systemSettingsRevisions.version, updatedAt: systemSettingsRevisions.createdAt,
  }).from(systemSettings)
    .leftJoin(systemSettingsRevisions, eq(systemSettings.currentRevisionId, systemSettingsRevisions.id))
    .where(and(eq(systemSettings.module, module), scope));
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

function buildEntry<M extends SettingsModuleKey>(module: M, tenantId: number | null, rows: { platform: SettingsLayerRow | null; tenant: SettingsLayerRow | null }): SettingsEntry<M> {
  const platformData = rows.platform?.data ?? {};
  const ownRow = tenantId === null ? rows.platform : rows.tenant;
  const own = ownRow?.data ?? {};
  const inherited = tenantId === null ? resolveSettings(module, []).value : resolveLogged(module, null, [platformData]);
  const definitionHash = settingsDefinition(module).hash;
  const currentRevisionId = ownRow?.currentRevisionId ?? null;
  const inheritedVersion = tenantId === null ? 0 : rows.platform?.version ?? 0;
  const baseToken = createHash('sha256').update(stableSettingsSerialize({
    module, tenantId, currentRevisionId, parent: tenantId === null ? null : rows.platform?.currentRevisionId ?? null, definitionHash,
  })).digest('hex');
  const layers = tenantId === null ? [own] : [platformData, own];
  const resolved = resolveSettings(module, layers);
  return {
    module, tenantId, own, currentRevisionId, inheritedVersion, definitionHash, baseToken,
    degraded: resolved.degraded,
    effective: resolved.degraded ? resolveLogged(module, tenantId, layers) : resolved.value,
    inherited, version: ownRow?.version ?? 0, updatedAt: ownRow?.updatedAt ?? null,
  };
}

/** 事务调用方必须传 executor，绕过副本并在同一连接读取。 */
export async function loadSettingsEntry<M extends SettingsModuleKey>(executor: DbExecutor, module: M, tenantId: number | null): Promise<SettingsEntry<M>> {
  return buildEntry(module, tenantId, await loadRows(module, tenantId, executor));
}

/** 保留策略等批量后台读者也只从设置运行时读取配置正文。 */
export async function getSettingsForAllScopes<M extends SettingsModuleKey>(module: M): Promise<Map<number | null, SettingsOf<M>>> {
  const rows = await db.select({ tenantId: systemSettings.tenantId, data: systemSettingsRevisions.overrides })
    .from(systemSettings).leftJoin(systemSettingsRevisions, eq(systemSettings.currentRevisionId, systemSettingsRevisions.id))
    .where(eq(systemSettings.module, module));
  const platform = rows.find((row) => row.tenantId === null)?.data ?? {};
  const result = new Map<number | null, SettingsOf<M>>([[null, resolveLogged(module, null, [platform])]]);
  for (const row of rows) if (row.tenantId !== null) result.set(row.tenantId, resolveLogged(module, row.tenantId, [platform, row.data ?? {}]));
  return result;
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
export function settingsWriteScope(module: SettingsModuleKey, user: JwtPayload): number | null {
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
  if (module === 'ipAccess' && entry.degraded) throw new HTTPException(503, { message: 'IP 访问策略无效，请通过受控运维流程恢复' });
  return entry.effective;
}

/** Policy and version originate from one immutable cached entry. */
export async function getIpAccessPolicySnapshot() {
  const entry = await loadEntry('ipAccess', null);
  if (entry.degraded) throw new HTTPException(503, { message: 'IP 访问策略无效，请通过受控运维流程恢复' });
  return { policy: entry.effective, version: entry.version };
}

export function toSettingsEnvelope<M extends SettingsModuleKey>(entry: SettingsEntry<M>): SettingsEnvelope<M> {
  return {
    module: entry.module,
    scope: SETTINGS_MODULES[entry.module].scope,
    tenantId: entry.tenantId,
    version: entry.version,
    currentRevisionId: entry.currentRevisionId,
    baseToken: entry.baseToken,
    inheritedVersion: entry.inheritedVersion,
    definitionHash: entry.definitionHash,
    overrides: entry.own,
    effective: entry.effective,
    inherited: entry.inherited,
    overriddenPaths: settingsOverriddenPaths(entry.own),
    updatedAt: formatNullableDateTime(entry.updatedAt),
  };
}

/** 管理界面读取：生效值 + 上级值 + 覆盖路径 + 版本（写入时回传） */
export async function getSettingsEnvelope<M extends SettingsModuleKey>(module: M): Promise<SettingsEnvelope<M>> {
  const user = currentUserOrNull();
  const tenantId = user ? settingsReadScope(module, user) : readTenantId(module);
  return toSettingsEnvelope(await loadEntry(module, tenantId));
}

/** 管理界面读的是「我保存时会写到哪一行」；租户管理员越权读平台级模块时按读取语义降级（页面只读） */
export function settingsReadScope(module: SettingsModuleKey, user: JwtPayload): number | null {
  if (SETTINGS_MODULES[module].platformOnly && config.multiTenantMode && !isPlatformAdmin(user)) throw new HTTPException(403, { message: '该设置仅平台管理员可访问' });
  try {
    return settingsWriteScope(module, user);
  } catch {
    return readTenantId(module);
  }
}

// ─── 写入 ────────────────────────────────────────────────────────────────────

export type SaveSettingsInput<M extends SettingsModuleKey> = SettingsWriteBody<M>;

/** 同模块写入极低频，串行化平台 / 租户两层与首次创建，保证继承快照和指纹一致。 */
export async function lockSettingsModule(executor: DbExecutor, module: SettingsModuleKey): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'settings:' + module}, 0))`);
}

export function assertSettingsBase(entry: SettingsEntry, token: string): void {
  if (entry.baseToken !== token) throw new HTTPException(409, { message: '设置或继承来源已发生变化，请查看最新配置后重试；未保存的修改已保留' });
}

/** 在统一事务里写入显式覆盖；恢复直接使用历史覆盖，不对上级做 diff。 */
async function writeSettings<M extends SettingsModuleKey>(module: M, user: JwtPayload, input: SaveSettingsInput<M>, restoreVersion?: number): Promise<SettingsEnvelope<M>> {
  const tenantId = settingsWriteScope(module, user);
  const result = await db.transaction(async (tx) => {
    await lockSettingsModule(tx, module);
    const before = await loadSettingsEntry(tx, module, tenantId);
    assertSettingsBase(before, input.baseToken);
    setAuditBefore(redactBody(toSettingsEnvelope(before)));
    const [head] = await tx.select({ id: systemSettings.id }).from(systemSettings)
      .where(and(eq(systemSettings.module, module), exactTenantCondition(systemSettings.tenantId, tenantId)));
    let candidate = input.overrides;
    if (restoreVersion === 0) candidate = {};
    else if (restoreVersion !== undefined) {
      const source = head ? await tx.select({ overrides: systemSettingsRevisions.overrides }).from(systemSettingsRevisions)
        .where(and(eq(systemSettingsRevisions.settingsId, head.id), eq(systemSettingsRevisions.version, restoreVersion))).limit(1) : [];
      candidate = requireRow(source[0], '设置版本不存在').overrides;
    }
    let own: SettingsDoc;
    let effective: SettingsOf<M>;
    try {
      own = parseSettingsOverrides(module, candidate);
      effective = SETTINGS_MODULES[module].schema.parse(mergeSettingsLayers(before.inherited as SettingsDoc, own)) as SettingsOf<M>;
    } catch (error) {
      if (error instanceof z.ZodError) {
        const issue = error.issues[0];
        throw new HTTPException(400, { message: `${issue.path.join('.') || '设置'}：${issue.message}` });
      }
      throw error;
    }
    if (module === 'ipAccess') assertIpAccessChange(effective as SettingsOf<'ipAccess'>);
    if (stableSettingsSerialize(own) === stableSettingsSerialize(before.own)) return { saved: toSettingsEnvelope(before), changed: false };
    const settingsId = head?.id ?? requireRow((await tx.insert(systemSettings).values({ module, tenantId }).returning({ id: systemSettings.id }))[0], '创建设置失败').id;
    const definition = settingsDefinition(module);
    const paths = [...new Set([...settingsOverriddenPaths(before.own), ...settingsOverriddenPaths(own)])].filter((path) => {
      return stableSettingsSerialize(getByPath(before.own, path)) !== stableSettingsSerialize(getByPath(own, path));
    });
    const revision = requireRow((await tx.insert(systemSettingsRevisions).values({
      settingsId, version: before.version + 1, action: restoreVersion === undefined ? 'save' : 'restore',
      restoredFromVersion: restoreVersion ?? null, overrides: own, inherited: before.inherited as SettingsDoc,
      effective: effective as SettingsDoc, inheritedVersion: before.inheritedVersion,
      definitionHash: definition.hash, definition: definition.snapshot, changedPaths: paths,
      note: input.note ?? '', actorId: user.userId, actorName: user.username,
    }).returning({ id: systemSettingsRevisions.id }))[0], '创建设置版本失败');
    await tx.update(systemSettings).set({ currentRevisionId: revision.id }).where(eq(systemSettings.id, settingsId));
    // 在持锁事务中取得这次提交的精确信封，不能提交后再读到另一位操作者的新版本。
    return { saved: toSettingsEnvelope(await loadSettingsEntry(tx, module, tenantId)), changed: true };
  });
  if (result.changed) {
    invalidateSettings(module);
    if (module === 'ui') scheduleBroadcast({ type: 'preferences:policy-updated', payload: { version: result.saved.version } });
  }
  setAuditAfter(redactBody(result.saved));
  return result.saved;
}

export async function saveSettings<M extends SettingsModuleKey>(module: M, user: JwtPayload, input: SaveSettingsInput<M>): Promise<SettingsEnvelope<M>> {
  return writeSettings(module, user, input);
}

export async function restoreSettings<M extends SettingsModuleKey>(module: M, user: JwtPayload, version: number, input: { baseToken: string; note: string }): Promise<SettingsEnvelope<M>> {
  return writeSettings(module, user, { ...input, overrides: {} }, version);
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
  if (def.platformOnly && config.multiTenantMode && !isPlatformAdmin(user)) return false;
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
    const entry = await loadEntry(module, settingsReadScope(module, user));
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
    settingsWriteScope(module, user);
    return true;
  } catch {
    return false;
  }
}
