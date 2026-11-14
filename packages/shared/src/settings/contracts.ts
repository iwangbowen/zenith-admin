import * as z from 'zod';
import { defineContract, op, type Operation } from '../core/contract';
import { SETTINGS_SCOPES } from './constants';
import { SETTINGS_MODULE_KEYS, SETTINGS_MODULE_PATHS, SETTINGS_MODULES, type SettingsModuleKey, type SettingsOf } from './registry';
import { settingsOverridesSchema } from './overrides';
import { settingsProjectionContract } from './projections';

// ─── 模块清单 ────────────────────────────────────────────────────────────────

export const settingsModuleMetaSchema = z.object({
  module: z.enum(SETTINGS_MODULE_KEYS as [SettingsModuleKey, ...SettingsModuleKey[]]),
  path: z.string().meta({ description: '模块在 /api/settings 下的路径片段', example: '/identity-security' }),
  title: z.string(),
  description: z.string(),
  scope: z.enum(SETTINGS_SCOPES),
  feature: z.string().nullable().meta({ description: 'License 特性门控；null = 无门控' }),
  page: z.string().nullable().meta({ description: '专用页面路由；null = 使用通用设置页' }),
  canWrite: z.boolean(),
  version: z.int().min(0).meta({ description: '当前作用域的配置版本；0 = 尚未保存' }),
  overriddenCount: z.int().min(0).meta({ description: '当前作用域显式覆盖的叶子字段数' }),
  updatedAt: z.string().nullable(),
}).meta({ id: 'SettingsModuleMeta' });

export type SettingsModuleMeta = z.infer<typeof settingsModuleMetaSchema>;

// ─── 投影：匿名 / 登录用户 ─────────────────────────────────────────────────────
// 显式书写而非按注册表推导，是为了给前端精确类型；`settings.test.ts` 断言这里的键集与
// 注册表 `visibility` 声明一致，两处不会漂移。

export { publicSettingsSchema, mySettingsSchema, publicSettingsQuery } from './projections';
export type { PublicSettings, MySettings } from './projections';

// ─── 模块读写载荷 ────────────────────────────────────────────────────────────

