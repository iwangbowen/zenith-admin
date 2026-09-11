/**
 * 支付签名/加密底层原语单测（packages/server/src/lib/payment/signing.ts）。
 *
 * 所有测试均使用纯 Node crypto，无外部依赖、无 DB 连接。
 */
import { describe, it, expect } from 'vitest';
import { createCipheriv, generateKeyPairSync } from 'node:crypto';
import { rsaSign, rsaVerify, aesGcmDecrypt, ensurePem, buildWechatPayAuthorization, wechatNonce } from './signing';

// ─── 共用测试密钥对（模块级一次生成，2048-bit，约 30ms）────────────────────────
const { privateKey: _privKey, publicKey: _pubKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const TEST_PRIVATE_KEY = _privKey.export({ type: 'pkcs8', format: 'pem' }) as string;
const TEST_PUBLIC_KEY = _pubKey.export({ type: 'spki', format: 'pem' }) as string;

// ─── RSA 签名 / 验签 ───────────────────────────────────────────────────────────

describe('rsaSign + rsaVerify', () => {
  it('RSA-SHA256：签名后用对应公钥验签应通过（round-trip）', () => {
    const content = 'POST\n/v3/pay/transactions/native\n1718000000\nABCD1234\n{}\n';
    const sig = rsaSign(content, TEST_PRIVATE_KEY, 'RSA-SHA256');
    expect(sig).toBeTruthy();
    expect(rsaVerify(content, sig, TEST_PUBLIC_KEY, 'RSA-SHA256')).toBe(true);
  });

  it('RSA-SHA1：签名后用对应公钥验签应通过（支付宝旧签名类型）', () => {
    const content = 'app_id=2021000000&method=alipay.trade.query';
    const sig = rsaSign(content, TEST_PRIVATE_KEY, 'RSA-SHA1');
    expect(rsaVerify(content, sig, TEST_PUBLIC_KEY, 'RSA-SHA1')).toBe(true);
  });

  it('内容被篡改后验签应失败', () => {
    const content = 'original content';
    const sig = rsaSign(content, TEST_PRIVATE_KEY, 'RSA-SHA256');
    expect(rsaVerify('tampered content', sig, TEST_PUBLIC_KEY, 'RSA-SHA256')).toBe(false);
  });

  it('错误的公钥验签应失败（而非抛出）', () => {
    const { publicKey: otherPub } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const otherPubPem = otherPub.export({ type: 'spki', format: 'pem' }) as string;
    const sig = rsaSign('hello', TEST_PRIVATE_KEY, 'RSA-SHA256');
    expect(rsaVerify('hello', sig, otherPubPem, 'RSA-SHA256')).toBe(false);
  });

  it('畸形签名字符串应返回 false（而非抛出）', () => {
    expect(rsaVerify('hello', 'not-a-valid-base64-sig!!!', TEST_PUBLIC_KEY, 'RSA-SHA256')).toBe(false);
  });

  it('空内容可签名并验证', () => {
    const sig = rsaSign('', TEST_PRIVATE_KEY, 'RSA-SHA256');
    expect(rsaVerify('', sig, TEST_PUBLIC_KEY, 'RSA-SHA256')).toBe(true);
  });
});

// ─── AES-256-GCM 解密 ─────────────────────────────────────────────────────────

/** 辅助：用 Node crypto 加密，再调 aesGcmDecrypt 解密，验证 round-trip */
function encryptForTest(key: string, nonce: string, aad: string, plaintext: string): string {
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'utf8'),
    Buffer.from(nonce, 'utf8'),
  );
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([encrypted, tag]).toString('base64');
}

// 固定测试向量：32 字节 key（全 ASCII）/ 12 字节 nonce / AAD
const KEY32 = 'YourAPIv3Key32BytesPadded000000!'; // 32 个 ASCII 字符 = 32 字节
const NONCE12 = '123456789012'; // 12 个 ASCII 字符 = 12 字节
const AAD = 'transaction';

describe('aesGcmDecrypt', () => {
  it('已知明文加密后可正确解密（round-trip）', () => {
    const plaintext = JSON.stringify({ id: 'wx_12345', trade_state: 'SUCCESS' });
    const ciphertextB64 = encryptForTest(KEY32, NONCE12, AAD, plaintext);
    expect(aesGcmDecrypt(KEY32, NONCE12, AAD, ciphertextB64)).toBe(plaintext);
  });

  it('空 AAD 时也能正常解密', () => {
    const plaintext = '{"test":true}';
    const b64 = encryptForTest(KEY32, NONCE12, '', plaintext);
    expect(aesGcmDecrypt(KEY32, NONCE12, '', b64)).toBe(plaintext);
  });

  it('GCM tag 被篡改时应抛出错误', () => {
    const plaintext = 'sensitive';
    const ciphertextB64 = encryptForTest(KEY32, NONCE12, AAD, plaintext);
    const buf = Buffer.from(ciphertextB64, 'base64');
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString('base64');
    expect(() => aesGcmDecrypt(KEY32, NONCE12, AAD, tampered)).toThrow();
  });

  it('不同 key 产生不同密文（密文与 key 强绑定）', () => {
    // 使用固定长度 ASCII 字符串确保 32 字节
    const k1 = 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH'; // 32 字节
    const k2 = 'ZZZZYYYYXXXXWWWWVVVVUUUUTTTTSSSS'; // 32 字节
    const c1 = encryptForTest(k1, NONCE12, '', 'hello');
    const c2 = encryptForTest(k2, NONCE12, '', 'hello');
    expect(c1).not.toBe(c2);
  });
});

