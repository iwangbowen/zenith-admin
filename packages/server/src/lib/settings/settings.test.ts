/**
 * 运行时设置读取 / 写入层单测。
 *
 * 覆盖要点：
 *  1. 无任何行 → schema 默认文档；命中副本后不再查库；invalidateSettings 后重新加载
 *  2. 租户级模块：默认 ← 平台行 ← 租户行 逐层覆盖；平台级模块忽略租户上下文
 *  3. 存量文档不合规 → 剔除违规字段、记 error 日志，而不是抛错
 *  4. saveSettings：生效指纹不一致 → 409；显式覆盖与版本原子落库；保存后副本失效
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
    selectResults: [] as Array<unknown[] | Promise<unknown[]>>,
    inserts: [] as Record<string, unknown>[],
    insertResults: [] as unknown[][],
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
      leftJoin: () => p,
      returning: () => p,
      where: () => p,
      for: () => p,
      limit: () => p,
      set: (v: Record<string, unknown>) => { dbState.updates.push(v); return p; },
      values: (v: Record<string, unknown>) => { dbState.inserts.push(v); return p; },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
        const result = kind === 'select' ? (dbState.selectResults.shift() ?? []) : kind === 'insert' ? (dbState.insertResults.shift() ?? []) : [];
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return p;
  }
  const db = {
    execute: vi.fn(async () => []),
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

vi.mock('../context', () => ({ currentUserOrNull: () => ctx.user ?? undefined, setAuditBefore: vi.fn(), setAuditAfter: vi.fn() }));
vi.mock('../member-context', () => ({ currentMemberOrNull: () => undefined }));
vi.mock('../licensing', () => ({ isFeatureEnabled: vi.fn(async () => true) }));
vi.mock('../tenant-package', () => ({ getTenantPackageFeatureSet: vi.fn(async () => null) }));
vi.mock('../permissions', () => ({
  getUserPermissions: vi.fn(async () => ['system:setting:view']),
  isSuperAdmin: (user: { roles: string[]; tenantId?: number | null }) => user.roles.includes('super_admin') && (user.tenantId ?? null) === null,
}));
vi.mock('../logger', () => ({ default: logger }));
vi.mock('../ws-manager', () => ({ scheduleBroadcast: vi.fn(), onBroadcastMessage: vi.fn() }));

import { db } from '../../db';
import { dispatchInvalidation, resetInvalidationBusForTest } from '../invalidation-bus';
import { getPublicSettings, getSettings, getSettingsEnvelope, invalidateSettings, resetSettingsCache, saveSettings, restoreSettings, settingsReadScope } from './index';
import { scheduleBroadcast, onBroadcastMessage } from '../ws-manager';

const handleBroadcast = vi.mocked(onBroadcastMessage).mock.calls[0][0];

const selectMock = vi.mocked(db.select);

const platformAdmin: JwtPayload = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };
const tenantAdmin: JwtPayload = { userId: 7, username: 't-admin', roles: ['tenant_admin'], tenantId: 3 };

function row(module: string, tenantId: number | null, data: Record<string, unknown>, version = 1) {
  return { id: tenantId ?? 100, module, tenantId, data, version, currentRevisionId: (tenantId ?? 100) + version * 1000, updatedAt: new Date('2026-09-05T10:00:00Z'), createdAt: new Date(), createdBy: null, updatedBy: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.selectResults = [];
  dbState.inserts = [];
  dbState.insertResults = [];
  dbState.updates = [];
  configState.multiTenantMode = false;
  ctx.user = null;
  resetSettingsCache();
});

describe('getSettings', () => {
  it('失效前的在途加载完成后不会重新污染新副本', async () => {
    let finishOld!: (rows: unknown[]) => void;
    const delayed = new Promise<unknown[]>((resolve) => { finishOld = resolve; });
    dbState.selectResults.push(delayed);
    const oldRead = getSettings('auth');
    await vi.waitFor(() => expect(selectMock).toHaveBeenCalledTimes(1));
    invalidateSettings('auth');
    dbState.selectResults.push([row('auth', null, { captchaEnabled: true }, 2)]);
    expect((await getSettings('auth')).captchaEnabled).toBe(true);
    finishOld([row('auth', null, { captchaEnabled: false }, 1)]);
    await oldRead;
    expect((await getSettings('auth')).captchaEnabled).toBe(true);
    expect(selectMock).toHaveBeenCalledTimes(2);
  });
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
      row('identitySecurity', null, { loginChallenge: { maxAttemptsPerSource: 5 }, mfa: { enabled: true } }),
      row('identitySecurity', 3, { loginChallenge: { windowMinutes: 120 } }),
    ]);
    const policy = await getSettings('identitySecurity');
    expect(policy.loginChallenge).toEqual({
      maxAttemptsPerSource: 5,
      sourceLimit: 5,
      windowMinutes: 120,
      alert: { enabled: true, sourceThreshold: 3, failureThreshold: 60 },
    });
    expect(policy.mfa.enabled).toBe(true);
    expect(policy.password.minLength).toBe(6);

    // 显式指定平台作用域：另一个副本键，重新加载
    dbState.selectResults.push([row('identitySecurity', null, { loginChallenge: { maxAttemptsPerSource: 5 } })]);
    const platform = await getSettings('identitySecurity', { tenantId: null });
    expect(platform.loginChallenge).toEqual({
      maxAttemptsPerSource: 5,
      sourceLimit: 5,
      windowMinutes: 30,
      alert: { enabled: true, sourceThreshold: 3, failureThreshold: 60 },
    });
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
  it('rejects tenant reads of the platform IP policy, including history scope', () => {
    configState.multiTenantMode = true;
    expect(() => settingsReadScope('ipAccess', tenantAdmin)).toThrow(/平台管理员/);
  });
  it('does not use disabled defaults when stored IP policy is invalid', async () => {
    dbState.selectResults.push([row('ipAccess', null, { blacklistEnabled: true, blacklist: [':::'] })]);
    await expect(getSettings('ipAccess')).rejects.toMatchObject({ status: 503 });
  });
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
  it.each(['save', 'restore'] as const)('cannot bypass source safety through %s', async (operation) => {
    const current = row('ipAccess', null, {});
    dbState.selectResults.push([current]);
    const before = await getSettingsEnvelope('ipAccess');
    dbState.selectResults.push([current], [{ id: 100 }]);
    if (operation === 'restore') dbState.selectResults.push([{ overrides: { blacklistEnabled: true } }]);
    const attempt = operation === 'save'
      ? saveSettings('ipAccess', platformAdmin, { baseToken: before.baseToken, overrides: { blacklistEnabled: true } })
      : restoreSettings('ipAccess', platformAdmin, 1, { baseToken: before.baseToken, note: '恢复测试' });
    await expect(attempt).rejects.toMatchObject({ status: 400 });
    expect(dbState.inserts).toEqual([]);
    expect(dbState.updates).toEqual([]);
  });
  it('本层或继承来源的指纹不一致 → 409，不写库', async () => {
    dbState.selectResults.push([]);
    await expect(saveSettings('ui', platformAdmin, { baseToken: 'stale', overrides: {} }))
      .rejects.toMatchObject({ status: 409 });
    expect(dbState.inserts).toEqual([]);
    expect(dbState.updates).toEqual([]);
    expect(scheduleBroadcast).not.toHaveBeenCalled();
  });

  it('首次保存也保留等于默认值的显式覆盖，正文只写版本表', async () => {
    dbState.selectResults.push([]);
    const before = await getSettingsEnvelope('ui');
    const overrides = { watermark: { enabled: false } };
    dbState.selectResults.push([], [], [row('ui', null, overrides, 1)]);
    dbState.insertResults.push([{ id: 100 }], [{ id: 1100 }]);
    const saved = await saveSettings('ui', platformAdmin, { baseToken: before.baseToken, overrides, note: '明确关闭' });
    expect(dbState.inserts[0]).toEqual({ module: 'ui', tenantId: null });
    expect(dbState.inserts[1]).toMatchObject({ settingsId: 100, version: 1, overrides, action: 'save', note: '明确关闭' });
    expect(dbState.updates).toEqual([{ currentRevisionId: 1100 }]);
    expect(saved.overrides).toEqual(overrides);
    expect(saved.baseToken).not.toBe(before.baseToken);
    expect(scheduleBroadcast).toHaveBeenCalledWith({ type: 'preferences:policy-updated', payload: { version: 1 } });
  });

  it('租户只替换自身覆盖，等于平台的值仍是显式覆盖', async () => {
    configState.multiTenantMode = true;
    ctx.user = tenantAdmin;
    const platform = row('identitySecurity', null, { loginChallenge: { maxAttemptsPerSource: 5 } });
    const tenant = row('identitySecurity', 3, { loginChallenge: { windowMinutes: 120 } }, 2);
    dbState.selectResults.push([platform, tenant]);
    const before = await getSettingsEnvelope('identitySecurity');
    const overrides = { loginChallenge: { maxAttemptsPerSource: 5, windowMinutes: 45 } };
    dbState.selectResults.push([platform, tenant], [{ id: 3 }], [platform, row('identitySecurity', 3, overrides, 3)]);
    dbState.insertResults.push([{ id: 3003 }]);
    const saved = await saveSettings('identitySecurity', tenantAdmin, { baseToken: before.baseToken, overrides });
    expect(dbState.inserts[0]).toMatchObject({ settingsId: 3, version: 3, overrides, inheritedVersion: 1 });
    expect(saved.overriddenPaths).toContain('loginChallenge.maxAttemptsPerSource');
  });

  it('内容与覆盖关系都未变化时不创建版本或广播', async () => {
    const current = row('ui', null, { watermark: { enabled: false } }, 2);
    dbState.selectResults.push([current]);
    const before = await getSettingsEnvelope('ui');
    dbState.selectResults.push([current], [{ id: 100 }]);
    const saved = await saveSettings('ui', platformAdmin, { baseToken: before.baseToken, overrides: before.overrides });
    expect(saved.version).toBe(2);
    expect(dbState.inserts).toEqual([]);
    expect(dbState.updates).toEqual([]);
    expect(scheduleBroadcast).not.toHaveBeenCalled();
  });

  it('平台变化即使租户自身版本不变也拒绝旧表单', async () => {
    configState.multiTenantMode = true;
    ctx.user = tenantAdmin;
    const tenant = row('identitySecurity', 3, {}, 2);
    dbState.selectResults.push([row('identitySecurity', null, {}, 1), tenant]);
    const before = await getSettingsEnvelope('identitySecurity');
    dbState.selectResults.push([row('identitySecurity', null, { mfa: { enabled: true } }, 2), tenant]);
    await expect(saveSettings('identitySecurity', tenantAdmin, { baseToken: before.baseToken, overrides: {} })).rejects.toMatchObject({ status: 409 });
    expect(dbState.inserts).toEqual([]);
  });

  it('多租户下租户管理员写平台级模块 → 403', async () => {
    configState.multiTenantMode = true;
    await expect(saveSettings('ui', tenantAdmin, { baseToken: 'unused', overrides: {} }))
      .rejects.toBeInstanceOf(HTTPException);
    expect(selectMock).not.toHaveBeenCalled();
  });
});

describe('投影与失效总线', () => {
  it('收到策略广播即清掉 ui 副本，无需等待数据库失效通知', async () => {
    dbState.selectResults.push([]);
    await getSettings('ui');
    handleBroadcast({ type: 'preferences:policy-updated', payload: { version: 2 } });
    dbState.selectResults.push([row('ui', null, { preferences: { defaults: { colorMode: 'dark' } } }, 2)]);
    expect((await getSettings('ui')).preferences.defaults.colorMode).toBe('dark');
    expect(selectMock).toHaveBeenCalledTimes(2);
  });
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
