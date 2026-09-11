/**
 * 支付签名/加密底层原语（Node 原生 crypto，不依赖第三方 SDK）。
 *
 * - 支付宝：RSA2（SHA256withRSA）/ RSA（SHA1withRSA）签名与验签
 * - 微信支付 v3：RSA-SHA256 请求签名、平台证书验签、AES-256-GCM 回调解密
 */
import { createSign, createVerify, createDecipheriv, randomBytes } from 'node:crypto';

export type RsaAlgorithm = 'RSA-SHA256' | 'RSA-SHA1';

/** RSA 签名（PEM 私钥），返回 base64 */
export function rsaSign(content: string, privateKeyPem: string, algorithm: RsaAlgorithm = 'RSA-SHA256'): string {
  const signer = createSign(algorithm);
  signer.update(content, 'utf8');
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
}

/** RSA 验签（PEM 公钥 / 证书），签名为 base64 */
export function rsaVerify(content: string, signatureBase64: string, publicKeyPem: string, algorithm: RsaAlgorithm = 'RSA-SHA256'): boolean {
  try {
    const verifier = createVerify(algorithm);
    verifier.update(content, 'utf8');
    verifier.end();
    return verifier.verify(publicKeyPem, signatureBase64, 'base64');
  } catch {
    return false;
  }
}

/**
 * AES-256-GCM 解密（微信支付 v3 回调 resource）。
 * key 为 32 字节 APIv3 Key，nonce 为 12 字节随机串，ciphertext 为 base64（含 16B GCM tag 后缀）。
 */
export function aesGcmDecrypt(key: string, nonce: string, associatedData: string, ciphertextB64: string): string {
  const cipherBuf = Buffer.from(ciphertextB64, 'base64');
  const authTag = cipherBuf.subarray(-16);
  const data = cipherBuf.subarray(0, -16);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'utf8'), Buffer.from(nonce, 'utf8'));
  decipher.setAuthTag(authTag);
  if (associatedData) decipher.setAAD(Buffer.from(associatedData, 'utf8'));
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * 将裸 base64 密钥/证书规整为 PEM 格式。
 * 若已包含 PEM 头则原样返回；否则按 64 字符换行并加上对应 BEGIN/END 标签。
 */
export function ensurePem(key: string, label: 'PUBLIC KEY' | 'PRIVATE KEY' | 'RSA PRIVATE KEY' | 'CERTIFICATE'): string {
  const trimmed = (key ?? '').trim();
  if (!trimmed) return trimmed;
  if (trimmed.includes('-----BEGIN')) return trimmed;
  const body = trimmed.replace(/\s+/g, '').match(/.{1,64}/g)?.join('\n') ?? trimmed;
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----`;
}

/** 微信支付 v3 随机串（32 位大写十六进制） */
export function wechatNonce(): string {
  return randomBytes(16).toString('hex').toUpperCase();
}

/**
 * 微信支付 v3 请求 `Authorization` 头（WECHATPAY2-SHA256-RSA2048）：
 * 对 `method\nurlPath\ntimestamp\nnonce\nbody\n` 做 RSA-SHA256 签名。适配器与平台证书下载共用。
 * 私钥可为裸 base64 或 PEM，缺失校验由调用方负责。
 */
export function buildWechatPayAuthorization(input: {
  mchid: string;
  serialNo: string;
  privateKey: string;
  method: string;
  urlPath: string;
  body: string;
}): string {
  const privateKey = ensurePem(input.privateKey, 'PRIVATE KEY');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = wechatNonce();
  const message = `${input.method}\n${input.urlPath}\n${timestamp}\n${nonce}\n${input.body}\n`;
  const signature = rsaSign(message, privateKey, 'RSA-SHA256');
  return `WECHATPAY2-SHA256-RSA2048 mchid="${input.mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${input.serialNo}"`;
}
