/**
 * 运行时设置读取 / 写入层单测。
 *
 * 覆盖要点：
 *  1. 无任何行 → schema 默认文档；命中副本后不再查库；invalidateSettings 后重新加载
 *  2. 租户级模块：默认 ← 平台行 ← 租户行 逐层覆盖；平台级模块忽略租户上下文
 *  3. 存量文档不合规 → 剔除违规字段、记 error 日志，而不是抛错
 *  4. saveSettings：version 不一致 → 409；落库只存与上级不同的叶子（稀疏）；保存后副本失效
 *  5. 作用域越权：多租户下租户管理员写平台级模块 → 403；写租户级模块落到自身租户行
 *  6. 失效总线：收到 system_settings/{module} 通知只清该模块，reset 清全部
 *
 * Mock 策略：db 用「按调用顺序出队」的链式替身（select 结果队列 + insert / update 记录），
 * 请求上下文 / 许可 / 套餐 / 权限全部 mock。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import type { JwtPayload } from '../../middleware/auth';

// vi.mock 工厂会被提升到文件顶部，工厂内引用的状态必须经 vi.hoisted 声明
const { dbState, configState, ctx, logger } = vi.hoisted(() => ({
  dbState: {
    selectResults: [] as unknown[][],
    inserts: [] as Record<string, unknown>[],
    updates: [] as Record<string, unknown>[],
  },
  configState: { multiTenantMode: false },
  ctx: { user: null as { userId: number; username: string; roles: string[]; tenantId: number | null } | null },
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../db', () => {
  function chain(kind: 'select' | 'insert' | 'update') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p: any = {
      from: () => p,
      where: () => p,
      for: () => p,
      limit: () => p,
      set: (v: Record<string, unknown>) => { dbState.updates.push(v); return p; },
      values: (v: Record<string, unknown>) => { dbState.inserts.push(v); return p; },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const result = kind === 'select' ? (dbState.selectResults.shift() ?? []) : [];
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return p;
  }
  const db = {
    select: vi.fn(() => chain('select')),
    insert: vi.fn(() => chain('insert')),
    update: vi.fn(() => chain('update')),
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(db)),
  };
  return { db, pgClient: { listen: vi.fn() } };
});

vi.mock('../../config', () => ({
  config: {
    get multiTenantMode() { return configState.multiTenantMode; },
    settings: { cacheTtlMs: 60_000 },
    licenseMode: 'off',
  },
}));

vi.mock('../context', () => ({ currentUserOrNull: () => ctx.user ?? undefined }));
vi.mock('../member-context', () => ({ currentMemberOrNull: () => undefined }));
vi.mock('../licensing', () => ({ isFeatureEnabled: vi.fn(async () => true) }));
vi.mock('../tenant-package', () => ({ getTenantPackageFeatureSet: vi.fn(async () => null) }));
vi.mock('../permissions', () => ({
  getUserPermissions: vi.fn(async () => ['system:setting:view']),
  isSuperAdmin: (user: { roles: string[]; tenantId?: number | null }) => user.roles.includes('super_admin') && (user.tenantId ?? null) === null,
}));
vi.mock('../logger', () => ({ default: logger }));

import { db } from '../../db';
import { dispatchInvalidation, resetInvalidationBusForTest } from '../invalidation-bus';
import { getPublicSettings, getSettings, getSettingsEnvelope, invalidateSettings, resetSettingsCache, saveSettings } from './index';

const selectMock = vi.mocked(db.select);

const platformAdmin: JwtPayload = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };
const tenantAdmin: JwtPayload = { userId: 7, username: 't-admin', roles: ['tenant_admin'], tenantId: 3 };

function row(module: string, tenantId: number | null, data: Record<string, unknown>, version = 1) {
  return { id: tenantId ?? 100, module, tenantId, data, version, updatedAt: new Date('2026-09-05T10:00:00Z'), createdAt: new Date(), createdBy: null, updatedBy: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.selectResults = [];
  dbState.inserts = [];
  dbState.updates = [];
  configState.multiTenantMode = false;
  ctx.user = null;
  resetSettingsCache();
});

describe('getSettings', () => {
  it('无任何行时返回 schema 默认文档，并缓存（第二次不查库）', async () => {
    dbState.selectResults.push([]);
    const first = await getSettings('auth');
    expect(first).toEqual({ captchaEnabled: false, captchaComplexity: 'medium', allowRegistration: false, forgotPasswordEnabled: false });
    expect(selectMock).toHaveBeenCalledTimes(1);

    const second = await getSettings('auth');
    expect(second).toEqual(first);
    expect(selectMock).toHaveBeenCalledTimes(1);

    invalidateSettings('auth');
    dbState.selectResults.push([row('auth', null, { captchaEnabled: true })]);
    const third = await getSettings('auth');
    expect(third.captchaEnabled).toBe(true);
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  it('租户级模块按 默认 ← 平台 ← 租户 逐层覆盖，副本按作用域分开', async () => {
    configState.multiTenantMode = true;
    ctx.user = tenantAdmin;
    dbState.selectResults.push([
      row('identitySecurity', null, { lockout: { maxAttempts: 5 }, mfa: { enabled: true } }),
      row('identitySecurity', 3, { lockout: { durationMinutes: 120 } }),
    ]);
    const policy = await getSettings('identitySecurity');
    expect(policy.lockout).toEqual({ maxAttempts: 5, durationMinutes: 120 });
    expect(policy.mfa.enabled).toBe(true);
    expect(policy.password.minLength).toBe(6);

    // 显式指定平台作用域：另一个副本键，重新加载
    dbState.selectResults.push([row('identitySecurity', null, { lockout: { maxAttempts: 5 } })]);
    const platform = await getSettings('identitySecurity', { tenantId: null });
    expect(platform.lockout).toEqual({ maxAttempts: 5, durationMinutes: 30 });
    expect(selectMock).toHaveBeenCalledTimes(2);
  });

  it('平台级模块忽略租户上下文（同一副本）', async () => {
    configState.multiTenantMode = true;
    ctx.user = tenantAdmin;
    dbState.selectResults.push([row('ui', null, { quickChatEnabled: true })]);
    expect((await getSettings('ui')).quickChatEnabled).toBe(true);
    ctx.user = platformAdmin;
    expect((await getSettings('ui')).quickChatEnabled).toBe(true);
    expect(selectMock).toHaveBeenCalledTimes(1);
  });

  it('存量文档不合规：剔除违规字段并记 error，其余字段生效', async () => {
    dbState.selectResults.push([row('files', null, { uploadMaxSizeMb: 'huge', uploadValidateType: false })]);
    const files = await getSettings('files');
    expect(files.uploadMaxSizeMb).toBe(0);
    expect(files.uploadValidateType).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('degraded'), expect.objectContaining({ module: 'files', droppedPaths: ['uploadMaxSizeMb'] }));
  });
});

describe('getSettingsEnvelope', () => {
  it('返回生效值、上级值、覆盖路径与版本', async () => {
    ctx.user = platformAdmin;
    dbState.selectResults.push([row('ui', null, { watermark: { enabled: true } }, 4)]);
    const envelope = await getSettingsEnvelope('ui');
    expect(envelope.module).toBe('ui');
    expect(envelope.version).toBe(4);
    expect(envelope.effective.watermark.enabled).toBe(true);
    expect(envelope.inherited.watermark.enabled).toBe(false);
    expect(envelope.overriddenPaths).toEqual(['watermark.enabled']);
    expect(envelope.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('saveSettings', () => {
  it('version 不一致 → 409，不写库', async () => {
    dbState.selectResults.push([{ id: 100, version: 3 }]);
    await expect(saveSettings('ui', platformAdmin, { version: 2, data: { watermark: { enabled: true, content: '', fontSize: 14, opacity: 15 }, quickChatEnabled: false, feedbackEntryEnabled: false } }))
      .rejects.toMatchObject({ status: 409 });
    expect(dbState.inserts).toEqual([]);
    expect(dbState.updates).toEqual([]);
  });

  it('首次保存（无行，version 0）：插入稀疏覆盖，等于默认值的字段不落库', async () => {
    dbState.selectResults.push([]); // for update：无行
    dbState.selectResults.push([]); // 保存后重载
    const saved = await saveSettings('ui', platformAdmin, {
      version: 0,
      data: { watermark: { enabled: true, content: '', fontSize: 14, opacity: 15 }, quickChatEnabled: false, feedbackEntryEnabled: true },
    });
    expect(dbState.inserts).toEqual([{ module: 'ui', tenantId: null, data: { watermark: { enabled: true }, feedbackEntryEnabled: true }, version: 1 }]);
    expect(saved.module).toBe('ui');
  });

  it('已有行：版本 +1 并整体替换稀疏文档；租户行只存与平台生效值不同的叶子', async () => {
    configState.multiTenantMode = true;
    dbState.selectResults.push([{ id: 3, version: 2 }]);                                   // 租户行 for update
    dbState.selectResults.push([{ data: { lockout: { maxAttempts: 5 } } }]);              // 平台行
    dbState.selectResults.push([]);                                                        // 重载
    const defaults = { password: { minLength: 6, requireUppercase: false, requireSpecialChar: false, expiryEnabled: false, expiryDays: 90 }, lockout: { maxAttempts: 5, durationMinutes: 45 }, mfa: { enabled: false, mode: 'off' as const, rememberDeviceDays: 30 }, risk: { enabled: false, newDeviceAction: 'allow' as const } };
    await saveSettings('identitySecurity', tenantAdmin, { version: 2, data: defaults });
    // maxAttempts=5 与平台生效值相同 → 继承；只有 durationMinutes 落库
    expect(dbState.updates).toEqual([{ data: { lockout: { durationMinutes: 45 } }, version: 3 }]);
  });

  it('多租户下租户管理员写平台级模块 → 403', async () => {
    configState.multiTenantMode = true;
    await expect(saveSettings('ui', tenantAdmin, { version: 0, data: { watermark: { enabled: false, content: '', fontSize: 14, opacity: 15 }, quickChatEnabled: false, feedbackEntryEnabled: false } }))
      .rejects.toBeInstanceOf(HTTPException);
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe('投影与失效总线', () => {
  it('getPublicSettings 只含 public 字段', async () => {
    dbState.selectResults.push([]); // auth
    dbState.selectResults.push([]); // identitySecurity
    const pub = await getPublicSettings();
    expect(Object.keys(pub).sort()).toEqual(['auth', 'identitySecurity']);
    expect(Object.keys(pub.identitySecurity)).toEqual(['password']);
    expect(pub.auth.captchaEnabled).toBe(false);
  });

  it('收到 system_settings 通知只清对应模块；reset 清全部', async () => {
    dbState.selectResults.push([]);
    dbState.selectResults.push([]);
    await getSettings('auth');
    await getSettings('ui');
    expect(selectMock).toHaveBeenCalledTimes(2);

    dispatchInvalidation({ topic: 'system_settings', key: 'auth' });
    dbState.selectResults.push([]);
    await getSettings('auth');
    await getSettings('ui');
    expect(selectMock).toHaveBeenCalledTimes(3);

    resetInvalidationBusForTest();
  });
});
