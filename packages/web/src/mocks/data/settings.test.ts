import { describe, expect, it } from 'vitest';
import { SETTINGS_MODULES } from '@zenith/shared/settings';
import { MockHttpError } from '@/mocks/utils/contract';
import {
  mockSettingsEnvelope, mockSettingsRevision, mockSettingsRevisions, previewMockSettingsRestore, putMockSettings,
} from './settings';

function statusOf(run: () => unknown): number {
  try { run(); } catch (error) {
    if (error instanceof MockHttpError) return error.response.status;
    throw error;
  }
  throw new Error('Expected a failed settings operation');
}

describe('Demo settings immutable revisions', () => {
  it('IP policy rejects empty whitelist and self-lockout without changing history', () => {
    const before = mockSettingsEnvelope('ipAccess');
    for (const overrides of [{ whitelistEnabled: true, whitelist: [] }, { blacklistEnabled: true, blacklist: ['192.0.2.0/24'] }]) {
      expect(statusOf(() => putMockSettings('ipAccess', { baseToken: before.baseToken, overrides }))).toBe(400);
    }
    expect(mockSettingsEnvelope('ipAccess')).toEqual(before);
  });
  it('同值显式覆盖创建版本，重复保存与只改说明不创建版本', () => {
    const before = mockSettingsEnvelope('auth');
    const overrides = { captchaEnabled: before.inherited.captchaEnabled };
    const saved = putMockSettings('auth', { baseToken: before.baseToken, overrides, note: '保持本层配置' });
    expect(saved.version).toBe(before.version + 1);
    expect(saved.overrides).toEqual(overrides);
    expect(saved.overriddenPaths).toContain('captchaEnabled');
    const noChange = putMockSettings('auth', { baseToken: saved.baseToken, overrides, note: '只改说明' });
    expect(noChange.version).toBe(saved.version);
    expect(mockSettingsRevision('auth', saved.version).note).toBe('保持本层配置');
  });

  it('同一并发基线只允许一次有效写入，冲突不会新增版本', () => {
    const before = mockSettingsEnvelope('rules');
    const saved = putMockSettings('rules', { baseToken: before.baseToken, overrides: { publishApproval: true } });
    expect(statusOf(() => putMockSettings('rules', { baseToken: before.baseToken, overrides: { publishApproval: false } }))).toBe(409);
    expect(mockSettingsRevisions('rules')).toHaveLength(1);
    expect(mockSettingsEnvelope('rules')).toEqual(saved);
  });

  it('校验失败不改变当前指针或历史记录', () => {
    const before = mockSettingsEnvelope('files');
    expect(statusOf(() => putMockSettings('files', { baseToken: before.baseToken, overrides: { allowedMimeTypes: [42] } }))).toBe(400);
    expect(mockSettingsEnvelope('files')).toEqual(before);
    expect(mockSettingsRevisions('files')).toEqual([]);
  });

  it('返回的历史快照不可用于修改已保存正文，恢复产生新版本并保留来源', () => {
    const before = mockSettingsEnvelope('identitySecurity');
    const first = putMockSettings('identitySecurity', { baseToken: before.baseToken, overrides: { password: { minLength: 8 } } });
    const snapshot = mockSettingsRevision('identitySecurity', first.version);
    (snapshot.overrides.password as { minLength: number }).minLength = 64;
    const second = putMockSettings('identitySecurity', { baseToken: first.baseToken, overrides: { password: { minLength: 12 } } });
    const preview = previewMockSettingsRestore('identitySecurity', first.version, second.baseToken);
    expect((preview.restored.password as { minLength: number }).minLength).toBe(8);
    const restored = putMockSettings('identitySecurity', { baseToken: preview.baseToken, overrides: {}, note: '恢复较低阈值' }, first.version);
    expect(restored.version).toBe(second.version + 1);
    expect(restored.effective.password.minLength).toBe(8);
    expect(mockSettingsRevision('identitySecurity', restored.version)).toMatchObject({ action: 'restore', restoredFromVersion: first.version });
  });

  it('恢复v0移除全部覆盖，使用当前默认值；v0没有创建时间', () => {
    const before = mockSettingsEnvelope('member');
    const field = Object.keys(SETTINGS_MODULES.member.schema.shape)[0];
    const saved = putMockSettings('member', { baseToken: before.baseToken, overrides: { [field]: 123 } });
    const preview = previewMockSettingsRestore('member', 0, saved.baseToken);
    expect(preview.restored).toEqual(saved.inherited);
    const restored = putMockSettings('member', { baseToken: preview.baseToken, overrides: {}, note: '恢复继承' }, 0);
    expect(restored.overrides).toEqual({});
    expect(restored.effective).toEqual(restored.inherited);
    expect(mockSettingsRevision('member', 0).createdAt).toBeNull();
    expect(mockSettingsRevision('member', restored.version).restoredFromVersion).toBe(0);
  });
});
