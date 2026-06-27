import { HTTPException } from 'hono/http-exception';
import {
  OPEN_SIGNATURE_ALGORITHM,
  OPEN_SIGNATURE_TIMESTAMP_WINDOW,
  OPEN_SIGNATURE_HEADERS,
} from '@zenith/shared';
import type { OpenSignatureVerifyInput } from '@zenith/shared';
import { getAppSigningSecret } from './oauth2-clients.service';
import { signRequest, timingSafeEqualHex } from '../lib/open-signature';

/** 返回签名算法说明（供前端验签工具页展示） */
export function getSignatureAlgorithmDoc() {
  return {
    algorithm: OPEN_SIGNATURE_ALGORITHM,
    timestampWindow: OPEN_SIGNATURE_TIMESTAMP_WINDOW,
    headers: {
      appKey: OPEN_SIGNATURE_HEADERS.appKey,
      timestamp: OPEN_SIGNATURE_HEADERS.timestamp,
      nonce: OPEN_SIGNATURE_HEADERS.nonce,
      signature: OPEN_SIGNATURE_HEADERS.signature,
    },
    stringToSignFormat: 'METHOD\\nPATH\\nCANONICAL_QUERY\\nTIMESTAMP\\nNONCE\\nSHA256_HEX(BODY)',
    steps: [
      '1. 规整 query：按参数名排序后以 k=v&k=v 拼接（无 query 则为空字符串）',
      '2. 计算请求体的 SHA-256 十六进制摘要（无 body 则对空字符串求摘要）',
      '3. 以换行符顺序拼接 METHOD、PATH、CANONICAL_QUERY、TIMESTAMP、NONCE、BODY_HASH 得到待签名串',
      '4. 用 AppSecret 作为密钥对待签名串做 HMAC-SHA256，输出十六进制即 X-Signature',
      '5. 请求时携带 X-App-Key、X-Timestamp（秒级）、X-Nonce（随机串）、X-Signature 四个请求头',
    ],
  };
}

/** 按 AppKey 取出签名密钥并计算签名；如传入 signature 则返回是否匹配 */
export async function verifyAppSignature(input: OpenSignatureVerifyInput) {
  const secret = await getAppSigningSecret(input.appKey);
  if (!secret) {
    throw new HTTPException(400, { message: 'AppKey 无效，或该应用未配置签名密钥（公开客户端无密钥）' });
  }
  const { signature, stringToSign } = signRequest(secret, {
    method: input.method ?? 'GET',
    path: input.path,
    query: input.query,
    timestamp: input.timestamp,
    nonce: input.nonce,
    body: input.body,
  });
  const matched = input.signature ? timingSafeEqualHex(input.signature, signature) : undefined;
  return { signature, stringToSign, matched };
}
