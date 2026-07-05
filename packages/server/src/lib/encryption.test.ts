/**
 * 字段级 AES-256-GCM 加密工具单测（encryption，密钥来自 FIELD_ENCRYPTION_KEY 环境变量）。
 *
 * 覆盖：加解密闭环、null/undefined 透传、随机 IV、篡改返回 null（不抛错）、跨密钥解密失败。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { encryptField, decryptField } from './encryption';

beforeEach(() => {
  vi.stubEnv('FIELD_ENCRYPTION_KEY', 'unit-test-field-encryption-key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('encryptField / decryptField', () => {
  it('加解密闭环：明文完整还原', () => {
    const plain = 'ssh-password-P@ssw0rd!';
    expect(decryptField(encryptField(plain))).toBe(plain);
  });

  it('null / undefined 透传为 null（简化调用方空值处理）', () => {
    expect(encryptField(null)).toBeNull();
    expect(encryptField(undefined)).toBeNull();
    expect(decryptField(null)).toBeNull();
    expect(decryptField(undefined)).toBeNull();
  });

  it('随机 IV：同一明文两次加密产生不同密文', () => {
    expect(encryptField('same')).not.toBe(encryptField('same'));
  });

  it('多行 SSH 私钥（长文本 + 换行）完整还原', () => {
    const key = '-----BEGIN OPENSSH PRIVATE KEY-----\n' + 'A'.repeat(1600) + '\n-----END OPENSSH PRIVATE KEY-----';
    expect(decryptField(encryptField(key))).toBe(key);
  });

  it('Unicode 明文完整还原', () => {
    expect(decryptField(encryptField('密码🔐'))).toBe('密码🔐');
  });

  it('篡改密文 → 返回 null（防御式，不抛错中断主流程）', () => {
    const cipher = encryptField('secret')!;
    const raw = Buffer.from(cipher, 'base64');
    raw[raw.length - 1] ^= 0xff;
    expect(decryptField(raw.toString('base64'))).toBeNull();
  });

  it('非法 base64 输入 → 返回 null', () => {
    expect(decryptField('%%%not-base64%%%')).toBeNull();
    expect(decryptField('c2hvcnQ=')).toBeNull(); // 太短，无法拆出 IV+TAG
  });

  it('换密钥后旧密文解密失败（返回 null）', () => {
    const cipher = encryptField('secret')!;
    vi.stubEnv('FIELD_ENCRYPTION_KEY', 'another-key-entirely');
    expect(decryptField(cipher)).toBeNull();
  });

  it('未配置 FIELD_ENCRYPTION_KEY 时回退 JWT_SECRET 派生密钥仍可闭环', () => {
    vi.stubEnv('FIELD_ENCRYPTION_KEY', '');
    vi.unstubAllEnvs();
    vi.stubEnv('JWT_SECRET', 'fallback-jwt-secret');
    delete process.env.FIELD_ENCRYPTION_KEY;
    expect(decryptField(encryptField('fallback-roundtrip'))).toBe('fallback-roundtrip');
  });
});
