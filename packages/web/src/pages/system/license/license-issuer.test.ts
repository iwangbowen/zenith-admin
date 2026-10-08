import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicKey, generateKeyPairSync, verify, webcrypto } from 'node:crypto';
import { licenseEnvelopeSchema, type LicensePayload } from '@zenith/shared/licensing';
import { signLicenseEnvelope } from './license-issuer';

// 仅测试：仓库已经公开的测试密钥对，不进入浏览器签发工具或页面代码。
const TEST_PRIVATE_KEY_BASE64 = 'MC4CAQAwBQYDK2VwBCIEIGyZp5WDE++d2SWo6Ns/202nKFvDAhjDQiRAzHItJW0L';
const TEST_PUBLIC_KEY_BASE64 = 'MCowBQYDK2VwAyEAbX6fWw/YVG60h7QeoV1qRZfOH0zvzVfP5AMgjrM5IK8=';
const publicKey = createPublicKey({ key: Buffer.from(TEST_PUBLIC_KEY_BASE64, 'base64'), format: 'der', type: 'spki' });
const payload: LicensePayload = {
  licenseId: 'license-browser-test',
  audience: 'zenith-admin',
  installationId: '76e2a289-c893-4b5e-9fc0-a1cb134934b2',
  customerId: 'customer-test',
  customerName: '中文客户 · 浏览器签发',
  edition: 'enterprise',
  features: ['growth', 'iot', 'workflow'],
  limits: { maxUsers: 100, maxTenants: null, maxNodes: 3 },
  issuedAt: '2026-10-08T00:00:00Z',
  notBefore: '2026-10-08T00:00:00Z',
  expiresAt: '2027-10-08T00:00:00Z',
  graceUntil: '2027-11-08T00:00:00Z',
  maintenanceUntil: null,
};
const signingKey = { keyId: 'test-2026', privateKey: TEST_PRIVATE_KEY_BASE64 };

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('isSecureContext', true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('浏览器本地 License 签发', () => {
  it('签署中文 UTF8 原始载荷，输出信封可由独立 Node Ed25519 公钥验签', async () => {
    const imported = vi.spyOn(webcrypto.subtle, 'importKey');
    const envelope = await signLicenseEnvelope(payload, signingKey);
    expect(licenseEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(envelope).toMatchObject({ version: 1, algorithm: 'Ed25519', keyId: 'test-2026' });
    expect(envelope.payload).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(envelope.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    const rawPayload = Buffer.from(envelope.payload, 'base64url');
    expect(JSON.parse(rawPayload.toString('utf8'))).toEqual(payload);
    expect(verify(null, rawPayload, publicKey, Buffer.from(envelope.signature, 'base64url'))).toBe(true);
    // 真实导入结果不可导出；不是另一个可持久化的私钥副本。
    const key = await imported.mock.results[0].value as CryptoKey;
    expect(key.extractable).toBe(false);
    await expect(webcrypto.subtle.exportKey('pkcs8', key as never)).rejects.toThrow();
  });

  it('支持 PRIVATE KEY PEM，未知密钥 ID 是合法标签，由部署公钥决定信任', async () => {
    const pem = `-----BEGIN PRIVATE KEY-----\n${TEST_PRIVATE_KEY_BASE64}\n-----END PRIVATE KEY-----`;
    const envelope = await signLicenseEnvelope(payload, { keyId: 'issuer-private-2027', privateKey: pem });
    expect(envelope.keyId).toBe('issuer-private-2027');
    expect(verify(null, Buffer.from(envelope.payload, 'base64url'), publicKey, Buffer.from(envelope.signature, 'base64url'))).toBe(true);
    for (const keyId of ['', 'x'.repeat(65)]) {
      await expect(signLicenseEnvelope(payload, { ...signingKey, keyId })).rejects.toThrow('密钥 ID');
    }
  });

  it('修改客户或功能字段后原签名失效', async () => {
    const envelope = await signLicenseEnvelope(payload, signingKey);
    for (const changed of [{ ...payload, customerName: '另一客户' }, { ...payload, features: ['ai'] }]) {
      expect(verify(null, Buffer.from(JSON.stringify(changed), 'utf8'), publicKey, Buffer.from(envelope.signature, 'base64url'))).toBe(false);
    }
  });

  it('拒绝不符合共享载荷 schema 的授权内容', async () => {
    await expect(signLicenseEnvelope({ ...payload, audience: 'other-product' as never }, signingKey)).rejects.toThrow('授权内容格式无效');
    await expect(signLicenseEnvelope({ ...payload, features: ['not-registered' as never] }, signingKey)).rejects.toThrow('授权内容格式无效');
    await expect(signLicenseEnvelope({ ...payload, expiresAt: '2027-10-08' }, signingKey)).rejects.toThrow('授权内容格式无效');
  });

  it.each(['', 'not-base64-private-secret!', 'AA=A', 'AAA', 'AB==', 'AAAA', '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----'])('损坏或错误的私钥输入返回可读错误且不泄露输入', async (privateKey) => {
    const error = await signLicenseEnvelope(payload, { ...signingKey, privateKey }).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('私钥无效：请提供未加密的 Ed25519 PKCS8 base64 或 PRIVATE KEY PEM。');
    if (privateKey) expect((error as Error).message).not.toContain(privateKey);
  });

  it('真实非 Ed25519 PKCS8 私钥被拒绝', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const base64 = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
    await expect(signLicenseEnvelope(payload, { ...signingKey, privateKey: base64 })).rejects.toThrow('Ed25519 PKCS8');
  });

  it('非安全上下文、缺少 SubtleCrypto 或浏览器不支持算法时给出可执行提示', async () => {
    vi.stubGlobal('isSecureContext', false);
    await expect(signLicenseEnvelope(payload, signingKey)).rejects.toThrow('HTTPS 或 localhost');
    vi.stubGlobal('isSecureContext', true);
    vi.stubGlobal('crypto', {});
    await expect(signLicenseEnvelope(payload, signingKey)).rejects.toThrow('Web Crypto');
    vi.stubGlobal('crypto', { subtle: { importKey: async () => { throw new DOMException(TEST_PRIVATE_KEY_BASE64, 'NotSupportedError'); }, sign: async () => {} } });
    const error = await signLicenseEnvelope(payload, signingKey).catch((value: unknown) => value);
    expect((error as Error).message).toContain('Ed25519');
    expect((error as Error).message).not.toContain(TEST_PRIVATE_KEY_BASE64);
  });

  it('成功与失败均不请求网络、存储私钥或写入日志', async () => {
    const forbidden = vi.fn(() => { throw new Error('unexpected external side effect'); });
    vi.stubGlobal('fetch', forbidden);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(forbidden);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(forbidden);
    vi.spyOn(console, 'log').mockImplementation(forbidden);
    vi.spyOn(console, 'warn').mockImplementation(forbidden);
    vi.spyOn(console, 'error').mockImplementation(forbidden);
    const envelope = await signLicenseEnvelope(payload, signingKey);
    expect(verify(null, Buffer.from(envelope.payload, 'base64url'), publicKey, Buffer.from(envelope.signature, 'base64url'))).toBe(true);
    await expect(signLicenseEnvelope(payload, { ...signingKey, privateKey: 'invalid-private-secret!' })).rejects.toThrow('私钥无效');
    expect(forbidden).not.toHaveBeenCalled();
    expect(JSON.stringify(envelope)).not.toContain(TEST_PRIVATE_KEY_BASE64);
  });
});
