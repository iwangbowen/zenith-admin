import type * as z from 'zod';
import { SETTINGS_RESERVED_MODULE_NAMES } from './constants';
import type { SettingsModuleDef } from './module-def';
import { aiSettingsModule } from './modules/ai';
import { authSettingsModule } from './modules/auth';
import { driveSettingsModule } from './modules/drive';
import { filesSettingsModule } from './modules/files';
import { identitySecuritySettingsModule } from './modules/identity-security';
import { ipAccessSettingsModule } from './modules/ip-access';
import { memberSettingsModule } from './modules/member';
import { paymentSettingsModule } from './modules/payment';
import { rulesSettingsModule } from './modules/rules';
import { terminalSettingsModule } from './modules/terminal';
import { uiSettingsModule } from './modules/ui';
import { wikiSettingsModule } from './modules/wiki';
import { workflowSettingsModule } from './modules/workflow';

/**
 * 设置模块注册表：新增模块只需在 `modules/` 建文件并在此登记一行（同时补 `SETTINGS_MODULE_PATHS`）。
 * 契约、服务端读取、通用设置页、MSW 全部由注册表派生。
 */
export const SETTINGS_MODULES = {
  auth: authSettingsModule,
  identitySecurity: identitySecuritySettingsModule,
  ui: uiSettingsModule,
  files: filesSettingsModule,
  terminal: terminalSettingsModule,
  member: memberSettingsModule,
  ai: aiSettingsModule,
  rules: rulesSettingsModule,
  payment: paymentSettingsModule,
  workflow: workflowSettingsModule,
  ipAccess: ipAccessSettingsModule,
  drive: driveSettingsModule,
  wiki: wikiSettingsModule,
} as const satisfies Record<string, SettingsModuleDef>;

export type SettingsModuleKey = keyof typeof SETTINGS_MODULES;
export type SettingsSchemaOf<M extends SettingsModuleKey> = (typeof SETTINGS_MODULES)[M]['schema'];
/** 模块生效文档（解析后，含默认值） */
export type SettingsOf<M extends SettingsModuleKey> = z.output<SettingsSchemaOf<M>>;
/** 模块覆盖文档（稀疏，字段可省略 = 继承） */
export type SettingsInputOf<M extends SettingsModuleKey> = z.input<SettingsSchemaOf<M>>;

/** 模块在 `/api/settings` 下的路径片段（kebab-case，字面量类型供契约逐模块推导） */
export const SETTINGS_MODULE_PATHS = {
  auth: '/auth',
  identitySecurity: '/identity-security',
  ui: '/ui',
  files: '/files',
  terminal: '/terminal',
  member: '/member',
  ai: '/ai',
  rules: '/rules',
  payment: '/payment',
  workflow: '/workflow',
  ipAccess: '/ip-access',
  drive: '/drive',
  wiki: '/wiki',
} as const satisfies Record<SettingsModuleKey, `/${string}`>;

export const SETTINGS_MODULE_KEYS = Object.keys(SETTINGS_MODULES) as SettingsModuleKey[];

export function isSettingsModuleKey(value: string): value is SettingsModuleKey {
  return Object.hasOwn(SETTINGS_MODULES, value);
}

/** 模块 key ↔ 路径片段（去掉前导斜杠）互查 */
export function settingsModuleBySlug(slug: string): SettingsModuleKey | null {
  for (const key of SETTINGS_MODULE_KEYS) {
    if (SETTINGS_MODULE_PATHS[key] === `/${slug}`) return key;
  }
  return null;
}

/** 字段名不得命中的敏感词：审计日志的 before / after 快照不脱敏，设置文档里不能出现凭证 */
const SENSITIVE_FIELD_TOKENS = ['password', 'secret', 'token', 'apikey', 'api_key', 'privatekey', 'private_key', 'credential'];

/** 剥掉 default / prefault / optional / nullable 包装，取最内层 schema */
function unwrap(field: z.ZodType): z.ZodType {
  let current = field;
  for (;;) {
    const def = current.def as { type?: string; innerType?: z.ZodType };
    if ((def.type === 'default' || def.type === 'prefault' || def.type === 'optional' || def.type === 'nullable') && def.innerType) {
      current = def.innerType;
      continue;
    }
    return current;
  }
}

