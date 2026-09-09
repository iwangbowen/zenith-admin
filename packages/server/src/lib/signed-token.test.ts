import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { constantTimeEqual, createSignedTokenCodec, hmacSha256 } from './signed-token';

interface Payload { id: number; tag?: string }

describe('createSignedTokenCodec', () => {
  it('带版本段：<version>.<data>.<sig>，签名输入 <version>.<data>', () => {
    const codec = createSignedTokenCodec<Payload>({ version: 'v9' });
    const token = codec.encode({ id: 1, tag: 'a' });
    const data = Buffer.from(JSON.stringify({ id: 1, tag: 'a' })).toString('base64url');
    const sig = createHmac('sha256', config.jwtSecret).update(`v9.${data}`).digest('base64url');
    expect(token).toBe(`v9.${data}.${sig}`);
    expect(codec.decode(token)).toEqual({ id: 1, tag: 'a' });
    expect(codec.decode(`v8.${data}.${sig}`)).toBeNull();
    expect(codec.decode(`v9.${data}.${sig}.x`)).toBeNull();
    expect(codec.decode(`v9..${sig}`)).toBeNull();
    expect(codec.decode(`v9.${data}.`)).toBeNull();
    expect(codec.decode(`v9.${data}.${sig.slice(0, -1)}A`)).toBeNull();
  });

  it('无版本段：<data>.<sig>，签名输入 <purpose>:<data>', () => {
    const codec = createSignedTokenCodec<Payload>({ purpose: 'demo' });
    const token = codec.encode({ id: 2 });
    const data = Buffer.from(JSON.stringify({ id: 2 })).toString('base64url');
    const sig = createHmac('sha256', config.jwtSecret).update(`demo:${data}`).digest('base64url');
    expect(token).toBe(`${data}.${sig}`);
    expect(codec.decode(token)).toEqual({ id: 2 });
    expect(codec.decode(data)).toBeNull();
    expect(codec.decode(`.${sig}`)).toBeNull();
    expect(codec.decode(`${data}.${sig}x`)).toBeNull();
  });

  it('不同版本 / 用途的密钥域互不相通', () => {
    const a = createSignedTokenCodec<Payload>({ version: 'a1' });
    const b = createSignedTokenCodec<Payload>({ version: 'b1' });
    const bare = createSignedTokenCodec<Payload>({ purpose: 'a1' });
    const token = a.encode({ id: 3 });
    expect(b.decode(token)).toBeNull();
    expect(bare.decode(token.slice('a1.'.length))).toBeNull();
  });

  it('签名正确但 JSON 非法返回 null', () => {
    const codec = createSignedTokenCodec<Payload>({ version: 'v1' });
    const data = Buffer.from('{not json').toString('base64url');
    const sig = hmacSha256(`v1.${data}`);
    expect(codec.decode(`v1.${data}.${sig}`)).toBeNull();
  });
});

describe('constantTimeEqual / hmacSha256', () => {
  it('长度不同直接判否，不抛错', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('', '')).toBe(true);
  });

  it('hex / base64url 摘要与 node:crypto 一致', () => {
    expect(hmacSha256('x', 'hex')).toBe(createHmac('sha256', config.jwtSecret).update('x').digest('hex'));
    expect(hmacSha256('x')).toBe(createHmac('sha256', config.jwtSecret).update('x').digest('base64url'));
    expect(hmacSha256('x', 'hex', 'other')).toBe(createHmac('sha256', 'other').update('x').digest('hex'));
  });
});
