import * as z from 'zod';
import { defineContract, op } from '../core/contract';
import { stripDefaultsDeep } from '../core/validation';
import { SETTINGS_SCOPES } from './constants';
import { authSettingsSchema } from './modules/auth';
import { identitySecuritySettingsSchema } from './modules/identity-security';
import { rulesSettingsSchema } from './modules/rules';
import { terminalSettingsSchema } from './modules/terminal';
import { uiSettingsSchema } from './modules/ui';
import { SETTINGS_MODULE_KEYS, SETTINGS_MODULE_PATHS, SETTINGS_MODULES, type SettingsModuleKey } from './registry';

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
  version: z.int().min(0).meta({ description: '当前作用域的行版本；0 = 尚无覆盖行' }),
  overriddenCount: z.int().min(0).meta({ description: '当前作用域显式覆盖的叶子字段数' }),
  updatedAt: z.string().nullable(),
}).meta({ id: 'SettingsModuleMeta' });

export type SettingsModuleMeta = z.infer<typeof settingsModuleMetaSchema>;

// ─── 投影：匿名 / 登录用户 ─────────────────────────────────────────────────────
// 显式书写而非按注册表推导，是为了给前端精确类型；`settings.test.ts` 断言这里的键集与
// 注册表 `visibility` 声明一致，两处不会漂移。

export const publicSettingsSchema = z.object({
  auth: authSettingsSchema.pick({ captchaEnabled: true, captchaComplexity: true, allowRegistration: true, forgotPasswordEnabled: true }),
  identitySecurity: identitySecuritySettingsSchema.pick({ password: true }),
}).meta({ id: 'PublicSettings' });

export type PublicSettings = z.output<typeof publicSettingsSchema>;

export const mySettingsSchema = z.object({
  auth: authSettingsSchema.pick({ captchaEnabled: true, captchaComplexity: true, allowRegistration: true, forgotPasswordEnabled: true }),
  identitySecurity: identitySecuritySettingsSchema.pick({ password: true }),
  ui: uiSettingsSchema.pick({ watermark: true, quickChatEnabled: true, feedbackEntryEnabled: true }),
  // 带 License 门控的模块：租户套餐未含该特性时不返回
  terminal: terminalSettingsSchema.pick({ recordingEnabled: true }).optional(),
  rules: rulesSettingsSchema.pick({ publishApproval: true }).optional(),
}).meta({ id: 'MySettings' });

export type MySettings = z.output<typeof mySettingsSchema>;

export const publicSettingsQuery = z.object({
  tenantCode: z.string().trim().max(64).optional().meta({ description: '多租户模式下按租户编码解析租户级设置；缺省或无效时返回平台值' }),
});

// ─── 模块读写载荷 ────────────────────────────────────────────────────────────

function pascal(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * 单个模块的读取信封：`effective` 为解析后的生效文档，`inherited` 为上级生效文档
 * （租户作用域 = 平台生效值；平台作用域 = schema 默认值），两者叶级比较即得「已覆盖」标记。
 */
function settingsEnvelopeSchema<M extends SettingsModuleKey>(module: M) {
  const schema = SETTINGS_MODULES[module].schema;
  return z.object({
    module: z.literal(module),
    scope: z.enum(SETTINGS_SCOPES),
    tenantId: z.int().nullable(),
    version: z.int().min(0).meta({ description: '当前作用域行版本；0 = 尚无覆盖行，保存时原样回传' }),
    effective: schema,
    inherited: schema,
    overriddenPaths: z.array(z.string()).meta({ description: '当前作用域显式覆盖的叶子路径（a.b.c）' }),
    updatedAt: z.string().nullable(),
  }).meta({ id: `Settings${pascal(module)}Envelope` });
}

/**
 * 整体替换请求体：`data` 由读取 schema 深度剥离默认值派生——全字段必填、未知键 400，
 * 客户端必须回传完整文档；`version` 与当前行版本不一致时服务端返回 409。
 */
function settingsWriteSchema<M extends SettingsModuleKey>(module: M) {
  return z.object({
    version: z.int().min(0),
    data: stripDefaultsDeep(SETTINGS_MODULES[module].schema, { strictObjects: true }),
  }).meta({ id: `Settings${pascal(module)}Write` });
}

function moduleOps<M extends SettingsModuleKey>(module: M) {
  const def = SETTINGS_MODULES[module];
  const path = SETTINGS_MODULE_PATHS[module];
  const envelope = settingsEnvelopeSchema(module);
  return {
    get: op.get(path, { response: envelope, summary: `读取「${def.title}」设置` }),
    update: op.put(path, {
      body: settingsWriteSchema(module),
      response: envelope,
      summary: `保存「${def.title}」设置（整体替换，version 乐观锁）`,
    }),
  };
}

const auth = moduleOps('auth');
const identitySecurity = moduleOps('identitySecurity');
const ui = moduleOps('ui');
const files = moduleOps('files');
const terminal = moduleOps('terminal');
const member = moduleOps('member');
const ai = moduleOps('ai');
const rules = moduleOps('rules');
const payment = moduleOps('payment');
const workflow = moduleOps('workflow');
const ipAccess = moduleOps('ipAccess');
const drive = moduleOps('drive');
const wiki = moduleOps('wiki');

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const settingsContract = defineContract('/api/settings', {
  list: op.get('/', { response: z.array(settingsModuleMetaSchema), summary: '当前用户可读的设置模块清单' }),
  public: op.get('/public', { query: publicSettingsQuery, response: publicSettingsSchema, public: true, summary: '匿名可见的设置投影（登录 / 注册页）' }),
  me: op.get('/me', { response: mySettingsSchema, summary: '登录用户可见的设置投影（布局开关 / 密码规则 / 终端录屏）' }),

  getAuth: auth.get, updateAuth: auth.update,
  getIdentitySecurity: identitySecurity.get, updateIdentitySecurity: identitySecurity.update,
  getUi: ui.get, updateUi: ui.update,
  getFiles: files.get, updateFiles: files.update,
  getTerminal: terminal.get, updateTerminal: terminal.update,
  getMember: member.get, updateMember: member.update,
  getAi: ai.get, updateAi: ai.update,
  getRules: rules.get, updateRules: rules.update,
  getPayment: payment.get, updatePayment: payment.update,
  getWorkflow: workflow.get, updateWorkflow: workflow.update,
  getIpAccess: ipAccess.get, updateIpAccess: ipAccess.update,
  getDrive: drive.get, updateDrive: drive.update,
  getWiki: wiki.get, updateWiki: wiki.update,
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

/** 模块读取信封（前端 hooks 用） */
export type SettingsEnvelope<M extends SettingsModuleKey> = z.output<SettingsContract[SettingsGetOpName<M>]['response']>;
/** 模块写入请求体 */
export type SettingsWriteBody<M extends SettingsModuleKey> = z.input<NonNullable<SettingsContract[SettingsUpdateOpName<M>]['body']>>;