/** 叶子字段路径（`a.b.c`）：嵌套对象递归展开 */
export function settingsLeafPaths(schema: z.ZodObject, prefix = ''): string[] {
  return settingsLeafFields(schema, prefix).map((leaf) => leaf.path);
}

/** 叶子字段及其最内层类型名（`string` / `number` / `boolean` / `array` / `enum` …） */
export function settingsLeafFields(schema: z.ZodObject, prefix = ''): Array<{ path: string; type: string }> {
  const leaves: Array<{ path: string; type: string }> = [];
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    const inner = unwrap(field);
    const path = prefix ? `${prefix}.${key}` : key;
    if (inner.def.type === 'object') leaves.push(...settingsLeafFields(inner as z.ZodObject, path));
    else leaves.push({ path, type: String(inner.def.type) });
  }
  return leaves;
}

/**
 * 注册表启动自检（服务端 `index.ts` 首行调用、shared 单测覆盖）。任一失败都应让进程拒绝启动：
 * 1. `schema.parse({})` 必须成功且幂等——否则缺默认值 / 嵌套对象漏 `.prefault({})`，运行期读取会抛错；
 * 2. 模块名不得是保留字，路径片段必须唯一且为 kebab-case；
 * 3. 顶层字段名不得命中敏感词——设置不是凭证的存放处（凭证走各自配置表 + secret-crypto）；
 * 4. `visibility` 只能声明 schema 中存在的顶层字段。
 */
export function validateSettingsRegistry(): string[] {
  const errors: string[] = [];
  const seenPaths = new Set<string>();
  for (const key of SETTINGS_MODULE_KEYS) {
    const def: SettingsModuleDef = SETTINGS_MODULES[key];
    const path = SETTINGS_MODULE_PATHS[key];
    if ((SETTINGS_RESERVED_MODULE_NAMES as readonly string[]).includes(key)) errors.push(`[${key}] 模块名是保留字`);
    if (!/^\/[a-z][a-z0-9-]*$/.test(path)) errors.push(`[${key}] 路径片段必须为 kebab-case：${path}`);
    if (seenPaths.has(path)) errors.push(`[${key}] 路径片段重复：${path}`);
    seenPaths.add(path);
    if ((SETTINGS_RESERVED_MODULE_NAMES as readonly string[]).includes(path.slice(1))) errors.push(`[${key}] 路径片段是保留字：${path}`);

    const first = def.schema.safeParse({});
    if (!first.success) {
      errors.push(`[${key}] 空文档解析失败（缺默认值或嵌套对象缺 .prefault({})）：${first.error.issues.map((i) => i.path.join('.')).join(', ')}`);
    } else {
      const second = def.schema.safeParse(first.data);
      if (!second.success || JSON.stringify(second.data) !== JSON.stringify(first.data)) {
        errors.push(`[${key}] 默认文档解析不幂等`);
      }
    }

    const fields = Object.keys(def.schema.shape);
    if (fields.length === 0) errors.push(`[${key}] schema 没有任何字段`);
    // 只有字符串（或字符串数组）叶子可能承载凭证；布尔 / 数值即使名字带 password（如 forgotPasswordEnabled）也不是秘密
    for (const leaf of settingsLeafFields(def.schema)) {
      if (leaf.type !== 'string' && leaf.type !== 'array') continue;
      const name = leaf.path.slice(leaf.path.lastIndexOf('.') + 1).toLowerCase();
      if (SENSITIVE_FIELD_TOKENS.some((token) => name.includes(token))) {
        errors.push(`[${key}.${leaf.path}] 字段名命中敏感词，设置文档不得承载凭证`);
      }
    }
    for (const field of Object.keys(def.visibility ?? {})) {
      if (!fields.includes(field)) errors.push(`[${key}] visibility 引用了不存在的字段：${field}`);
    }
  }
  return errors;
}
