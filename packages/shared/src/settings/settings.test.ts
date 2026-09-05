import { describe, expect, expectTypeOf, it } from 'vitest';
import * as z from 'zod';
import { stripDefaultsDeep } from '../core/validation';
import {
  mySettingsSchema,
  publicSettingsSchema,
  settingsContract,
  settingsGetOp,
  settingsUpdateOp,
  type SettingsEnvelope,
} from './contracts';
import { identitySecuritySettingsSchema, validatePassword } from './modules/identity-security';
import { isIpOrCidr } from './modules/ip-access';
import {
  SETTINGS_MODULE_KEYS,
  SETTINGS_MODULE_PATHS,
  SETTINGS_MODULES,
  settingsLeafPaths,
  settingsModuleBySlug,
  validateSettingsRegistry,
  type SettingsOf,
} from './registry';
import {
  diffSettings,
  mergeSettingsLayers,
  pickSettingsFields,
  resolveSettings,
  settingsModuleHasVisibility,
  settingsOverriddenPaths,
} from './resolve';

describe('settings registry', () => {
  it('通过全部启动自检（默认文档可解析且幂等、无敏感字段名、路径唯一）', () => {
    expect(validateSettingsRegistry()).toEqual([]);
  });

  it('每个模块 parse({}) 得到完整默认文档，且再解析一次不变', () => {
    for (const key of SETTINGS_MODULE_KEYS) {
      const schema = SETTINGS_MODULES[key].schema;
      const defaults = schema.parse({});
      expect(schema.parse(defaults)).toEqual(defaults);
      // 叶子字段全部有值（没有 undefined 漏网）
      for (const path of settingsLeafPaths(schema)) {
        const value = path.split('.').reduce<unknown>((acc, seg) => (acc as Record<string, unknown>)[seg], defaults);
        expect(value, `${key}.${path}`).not.toBeUndefined();
      }
    }
  });

  it('被后台任务读取的模块必须是平台级', () => {
    // member-housekeeping / wiki governance / drive-tasks / terminal 清理任务都在无请求上下文下读取
    for (const key of ['member', 'wiki', 'drive', 'terminal', 'ai', 'files', 'ui', 'auth', 'ipAccess', 'rules', 'workflow'] as const) {
      expect(SETTINGS_MODULES[key].scope, key).toBe('platform');
    }
    expect(SETTINGS_MODULES.identitySecurity.scope).toBe('tenant');
    expect(SETTINGS_MODULES.payment.scope).toBe('tenant');
  });

  it('路径片段与模块 key 可互查', () => {
    expect(settingsModuleBySlug('identity-security')).toBe('identitySecurity');
    expect(settingsModuleBySlug('nope')).toBeNull();
    expect(SETTINGS_MODULE_PATHS.ipAccess).toBe('/ip-access');
  });

  it('password 作为分组名合法：敏感词检查只看叶子', () => {
    expect(settingsLeafPaths(identitySecuritySettingsSchema)).toContain('password.minLength');
    expect(settingsLeafPaths(identitySecuritySettingsSchema)).not.toContain('password');
  });
});

