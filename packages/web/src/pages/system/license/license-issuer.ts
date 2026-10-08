import {
  LICENSE_ALGORITHM,
  LICENSE_ENVELOPE_VERSION,
  licenseEnvelopeSchema,
  licensePayloadSchema,
  type LicenseEnvelope,
  type LicensePayload,
} from '@zenith/shared/licensing';

export interface LicenseSigningKey {
  keyId: string;
  /** Ed25519 PKCS8 DER 的 base64，或未加密的 PRIVATE KEY PEM。 */
  privateKey: string;
}

const UNSUPPORTED_MESSAGE = '当前浏览器不支持本地 Ed25519 签发，请使用支持 Web Crypto 的浏览器，并通过 HTTPS 或 localhost 打开页面。';
const INVALID_KEY_MESSAGE = '私钥无效：请提供未加密的 Ed25519 PKCS8 base64 或 PRIVATE KEY PEM。';

function isUnsupported(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'NotSupportedError';
}

function decodePrivateKey(value: string): Uint8Array<ArrayBuffer> {
  const trimmed = value.trim();
  let base64 = trimmed;
  if (trimmed.includes('-----')) {
    const pem = /^-----BEGIN PRIVATE KEY-----\s*([A-Za-z0-9+/=\s]+)\s*-----END PRIVATE KEY-----$/.exec(trimmed);
    if (!pem) throw new Error(INVALID_KEY_MESSAGE);
    base64 = pem[1];
  }
  base64 = base64.replace(/\s/g, '');
  if (!base64 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error(INVALID_KEY_MESSAGE);
  }
  try {
    const binary = atob(base64);
    // 拒绝非规范填充位，避免浏览器宽松解码吞掉损坏输入。
    if (btoa(binary) !== base64) throw new Error();
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    throw new Error(INVALID_KEY_MESSAGE);
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** 页面内存中签发授权文件，不执行请求、日志或持久化；私钥导入后不可导出。 */
export async function signLicenseEnvelope(payload: LicensePayload, key: LicenseSigningKey): Promise<LicenseEnvelope> {
  const parsedPayload = licensePayloadSchema.safeParse(payload);
  if (!parsedPayload.success) throw new Error('授权内容格式无效，请检查必填字段、功能及 ISO 时间格式。');
  const parsedKeyId = licenseEnvelopeSchema.shape.keyId.safeParse(key.keyId.trim());
  if (!parsedKeyId.success) throw new Error('签发密钥 ID 必须为 1 至 64 个字符。');

  const subtle = globalThis.crypto?.subtle;
  if (globalThis.isSecureContext === false || !subtle?.importKey || !subtle.sign) {
    throw new Error(UNSUPPORTED_MESSAGE);
  }
  const keyBytes = decodePrivateKey(key.privateKey);
  let privateKey: CryptoKey;
  try {
    privateKey = await subtle.importKey('pkcs8', keyBytes.buffer, LICENSE_ALGORITHM, false, ['sign']);
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- 原始加密异常可能包含私钥输入，不能随 cause 返回页面。
    throw new Error(isUnsupported(error) ? UNSUPPORTED_MESSAGE : INVALID_KEY_MESSAGE);
  } finally {
    keyBytes.fill(0);
  }

  const payloadBytes = new TextEncoder().encode(JSON.stringify(parsedPayload.data));
  let signature: ArrayBuffer;
  try {
    signature = await subtle.sign(LICENSE_ALGORITHM, privateKey, payloadBytes);
  } catch (error) {
    // eslint-disable-next-line preserve-caught-error -- 原始加密异常可能包含敏感输入，只返回固定文案。
    throw new Error(isUnsupported(error) ? UNSUPPORTED_MESSAGE : '本地签发失败，请检查浏览器的加密能力后重试。');
  }
  return {
    version: LICENSE_ENVELOPE_VERSION,
    algorithm: LICENSE_ALGORITHM,
    keyId: parsedKeyId.data,
    payload: encodeBase64Url(payloadBytes),
    signature: encodeBase64Url(new Uint8Array(signature)),
  };
}