// ─── ensurePem ────────────────────────────────────────────────────────────────

describe('ensurePem', () => {
  it('已是 PEM 格式的字符串原样返回', () => {
    const pem = '-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----';
    expect(ensurePem(pem, 'PRIVATE KEY')).toBe(pem);
  });

  it('裸 base64 应被规整为正确 PEM 格式（PRIVATE KEY）', () => {
    // 生成一段 base64 字符串（不含 PEM 头）
    const raw = Buffer.from('fake-private-key-bytes'.repeat(5)).toString('base64');
    const result = ensurePem(raw, 'PRIVATE KEY');
    expect(result).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(result).toMatch(/-----END PRIVATE KEY-----$/);
    // 每行不超过 64 个字符（去掉 PEM 头尾后检查内容行）
    const bodyLines = result
      .split('\n')
      .filter((l) => !l.startsWith('-----'));
    bodyLines.forEach((line) => expect(line.length).toBeLessThanOrEqual(64));
  });

  it('裸 base64 应被规整为 CERTIFICATE 格式', () => {
    const raw = Buffer.from('cert-bytes'.repeat(10)).toString('base64');
    const result = ensurePem(raw, 'CERTIFICATE');
    expect(result).toContain('-----BEGIN CERTIFICATE-----');
    expect(result).toContain('-----END CERTIFICATE-----');
  });

  it('空字符串应原样返回空字符串', () => {
    expect(ensurePem('', 'PRIVATE KEY')).toBe('');
  });

  it('带空白/换行的裸 base64 应被规整（去除空白后处理）', () => {
    const raw = Buffer.from('key-data'.repeat(8)).toString('base64');
    // 人为加入空格和换行模拟复制粘贴
    const withWhitespace = raw.replace(/(.{20})/g, '$1\n  ');
    const result = ensurePem(withWhitespace, 'RSA PRIVATE KEY');
    expect(result).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);
  });
});

// ─── 微信支付 v3 Authorization ────────────────────────────────────────────────

describe('buildWechatPayAuthorization', () => {
  it('随机串为 32 位大写十六进制', () => {
    expect(wechatNonce()).toMatch(/^[0-9A-F]{32}$/);
    expect(wechatNonce()).not.toBe(wechatNonce());
  });

  it('生成的头可用商户公钥按 v3 签名串验签', () => {
    const before = Math.floor(Date.now() / 1000);
    const auth = buildWechatPayAuthorization({
      mchid: '1900000001',
      serialNo: 'SERIAL01',
      privateKey: TEST_PRIVATE_KEY,
      method: 'POST',
      urlPath: '/v3/pay/transactions/native',
      body: '{"a":1}',
    });
    const m = /^WECHATPAY2-SHA256-RSA2048 mchid="([^"]+)",nonce_str="([^"]+)",signature="([^"]+)",timestamp="(\d+)",serial_no="([^"]+)"$/.exec(auth);
    expect(m).not.toBeNull();
    const [, mchid, nonce, signature, timestamp, serialNo] = m!;
    expect(mchid).toBe('1900000001');
    expect(serialNo).toBe('SERIAL01');
    expect(nonce).toMatch(/^[0-9A-F]{32}$/);
    expect(Number(timestamp)).toBeGreaterThanOrEqual(before);
    const message = `POST\n/v3/pay/transactions/native\n${timestamp}\n${nonce}\n{"a":1}\n`;
    expect(rsaVerify(message, signature, TEST_PUBLIC_KEY, 'RSA-SHA256')).toBe(true);
  });

  it('接受裸 base64 私钥（内部 ensurePem）', () => {
    const rawKey = TEST_PRIVATE_KEY.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
    const auth = buildWechatPayAuthorization({ mchid: 'm', serialNo: 's', privateKey: rawKey, method: 'GET', urlPath: '/v3/certificates', body: '' });
    expect(auth.startsWith('WECHATPAY2-SHA256-RSA2048 mchid="m"')).toBe(true);
  });
});
