import { preferenceDefinitionMap, preferenceDefinitions, preferencePaths } from './definitions';
import {
  defaultPreferences,
  preferenceOverridesSchema,
  preferenceValuesSchema,
  terminalPreferencesSchema,
  userPreferencesDocumentSchema,
  type PreferenceOverrides,
  type PreferencePolicy,
  type UserPreferences,
  type UserPreferencesDocument,
} from './validation';
import type { PersonalPreferencePath, PreferenceCondition, PreferenceDefinition, PreferencePath, PreferenceValueAtPath } from './types';

const knownPaths = new Set<string>([...preferencePaths, 'terminal.favorites']);
function checkPath(path: string): void {
  if (!knownPaths.has(path)) throw new Error(`未知偏好字段：${path}`);
}

export function getPreferenceValue<T extends object, P extends PersonalPreferencePath>(values: T, path: P): PreferenceValueAtPath<T, P> {
  checkPath(path);
  const source = values as Record<string, unknown>;
  return (path.startsWith('terminal.')
    ? (source.terminal as Record<string, unknown> | undefined)?.[path.slice(9)]
    : source[path]) as PreferenceValueAtPath<T, P>;
}

/** 不可变更新；terminal 只替换目标叶子，避免覆盖其他终端设置。 */
export function setPreferenceValue<T extends object>(values: T, path: PersonalPreferencePath, value: unknown): T {
  checkPath(path);
  if (path.startsWith('terminal.')) {
    const terminal = (values as Record<string, unknown>).terminal as Record<string, unknown> | undefined;
    return { ...values, terminal: { ...terminal, [path.slice(9)]: value } };
  }
  return { ...values, [path]: value };
}

export function removePreferenceOverride(overrides: PreferenceOverrides, path: PersonalPreferencePath): PreferenceOverrides {
  checkPath(path);
  const next = { ...overrides };
  if (path.startsWith('terminal.')) {
    const terminal = { ...next.terminal };
    delete terminal[path.slice(9) as keyof typeof terminal];
    if (Object.keys(terminal).length) next.terminal = terminal;
    else delete next.terminal;
  } else {
    delete next[path as Exclude<keyof PreferenceOverrides, 'terminal'>];
  }
  return next;
}

export function canOverridePreference(path: PreferencePath, policy: PreferencePolicy): boolean {
  return getPreferenceValue(policy.allowUserOverride, path);
}

/** 合并始终保留个人覆盖对象；管理员解除限制后，原来的个人选择自然恢复。 */
export function resolvePreferences(policy: PreferencePolicy, overrides: PreferenceOverrides): UserPreferences {
  let values: UserPreferences = {
    ...policy.defaults,
    terminal: { ...policy.defaults.terminal, favorites: structuredClone(overrides.terminal?.favorites ?? defaultPreferences.terminal.favorites) },
  };
  for (const path of preferencePaths) {
    const value = getPreferenceValue(overrides, path);
    if (value !== undefined && canOverridePreference(path, policy)) values = setPreferenceValue(values, path, value);
  }
  // 互斥与适用条件是两回事：强制开启者优先，否则显式个人选择优先于默认值。
  if (values.grayscale && values.colorBlind) {
    if (!policy.allowUserOverride.grayscale) values.colorBlind = false;
    else if (!policy.allowUserOverride.colorBlind || (overrides.colorBlind === true && overrides.grayscale !== true)) values.grayscale = false;
    else values.colorBlind = false;
  }
  if (values.reduceMotion) {
    values.tabAnimation = 'none';
    values.routeAnimation = 'none';
  }
  return values;
}

function conditionFields(condition: PreferenceCondition): PreferencePath[] {
  if ('all' in condition) return condition.all.flatMap(conditionFields);
  if ('any' in condition) return condition.any.flatMap(conditionFields);
  return [condition.field];
}

/** 用于测试与目录扩展校验；拒绝引用未知字段、自依赖及间接循环。 */
export function validatePreferenceDefinitions(definitions: readonly PreferenceDefinition[] = preferenceDefinitions): void {
  const map = new Map(definitions.map((definition) => [definition.path, definition]));
  if (map.size !== definitions.length) throw new Error('偏好字段目录中存在重复路径');
  const done = new Set<PreferencePath>();
  const active = new Set<PreferencePath>();
  const visit = (path: PreferencePath): void => {
    if (active.has(path)) throw new Error(`偏好依赖存在循环：${path}`);
    if (done.has(path)) return;
    const definition = map.get(path);
    if (!definition) throw new Error(`偏好依赖引用未知字段：${path}`);
    active.add(path);
    if (definition.applicableWhen) conditionFields(definition.applicableWhen).forEach(visit);
    active.delete(path);
    done.add(path);
  };
  definitions.forEach((definition) => visit(definition.path));
}

/** 只根据最终生效值及父项适用性判断，父项锁定不会让子项失去适用性。 */
export function isPreferenceApplicable(path: PreferencePath, values: UserPreferences): boolean {
  const memo = new Map<PreferencePath, boolean>();
  const applicable = (field: PreferencePath): boolean => {
    const cached = memo.get(field);
    if (cached !== undefined) return cached;
    const condition = preferenceDefinitionMap[field].applicableWhen;
    const result = !condition || evaluate(condition);
    memo.set(field, result);
    return result;
  };
  const evaluate = (condition: PreferenceCondition): boolean => {
    if ('all' in condition) return condition.all.every(evaluate);
    if ('any' in condition) return condition.any.some(evaluate);
    if (!applicable(condition.field)) return false;
    const value = getPreferenceValue(values, condition.field);
    return 'equals' in condition ? value === condition.equals : condition.in.includes(value);
  };
  checkPath(path);
  return applicable(path);
}

export function describePreferenceCondition(condition: PreferenceCondition): string {
  if ('all' in condition) return condition.all.map(describePreferenceCondition).join('，并且');
  if ('any' in condition) return `（${condition.any.map(describePreferenceCondition).join('，或者')}）`;
  const definition = preferenceDefinitionMap[condition.field];
  const format = (value: string | number | boolean) => typeof value === 'boolean'
    ? value ? '开启' : '关闭'
    : definition.options?.find((option) => option.value === value)?.label ?? String(value);
  return `${definition.label}为${'equals' in condition ? format(condition.equals) : condition.in.map(format).join(' / ')}`;
}

/** 新文档格式；未知或旧格式视为空个人覆盖，不迁移旧数据。 */
export function readUserPreferencesDocument(raw: unknown): UserPreferencesDocument {
  const parsed = userPreferencesDocumentSchema.safeParse(raw);
  return parsed.success ? parsed.data : { overrides: {} };
}

/** 导入按叶子独立校验，非法值被过滤；不会补齐未提交的默认值。 */
export function sanitizePreferenceOverrides(raw: unknown): PreferenceOverrides | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  let result: PreferenceOverrides = {};
  for (const path of knownPaths) {
    const value = getPreferenceValue(raw, path as PersonalPreferencePath);
    if (value === undefined) continue;
    const schema = path.startsWith('terminal.')
      ? terminalPreferencesSchema.shape[path.slice(9) as keyof typeof terminalPreferencesSchema.shape]
      : preferenceValuesSchema.shape[path as Exclude<keyof typeof preferenceValuesSchema.shape, 'terminal'>];
    const parsed = schema.safeParse(value);
    if (parsed.success) result = setPreferenceValue(result, path as PersonalPreferencePath, parsed.data);
  }
  return Object.keys(result).length ? preferenceOverridesSchema.parse(result) : null;
}

validatePreferenceDefinitions();