function pascal(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export const settingsEnvelopeMetaSchema = z.object({
  scope: z.enum(SETTINGS_SCOPES),
  tenantId: z.int().nullable(),
  version: z.int().min(0).meta({ description: '当前作用域配置版本；0 = 尚未保存' }),
  currentRevisionId: z.int().positive().nullable(),
  baseToken: z.string().min(1).max(512).meta({ description: '不透明并发指纹，涵盖本层、上级与设置定义，保存时原样回传' }),
  inheritedVersion: z.int().min(0),
  definitionHash: z.string(),
  overrides: z.record(z.string(), z.unknown()).meta({ description: '显式覆盖；省略字段继承，等于上级的叶子仍保留覆盖' }),
  overriddenPaths: z.array(z.string()).meta({ description: '当前作用域显式覆盖的叶子路径（a.b.c）' }),
  updatedAt: z.string().nullable(),
});

/** 读取信封直接携带显式覆盖关系，禁止通过 effective 与 inherited 的值差推断继承。 */
export function settingsEnvelopeSchema<M extends SettingsModuleKey>(module: M): z.ZodType<SettingsEnvelope<M>> {
  const schema = SETTINGS_MODULES[module].schema;
  return settingsEnvelopeMetaSchema.extend({
    module: z.literal(module),
    effective: schema,
    inherited: schema,
  // 信封结构是固定的；显式类型避免每个 get / update 都重复展开整套设置的 Zod 节点类型。
  }).meta({ id: `Settings${pascal(module)}Envelope` }) as unknown as z.ZodType<SettingsEnvelope<M>>;
}

export const settingsWriteBodySchema = z.strictObject({
  baseToken: settingsEnvelopeMetaSchema.shape.baseToken,
  overrides: z.record(z.string(), z.unknown()),
  note: z.string().trim().max(500).optional(),
});

/** 全量替换本层覆盖文档；仅已知叶子可写，默认值不会填入省略字段。 */
function settingsWriteSchema<M extends SettingsModuleKey>(module: M): z.ZodType<SettingsWriteBody<M>, SettingsWriteBody<M>> {
  return settingsWriteBodySchema.extend({
    overrides: settingsOverridesSchema(module),
  }).meta({ id: `Settings${pascal(module)}Write` }) as unknown as z.ZodType<SettingsWriteBody<M>, SettingsWriteBody<M>>;
}

function moduleOps<M extends SettingsModuleKey>(module: M) {
  const def = SETTINGS_MODULES[module];
  const path = SETTINGS_MODULE_PATHS[module];
  const envelope = settingsEnvelopeSchema(module);
  // 访问要求直接取模块定义：readPermission 为 null = 任意登录用户可读；feature 随模块门控
  const feature = def.feature ? { feature: def.feature } : {};
  const platformOnly = def.platformOnly ? { platformOnly: def.platformOnly } : {};
  return {
    get: op.get(path, {
      access: def.readPermission ? { permission: def.readPermission, ...platformOnly } : def.platformOnly ? { platformOnly: def.platformOnly } : 'authenticated',
      ...feature,
      response: envelope,
      summary: `读取「${def.title}」设置`,
    }),
    update: op.put(path, {
      access: { permission: def.writePermission, ...platformOnly },
      audit: { description: `更新「${def.title}」设置`, module: '系统设置' },
      ...feature,
      body: settingsWriteSchema(module),
      response: envelope,
      summary: `保存「${def.title}」设置（显式覆盖，baseToken 并发校验）`,
    }),
  };
}

const auth = moduleOps('auth');
const analytics = moduleOps('analytics');
const identitySecurity = moduleOps('identitySecurity');
const ui = moduleOps('ui');
const files = moduleOps('files');
const exportsPolicy = moduleOps('exports');
const terminal = moduleOps('terminal');
const member = moduleOps('member');
const ai = moduleOps('ai');
const rules = moduleOps('rules');
const payment = moduleOps('payment');
const workflow = moduleOps('workflow');
const ipAccess = moduleOps('ipAccess');
const drive = moduleOps('drive');
const wiki = moduleOps('wiki');
const errorTracking = moduleOps('errorTracking');
const sqlMonitor = moduleOps('sqlMonitor');

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const settingsContract = defineContract('/api/settings', {
  list: op.get('/', { access: 'authenticated', response: z.array(settingsModuleMetaSchema), summary: '当前用户可读的设置模块清单' }),
  public: settingsProjectionContract.public,
  me: settingsProjectionContract.me,

  getAuth: auth.get, updateAuth: auth.update,
  getAnalytics: analytics.get, updateAnalytics: analytics.update,
  getIdentitySecurity: identitySecurity.get, updateIdentitySecurity: identitySecurity.update,
  getUi: ui.get, updateUi: ui.update,
  getFiles: files.get, updateFiles: files.update,
  getExports: exportsPolicy.get, updateExports: exportsPolicy.update,
  getTerminal: terminal.get, updateTerminal: terminal.update,
  getMember: member.get, updateMember: member.update,
  getAi: ai.get, updateAi: ai.update,
  getRules: rules.get, updateRules: rules.update,
  getPayment: payment.get, updatePayment: payment.update,
  getWorkflow: workflow.get, updateWorkflow: workflow.update,
  getIpAccess: ipAccess.get, updateIpAccess: ipAccess.update,
  getDrive: drive.get, updateDrive: drive.update,
  getWiki: wiki.get, updateWiki: wiki.update,
  getErrorTracking: errorTracking.get, updateErrorTracking: errorTracking.update,
  getSqlMonitor: sqlMonitor.get, updateSqlMonitor: sqlMonitor.update,
}, { tags: ['Settings'] });

export type SettingsContract = typeof settingsContract;

/** 模块 key → 契约上的读 / 写操作名（`getIdentitySecurity` / `updateIdentitySecurity`） */
export type SettingsGetOpName<M extends SettingsModuleKey> = `get${Capitalize<M>}`;
export type SettingsUpdateOpName<M extends SettingsModuleKey> = `update${Capitalize<M>}`;

export function settingsGetOp<M extends SettingsModuleKey>(module: M): SettingsContract[SettingsGetOpName<M>] {
  return settingsContract[`get${pascal(module)}` as SettingsGetOpName<M>];
}

export function settingsUpdateOp<M extends SettingsModuleKey>(module: M): SettingsContract[SettingsUpdateOpName<M>] {
  return settingsContract[`update${pascal(module)}` as SettingsUpdateOpName<M>];
}

/**
 * 信封公共字段从 schema 派生，仅对模块与设置正文参数化，保留 hooks / Mock 循环调用的精确类型。
 */
export type SettingsEnvelope<M extends SettingsModuleKey> = z.infer<typeof settingsEnvelopeMetaSchema> & {
  module: M;
  effective: SettingsOf<M>;
  inherited: SettingsOf<M>;
};

/** 泛型参数保持模块调用点统一；覆盖内容由该模块的运行时 schema 严格校验。 */
export type SettingsWriteBody<M extends SettingsModuleKey = SettingsModuleKey> = {
  [K in M]: z.output<typeof settingsWriteBodySchema>;
}[M];

/**
 * 按模块参数化的操作类型：泛型调用点把 `settingsGetOp(module)` / `settingsUpdateOp(module)` 断言到这里，
 * 既能循环处理 13 个模块，又保留精确的输入 / 输出类型。运行时对象仍是契约上的原操作。
 */
export type SettingsGetOperation<M extends SettingsModuleKey> =
  Operation<'get', string, undefined, undefined, undefined, z.ZodType<SettingsEnvelope<M>>, 'json', undefined>;
export type SettingsUpdateOperation<M extends SettingsModuleKey> =
  Operation<'put', string, undefined, undefined, z.ZodType<SettingsWriteBody<M>, SettingsWriteBody<M>>, z.ZodType<SettingsEnvelope<M>>, 'json', undefined>;
