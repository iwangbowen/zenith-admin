import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * 微信公众号消息加解密（兼容/安全模式）。
 * 算法：AES-256-CBC，key=base64(encodingAesKey+'=')（32字节），iv=key前16字节，
 * 明文结构 = 16字节随机 + 4字节网络序消息长度 + 消息体 + AppID，PKCS7 补位。
 */

const BLOCK_SIZE = 32;

/** 加密消息体的签名：sha1(sort(token, timestamp, nonce, encrypt)) */
export function msgSignature(token: string, timestamp: string, nonce: string, encrypt: string): string {
  const sorted = [token, timestamp, nonce, encrypt].sort().join('');
  return createHash('sha1').update(sorted).digest('hex');
}

function keyAndIv(encodingAesKey: string): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(`${encodingAesKey}=`, 'base64');
  return { key, iv: key.subarray(0, 16) };
}

function pkcs7Unpad(buf: Buffer): Buffer {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > BLOCK_SIZE) return buf;
  return buf.subarray(0, buf.length - pad);
}

function pkcs7Pad(buf: Buffer): Buffer {
  const padLen = BLOCK_SIZE - (buf.length % BLOCK_SIZE);
  return Buffer.concat([buf, Buffer.alloc(padLen, padLen)]);
}

/** 解密 <Encrypt> 内容，返回明文 XML，并校验 AppID */
export function decryptWechatMessage(encodingAesKey: string, appId: string, encrypted: string): string {
  const { key, iv } = keyAndIv(encodingAesKey);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]);
  const unpadded = pkcs7Unpad(decrypted);
  const msgLen = unpadded.readUInt32BE(16);
  const msg = unpadded.subarray(20, 20 + msgLen).toString('utf8');
  const fromAppId = unpadded.subarray(20 + msgLen).toString('utf8');
  if (appId && fromAppId !== appId) throw new Error('消息 AppID 校验失败');
  return msg;
}

/** 加密明文 XML，返回 base64 的 <Encrypt> 内容 */
export function encryptWechatMessage(encodingAesKey: string, appId: string, plain: string): string {
  const { key, iv } = keyAndIv(encodingAesKey);
  const msg = Buffer.from(plain, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(msg.length, 0);
  const raw = Buffer.concat([randomBytes(16), lenBuf, msg, Buffer.from(appId, 'utf8')]);
  const cipher = createCipheriv('aes-256-cbc', key, iv);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(pkcs7Pad(raw)), cipher.final()]);
  return encrypted.toString('base64');
}
