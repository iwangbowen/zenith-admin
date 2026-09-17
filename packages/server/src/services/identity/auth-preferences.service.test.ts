import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultPreferencePolicy, type PreferencePolicy } from '@zenith/shared/preferences';
import { userPreferencesInputSchema } from '@zenith/shared/identity';

const state = vi.hoisted(() => ({
  stored: null as unknown,
  written: null as unknown,
  insideTransaction: false,
  getSettings: vi.fn(),
}));

vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 7, tenantId: 3 }) }));
vi.mock('../../lib/settings', () => ({ getSettings: state.getSettings }));
vi.mock('../../db', () => {
  const db = {
    select: vi.fn(() => {
      const result = () => Promise.resolve([{ preferences: state.stored }]);
      const chain = { from: () => chain, where: () => chain, limit: result, for: result };
      return chain;
    }),
    update: vi.fn(() => ({ set: (value: { preferences: unknown }) => ({ where: async () => { state.written = value.preferences; } }) })),
    transaction: vi.fn(async (callback: (tx: unknown) => unknown) => {
      state.insideTransaction = true;
      try { return await callback(db); } finally { state.insideTransaction = false; }
    }),
  };
  return { db };
});

import { getMyPreferences, saveMyPreferences } from './auth-preferences.service';

let policy: PreferencePolicy;

beforeEach(() => {
  vi.clearAllMocks();
  state.stored = null;
  state.written = null;
  state.insideTransaction = false;
  policy = structuredClone(defaultPreferencePolicy);
  state.getSettings.mockImplementation(async () => {
    expect(state.insideTransaction).toBe(false);
    return { preferences: policy };
  });
});

describe('个人偏好覆盖', () => {
  it('空数据与旧快照均返回空覆盖，不把旧默认值当成个人选择', async () => {
    expect(await getMyPreferences()).toEqual({ overrides: {} });
    state.stored = { colorMode: 'dark', enableTabs: false };
    expect(await getMyPreferences()).toEqual({ overrides: {} });
  });

  it('读取保留显式选择，即使值正好等于系统默认值', async () => {
    state.stored = { overrides: { colorMode: defaultPreferencePolicy.defaults.colorMode } };
    expect(await getMyPreferences()).toEqual(state.stored);
  });

  it('整体替换只保存稀疏覆盖，不填充任何默认值', async () => {
    state.stored = { overrides: { enableTabs: false, tablePageSize: 20 } };
    const document = { overrides: { colorMode: 'light' as const } };
    expect(await saveMyPreferences(document)).toEqual(document);
    expect(state.written).toEqual(document);
    expect(state.getSettings).toHaveBeenCalledWith('ui');
  });

  it('锁定后拒绝旧客户端新建覆盖，即便提交值等于系统值', async () => {
    policy.allowUserOverride.colorMode = false;
    await expect(saveMyPreferences({ overrides: { colorMode: policy.defaults.colorMode } })).rejects.toMatchObject({ status: 403 });
    expect(state.written).toBeNull();
  });

  it('按终端叶子执行锁定，不能用嵌套对象绕过', async () => {
    policy.allowUserOverride.terminal.fontSize = false;
    state.stored = { overrides: { terminal: { fontSize: 16 } } };
    await expect(saveMyPreferences({ overrides: { terminal: { fontSize: 18, cursorBlink: false } } })).rejects.toMatchObject({ status: 403 });
    expect(state.written).toBeNull();
  });

  it('保留锁定前的覆盖不影响其他偏好保存；允许清除覆盖', async () => {
    policy.allowUserOverride.colorMode = false;
    state.stored = { overrides: { colorMode: 'dark' } };
    const retained = { overrides: { colorMode: 'dark' as const, enableTabs: false } };
    await saveMyPreferences(retained);
    expect(state.written).toEqual(retained);
    await saveMyPreferences({ overrides: {} });
    expect(state.written).toEqual({ overrides: {} });
  });

  it('终端收藏仍属于个人数据，不受偏好策略控制', async () => {
    policy.allowUserOverride.terminal.defaultShell = false;
    const document = { overrides: { terminal: { favorites: [{ path: '/work', name: '工作目录' }] } } };
    await saveMyPreferences(document);
    expect(state.written).toEqual(document);
  });
});

describe('个人偏好写入契约', () => {
  it('必须显式提交 overrides；严格拒绝未知字段、非法枚举和越界值', () => {
    for (const document of [
      {}, { colorMode: 'dark' }, { overrides: { mystery: true } },
      { overrides: { colorMode: 'invalid' } }, { overrides: { tablePageSize: -1 } },
      { overrides: { terminal: { fontSize: 1000 } } },
    ]) expect(userPreferencesInputSchema.safeParse(document).success).toBe(false);
    expect(userPreferencesInputSchema.parse({ overrides: {} })).toEqual({ overrides: {} });
  });
});
