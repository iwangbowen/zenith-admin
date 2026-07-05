/**
 * AES-256-GCM 密钥加解密工具单测（secret-crypto，密钥派生自 config.jwtSecret）。
 *
 * 覆盖：加解密闭环、随机 IV（同明文密文不同）、GCM 认证标签防篡改、Unicode/空串边界。
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../config', () => ({
  config: {
    jwtSecret: 'unit-test-only-fake-secret-do-not-use-in-production',
  },
}));

import { encryptSecret, decryptSecret } from './secret-crypto';

describe('encryptSecret / decryptSecret', () => {
  it('加解密闭环：明文完整还原', () => {
    const plain = 'sk-super-secret-api-key-12345';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it('随机 IV：同一明文两次加密产生不同密文，但均可解密', () => {
    const plain = 'same-input';
    const c1 = encryptSecret(plain);
    const c2 = encryptSecret(plain);
    expect(c1).not.toBe(c2);
    expect(decryptSecret(c1)).toBe(plain);
    expect(decryptSecret(c2)).toBe(plain);
  });

  it('Unicode 明文（中文/emoji）完整还原', () => {
    const plain = '支付密钥🔑-测试';
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it('空字符串可加解密', () => {
    expect(decryptSecret(encryptSecret(''))).toBe('');
  });

  it('密文输出为 base64url（可安全入库/进 URL）', () => {
    expect(encryptSecret('x')).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('篡改密文任意字节 → GCM 认证失败抛错（防密文篡改）', () => {
    const payload = encryptSecret('sensitive');
    const raw = Buffer.from(payload, 'base64url');
    raw[raw.length - 1] ^= 0xff; // 翻转密文末字节
    const tampered = raw.toString('base64url');
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('篡改认证标签 → 解密抛错', () => {
    const payload = encryptSecret('sensitive');
    const raw = Buffer.from(payload, 'base64url');
    raw[12] ^= 0x01; // IV(12B) 之后是 TAG(16B)
    expect(() => decryptSecret(raw.toString('base64url'))).toThrow();
  });

  it('非法 payload → 抛错而非返回垃圾明文', () => {
    expect(() => decryptSecret('not-valid-payload')).toThrow();
  });
});
