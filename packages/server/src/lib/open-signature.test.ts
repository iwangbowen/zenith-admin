/**
 * 开放平台 HMAC-SHA256 请求签名单测（API 认证安全关键，纯函数）。
 *
 * 覆盖：
 *  1. canonicalizeQuery：排序、? 前缀、空值、value 二级排序
 *  2. buildStringToSign：六段换行拼接、空 body 的 SHA256、method 大写化
 *  3. computeSignature / signRequest：与预计算向量一致、密钥/内容敏感性
 *  4. timingSafeEqualHex：相等/不等/长度不一致/空串
 */
import { describe, it, expect } from 'vitest';
import {
  canonicalizeQuery,
  buildStringToSign,
  computeSignature,
  signRequest,
  timingSafeEqualHex,
} from './open-signature';

// SHA256('') 公认常量
const EMPTY_BODY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

describe('canonicalizeQuery', () => {
  it('空值返回空串', () => {
    expect(canonicalizeQuery()).toBe('');
    expect(canonicalizeQuery(null)).toBe('');
    expect(canonicalizeQuery('')).toBe('');
    expect(canonicalizeQuery('?')).toBe('');
  });

  it('按 key 排序拼接', () => {
    expect(canonicalizeQuery('b=2&a=1&c=3')).toBe('a=1&b=2&c=3');
  });

  it('自动剥离 ? 前缀', () => {
    expect(canonicalizeQuery('?b=2&a=1')).toBe('a=1&b=2');
  });

  it('同 key 时按 value 二级排序（防参数重排绕过签名）', () => {
    expect(canonicalizeQuery('k=2&k=1')).toBe('k=1&k=2');
  });

  it('无 = 的 key 视为空 value', () => {
    expect(canonicalizeQuery('flag&a=1')).toBe('a=1&flag=');
  });

  it('value 中含 = 时仅按第一个 = 切分', () => {
    expect(canonicalizeQuery('token=a=b')).toBe('token=a=b');
  });

  it('过滤空段（连续 &）', () => {
    expect(canonicalizeQuery('a=1&&b=2')).toBe('a=1&b=2');
  });
});

describe('buildStringToSign', () => {
  it('六段按 METHOD/PATH/QUERY/TIMESTAMP/NONCE/BODY_HASH 换行拼接', () => {
    const sts = buildStringToSign({
      method: 'get',
      path: '/open/api/v1/users',
      query: 'b=2&a=1',
      timestamp: '1700000000',
      nonce: 'abc',
      body: null,
    });
    expect(sts).toBe(['GET', '/open/api/v1/users', 'a=1&b=2', '1700000000', 'abc', EMPTY_BODY_SHA256].join('\n'));
  });

  it('method 统一大写（防大小写绕过）', () => {
    const lower = buildStringToSign({ method: 'post', path: '/p', timestamp: '1', nonce: 'n' });
    const upper = buildStringToSign({ method: 'POST', path: '/p', timestamp: '1', nonce: 'n' });
    expect(lower).toBe(upper);
  });

  it('body 为空串与 undefined 等价（均取空串哈希）', () => {
    const a = buildStringToSign({ method: 'GET', path: '/p', timestamp: '1', nonce: 'n', body: '' });
    const b = buildStringToSign({ method: 'GET', path: '/p', timestamp: '1', nonce: 'n' });
    expect(a).toBe(b);
    expect(a.endsWith(EMPTY_BODY_SHA256)).toBe(true);
  });
});

describe('computeSignature / signRequest - 已知向量', () => {
  const parts = {
    method: 'POST',
    path: '/open/api/v1/orders',
    query: 'b=2&a=1',
    timestamp: '1700000000',
    nonce: 'nonce-123',
    body: '{"x":1}',
  };

  it('与预计算 HMAC-SHA256 向量一致', () => {
    const { signature, stringToSign } = signRequest('app-secret', parts);
    expect(signature).toBe('9c1f08a475cb8f3498bc9ae43266d311499f68e5ba83bdc373e432ff67d0aeae');
    expect(stringToSign.split('\n')[5]).toBe('5041bf1f713df204784353e82f6a4a535931cb64f1f4b4a5aeaffcb720918b22');
  });

  it('signRequest 与 buildStringToSign + computeSignature 等价', () => {
    const { signature, stringToSign } = signRequest('app-secret', parts);
    expect(stringToSign).toBe(buildStringToSign(parts));
    expect(signature).toBe(computeSignature('app-secret', stringToSign));
  });

  it('不同密钥产生不同签名', () => {
    expect(signRequest('secret-a', parts).signature).not.toBe(signRequest('secret-b', parts).signature);
  });

  it('任一签名要素变化（body / nonce / timestamp）签名随之变化', () => {
    const base = signRequest('app-secret', parts).signature;
    expect(signRequest('app-secret', { ...parts, body: '{"x":2}' }).signature).not.toBe(base);
    expect(signRequest('app-secret', { ...parts, nonce: 'nonce-124' }).signature).not.toBe(base);
    expect(signRequest('app-secret', { ...parts, timestamp: '1700000001' }).signature).not.toBe(base);
  });

  it('签名为 64 位 hex', () => {
    expect(signRequest('app-secret', parts).signature).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('timingSafeEqualHex', () => {
  it('相同字符串 → true', () => {
    expect(timingSafeEqualHex('abc123', 'abc123')).toBe(true);
  });

  it('不同内容（等长）→ false', () => {
    expect(timingSafeEqualHex('abc123', 'abc124')).toBe(false);
  });

  it('长度不一致 → false（不抛异常）', () => {
    expect(timingSafeEqualHex('abc', 'abcd')).toBe(false);
  });

  it('空串参与比较 → false', () => {
    expect(timingSafeEqualHex('', 'abc')).toBe(false);
    expect(timingSafeEqualHex('abc', '')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
  });
});
