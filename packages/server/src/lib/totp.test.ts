/**
 * TOTP 双因素认证单测（RFC 6238 / RFC 4226 标准测试向量）。
 *
 * 覆盖：
 *  1. verifyTotp 与 RFC 6238 SHA1 官方向量一致（secret ASCII "12345678901234567890"，6 位截断）
 *  2. 时间窗口容差（window=±1 步长，默认 30s）
 *  3. 输入规整：空白剥离、非 6 位数字拒绝
 *  4. generateTotpSecret：合法 base32 字母表、长度换算
 *  5. buildTotpUri：otpauth:// URI 结构与参数
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { generateTotpSecret, buildTotpUri, verifyTotp } from './totp';

// RFC 6238 测试密钥 "12345678901234567890"（ASCII）的 base32 编码
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

function atTime(unixSeconds: number) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(unixSeconds * 1000));
}

afterEach(() => {
  vi.useRealTimers();
});

describe('verifyTotp - RFC 6238 标准向量', () => {
  // 官方 8 位向量取后 6 位（本实现 DIGITS=6）
  const vectors: Array<[number, string]> = [
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ];

  for (const [t, code] of vectors) {
    it(`T=${t} → ${code} 校验通过`, () => {
      atTime(t);
      expect(verifyTotp(code, RFC_SECRET, 0)).toBe(true);
    });
  }

  it('错误验证码校验失败', () => {
    atTime(59);
    expect(verifyTotp('000000', RFC_SECRET, 0)).toBe(false);
  });
});

describe('verifyTotp - 时间窗口', () => {
  // T=59 时 counter=1；counter 0/1/2 对应 755224 / 287082 / 359152，counter 3 为 969429
  it('window=1 接受上一步长（时钟慢 30s 的客户端）', () => {
    atTime(59);
    expect(verifyTotp('755224', RFC_SECRET, 1)).toBe(true);
  });

  it('window=1 接受下一步长（时钟快 30s 的客户端）', () => {
    atTime(59);
    expect(verifyTotp('359152', RFC_SECRET, 1)).toBe(true);
  });

  it('window=1 拒绝偏移 2 个步长的验证码（防重放范围收敛）', () => {
    atTime(59);
    expect(verifyTotp('969429', RFC_SECRET, 1)).toBe(false);
  });

  it('window=0 仅接受当前步长', () => {
    atTime(59);
    expect(verifyTotp('287082', RFC_SECRET, 0)).toBe(true);
    expect(verifyTotp('755224', RFC_SECRET, 0)).toBe(false);
    expect(verifyTotp('359152', RFC_SECRET, 0)).toBe(false);
  });
});

describe('verifyTotp - 输入规整与格式校验', () => {
  it('剥离空白后校验（"287 082" → 287082）', () => {
    atTime(59);
    expect(verifyTotp('287 082', RFC_SECRET, 0)).toBe(true);
  });

  it.each(['', '12345', '1234567', 'abcdef', '28708a'])('非 6 位纯数字 %j → false', (bad) => {
    atTime(59);
    expect(verifyTotp(bad, RFC_SECRET, 0)).toBe(false);
  });
});

describe('generateTotpSecret', () => {
  it('默认 20 字节 → 32 个 base32 字符', () => {
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(32);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  it('每次生成的 secret 不同', () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });

  it('生成的 secret 可直接用于校验（自洽闭环）', () => {
    // 用生成的 secret 验证一个必然错误的 code 不抛异常（base32 可解码）
    const secret = generateTotpSecret();
    expect(() => verifyTotp('123456', secret, 0)).not.toThrow();
  });
});

describe('buildTotpUri', () => {
  it('生成标准 otpauth:// URI', () => {
    const uri = buildTotpUri({ issuer: 'Zenith', accountName: 'alice', secret: RFC_SECRET });
    expect(uri.startsWith('otpauth://totp/Zenith%3Aalice?')).toBe(true);
    const params = new URLSearchParams(uri.split('?')[1]);
    expect(params.get('secret')).toBe(RFC_SECRET);
    expect(params.get('issuer')).toBe('Zenith');
    expect(params.get('algorithm')).toBe('SHA1');
    expect(params.get('digits')).toBe('6');
    expect(params.get('period')).toBe('30');
  });

  it('label 中的特殊字符被 URI 编码', () => {
    const uri = buildTotpUri({ issuer: 'My App', accountName: 'a@b.com', secret: RFC_SECRET });
    expect(uri).toContain(encodeURIComponent('My App:a@b.com'));
  });
});