describe('resolveSettings', () => {
  it('按 默认 ← 平台 ← 租户 逐层覆盖，嵌套对象递归、数组整体替换', () => {
    const merged = mergeSettingsLayers(
      { a: { x: 1, y: 2 }, list: [1, 2] },
      { a: { y: 3 }, list: [9] },
    );
    expect(merged).toEqual({ a: { x: 1, y: 3 }, list: [9] });

    const resolved = resolveSettings('identitySecurity', [
      { lockout: { maxAttempts: 5 } },
      { lockout: { durationMinutes: 60 }, mfa: { enabled: true } },
    ]);
    expect(resolved.degraded).toBe(false);
    expect(resolved.value.lockout).toEqual({ maxAttempts: 5, durationMinutes: 60 });
    expect(resolved.value.mfa.enabled).toBe(true);
    expect(resolved.value.password.minLength).toBe(6);
  });

  it('存量字段不合规时剔除该字段并降级，而不是抛错', () => {
    const resolved = resolveSettings('identitySecurity', [{ lockout: { maxAttempts: 'many', durationMinutes: 45 } }]);
    expect(resolved.degraded).toBe(true);
    expect(resolved.droppedPaths).toEqual(['lockout.maxAttempts']);
    expect(resolved.value.lockout).toEqual({ maxAttempts: 10, durationMinutes: 45 });
  });

  it('整体不可解析时回退纯默认文档', () => {
    const resolved = resolveSettings('ui', [{ watermark: 'oops' }]);
    expect(resolved.degraded).toBe(true);
    expect(resolved.value).toEqual(SETTINGS_MODULES.ui.schema.parse({}));
  });

  it('diff 只保留与上级不同的叶子，等值即继承', () => {
    const inherited = SETTINGS_MODULES.identitySecurity.schema.parse({});
    const effective: SettingsOf<'identitySecurity'> = {
      ...inherited,
      lockout: { ...inherited.lockout, maxAttempts: 3 },
      mfa: { ...inherited.mfa },
    };
    const own = diffSettings(effective, inherited);
    expect(own).toEqual({ lockout: { maxAttempts: 3 } });
    expect(settingsOverriddenPaths(own)).toEqual(['lockout.maxAttempts']);
    expect(diffSettings(inherited, inherited)).toEqual({});
  });

  it('按可见性投影顶层字段', () => {
    const effective = SETTINGS_MODULES.identitySecurity.schema.parse({});
    expect(Object.keys(pickSettingsFields('identitySecurity', effective, ['public']))).toEqual(['password']);
    expect(Object.keys(pickSettingsFields('identitySecurity', effective, ['admin']))).toEqual(['lockout', 'mfa', 'risk']);
    expect(settingsModuleHasVisibility('ui', ['authenticated'])).toBe(true);
    expect(settingsModuleHasVisibility('drive', ['public', 'authenticated'])).toBe(false);
  });
});

describe('stripDefaultsDeep', () => {
  const read = z.object({
    flag: z.boolean().default(false).meta({ title: '开关' }),
    nested: z.object({ n: z.int().min(1).default(3) }).prefault({}),
    list: z.array(z.string()).max(2).default(() => []),
  }).meta({ id: 'StripDemo' });
  const write = stripDefaultsDeep(read, { strictObjects: true });

  it('派生 schema 全字段必填、无默认值、未知键拒绝，校验与说明保留', () => {
    expect(write.safeParse({}).success).toBe(false);
    expect(write.safeParse({ flag: true, nested: { n: 2 }, list: ['a'] }).success).toBe(true);
    expect(write.safeParse({ flag: true, nested: {}, list: [] }).success).toBe(false);
    expect(write.safeParse({ flag: true, nested: { n: 0 }, list: [] }).success).toBe(false);
    expect(write.safeParse({ flag: true, nested: { n: 1 }, list: ['a', 'b', 'c'] }).success).toBe(false);
    expect(write.safeParse({ flag: true, nested: { n: 1 }, list: [], extra: 1 }).success).toBe(false);
    const json = JSON.stringify(z.toJSONSchema(write, { unrepresentable: 'any' }));
    expect(json).not.toContain('"default"');
    expect(json).toContain('"title":"开关"');
    // 不复制 id：与源 schema 的注册表条目不冲突
    expect(write.meta()?.id).toBeUndefined();
  });
});

