import type { SettingsVisibility } from './constants';
import { SETTINGS_MODULES, type SettingsModuleKey, type SettingsOf } from './registry';

/** 任意层级的设置文档（覆盖层是稀疏的，生效层是完整的） */
export type SettingsDoc = Record<string, unknown>;

function isPlainObject(value: unknown): value is SettingsDoc {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sameLeaf(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 两层覆盖合并：对象递归合并，其它类型（含数组）整体替换。
 * 覆盖层里的 `undefined` 视为未声明（继承）。
 */
export function mergeSettingsLayers(base: SettingsDoc, override: SettingsDoc): SettingsDoc {
  const result: SettingsDoc = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] = isPlainObject(current) && isPlainObject(value) ? mergeSettingsLayers(current, value) : value;
  }
  return result;
}

export interface ResolvedSettings<M extends SettingsModuleKey> {
  readonly value: SettingsOf<M>;
  /** 存量文档已无法完整通过 schema（字段改类型 / 约束收紧），返回值来自剔除违规字段或整体回退默认值 */
  readonly degraded: boolean;
  /** 被剔除的字段路径（供日志与指标） */
  readonly droppedPaths: readonly string[];
}

function deletePath(doc: SettingsDoc, path: readonly PropertyKey[]): void {
  if (path.length === 0) return;
  let cursor: unknown = doc;
  for (const segment of path.slice(0, -1)) {
    if (!isPlainObject(cursor)) return;
    cursor = cursor[String(segment)];
  }
  if (isPlainObject(cursor)) delete cursor[String(path[path.length - 1])];
}

/**
 * 解析模块生效文档：`schema 默认值 ← layers[0] ← layers[1] ← …`（平台层在前，租户层在后）。
 *
 * 读取路径绝不能因存量数据不合规而抛错（登录 / 上传 / 每个 `/api/*` 请求都依赖它），因此三级降级：
 * 1. 合并后整体解析成功 → 正常；
 * 2. 失败 → 按 issue 路径剔除违规字段（它们退回上级 / 默认值）后重试一次；
 * 3. 仍失败 → 返回纯默认文档。后两种情况 `degraded = true`，调用方应记 error 日志。
 */
export function resolveSettings<M extends SettingsModuleKey>(module: M, layers: readonly SettingsDoc[]): ResolvedSettings<M> {
  const schema = SETTINGS_MODULES[module].schema;
  const merged = layers.reduce<SettingsDoc>((acc, layer) => mergeSettingsLayers(acc, layer), {});
  const first = schema.safeParse(merged);
  if (first.success) return { value: first.data as SettingsOf<M>, degraded: false, droppedPaths: [] };

  const dropped = [...new Set(first.error.issues.map((issue) => issue.path.map(String).join('.')))].filter(Boolean);
  const pruned = structuredClone(merged);
  for (const issue of first.error.issues) deletePath(pruned, issue.path);
  const second = schema.safeParse(pruned);
  if (second.success) return { value: second.data as SettingsOf<M>, degraded: true, droppedPaths: dropped };

  return { value: schema.parse({}) as SettingsOf<M>, degraded: true, droppedPaths: dropped };
}

/**
 * 生效文档相对于上级生效文档的稀疏覆盖：叶级比较，相等的叶子不落库，空对象整体删除。
 * 「显式设成与上级相同的值 = 继承」是刻意语义（与通知偏好的稀疏存储一致）：上级之后变化时随之变化。
 */
export function diffSettings(effective: SettingsDoc, inherited: SettingsDoc): SettingsDoc {
  const result: SettingsDoc = {};
  for (const [key, value] of Object.entries(effective)) {
    const base = inherited[key];
    if (isPlainObject(value) && isPlainObject(base)) {
      const nested = diffSettings(value, base);
      if (Object.keys(nested).length > 0) result[key] = nested;
    } else if (!sameLeaf(value, base)) {
      result[key] = value;
    }
  }
  return result;
}

/** 覆盖文档中的叶子路径（`a.b`），供界面标记「已覆盖」 */
export function settingsOverriddenPaths(own: SettingsDoc, prefix = ''): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(own)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) paths.push(...settingsOverriddenPaths(value, path));
    else if (value !== undefined) paths.push(path);
  }
  return paths;
}

/** 按可见性投影模块的顶层字段（未声明可见性的字段视为 `admin`） */
export function pickSettingsFields<M extends SettingsModuleKey>(
  module: M,
  effective: SettingsOf<M>,
  levels: readonly SettingsVisibility[],
): Partial<SettingsOf<M>> {
  const visibility = (SETTINGS_MODULES[module].visibility ?? {}) as Partial<Record<string, SettingsVisibility>>;
  const result: SettingsDoc = {};
  for (const [key, value] of Object.entries(effective as SettingsDoc)) {
    if (levels.includes(visibility[key] ?? 'admin')) result[key] = value;
  }
  return result as Partial<SettingsOf<M>>;
}

/** 模块是否有任一顶层字段处于给定可见性级别 */
export function settingsModuleHasVisibility(module: SettingsModuleKey, levels: readonly SettingsVisibility[]): boolean {
  const visibility = SETTINGS_MODULES[module].visibility ?? {};
  return Object.values(visibility).some((level) => level !== undefined && levels.includes(level));
}