describe('settingsContract', () => {
  it('每个模块都有字面量路径的 get / update 操作', () => {
    for (const key of SETTINGS_MODULE_KEYS) {
      const get = settingsGetOp(key);
      const update = settingsUpdateOp(key);
      expect(get.method).toBe('get');
      expect(update.method).toBe('put');
      expect(get.fullPath).toBe(`/api/settings${SETTINGS_MODULE_PATHS[key]}`);
      expect(update.fullPath).toBe(get.fullPath);
      expect(get.public).toBe(false);
    }
    expect(settingsContract.public.public).toBe(true);
    expect(settingsContract.me.public).toBe(false);
    expect(settingsContract.list.fullPath).toBe('/api/settings');
  });

  it('PUT 请求体不含任何 default，且 version + 完整 data 必填', () => {
    for (const key of SETTINGS_MODULE_KEYS) {
      const body = settingsUpdateOp(key).body;
      const json = JSON.stringify(z.toJSONSchema(body, { unrepresentable: 'any' }));
      expect(json, key).not.toContain('"default"');
      expect(body.safeParse({ version: 0, data: SETTINGS_MODULES[key].schema.parse({}) }).success, key).toBe(true);
      expect(body.safeParse({ version: 0, data: {} }).success, key).toBe(false);
    }
  });

  it('public / me 投影与注册表 visibility 声明一致', () => {
    const publicKeys = Object.fromEntries(
      Object.entries(publicSettingsSchema.shape).map(([module, schema]) => [module, Object.keys((schema as z.ZodObject).shape).sort()]),
    );
    const expectedPublic: Record<string, string[]> = {};
    const expectedMe: Record<string, string[]> = {};
    for (const key of SETTINGS_MODULE_KEYS) {
      const visibility = SETTINGS_MODULES[key].visibility ?? {};
      const pub = Object.entries(visibility).filter(([, v]) => v === 'public').map(([f]) => f).sort();
      const me = Object.entries(visibility).filter(([, v]) => v === 'public' || v === 'authenticated').map(([f]) => f).sort();
      if (pub.length) expectedPublic[key] = pub;
      if (me.length) expectedMe[key] = me;
    }
    expect(publicKeys).toEqual(expectedPublic);

    const meKeys = Object.fromEntries(
      Object.entries(mySettingsSchema.shape).map(([module, schema]) => {
        const inner = schema instanceof z.ZodOptional ? (schema.def.innerType as z.ZodObject) : (schema as z.ZodObject);
        return [module, Object.keys(inner.shape).sort()];
      }),
    );
    expect(meKeys).toEqual(expectedMe);
    // 带 License 门控的模块在 me 中必须是 optional，无门控的必须必填
    for (const [module, schema] of Object.entries(mySettingsSchema.shape)) {
      const gated = SETTINGS_MODULES[module as keyof typeof SETTINGS_MODULES].feature !== undefined;
      expect(schema instanceof z.ZodOptional, module).toBe(gated);
    }
  });

  it('类型：读取信封的 effective 与模块类型一致', () => {
    expectTypeOf<SettingsEnvelope<'drive'>['effective']>().toEqualTypeOf<SettingsOf<'drive'>>();
    expectTypeOf<SettingsEnvelope<'drive'>['effective']['blockedExtensions']>().toEqualTypeOf<string[]>();
  });
});

describe('module helpers', () => {
  it('validatePassword 按策略返回文案', () => {
    const policy = SETTINGS_MODULES.identitySecurity.schema.parse({}).password;
    expect(validatePassword('12345', policy)).toContain('6');
    expect(validatePassword('123456', policy)).toBeNull();
    expect(validatePassword('abcdef', { ...policy, requireUppercase: true })).toContain('大写');
    expect(validatePassword('Abcdef', { ...policy, requireUppercase: true, requireSpecialChar: true })).toContain('特殊');
    expect(validatePassword('Abcde!', { ...policy, requireUppercase: true, requireSpecialChar: true })).toBeNull();
  });

  it('isIpOrCidr 接受 IPv4 / IPv6 / CIDR，拒绝垃圾输入', () => {
    expect(isIpOrCidr('10.0.0.1')).toBe(true);
    expect(isIpOrCidr('10.0.0.0/8')).toBe(true);
    expect(isIpOrCidr('256.0.0.1')).toBe(false);
    expect(isIpOrCidr('10.0.0.0/33')).toBe(false);
    expect(isIpOrCidr('::1')).toBe(true);
    expect(isIpOrCidr('fe80::/10')).toBe(true);
    expect(isIpOrCidr('not-an-ip')).toBe(false);
    expect(isIpOrCidr('')).toBe(false);
  });
});
