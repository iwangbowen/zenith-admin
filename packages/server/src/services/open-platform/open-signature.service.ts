import { HTTPException } from 'hono/http-exception';
import { requireRow } from '../../lib/db-assert';
import { eq } from 'drizzle-orm';
import { OPEN_SIGNATURE_ALGORITHM, OPEN_SIGNATURE_TIMESTAMP_WINDOW, OPEN_SIGNATURE_HEADERS } from '@zenith/shared/open-platform';
import type { OpenSignatureVerifyInput } from '@zenith/shared/open-platform';
import { getAppSigningSecret } from './oauth2-clients.service';
import { signRequest, timingSafeEqualHex } from '../../lib/open-signature';
import { db } from '../../db';
import { oauth2Clients } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { isSuperAdmin, getUserPermissions } from '../../lib/permissions';

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

/**
 * 按 AppKey 取出签名密钥并计算签名；如传入 signature 则返回是否匹配。
 *
 * 服务端用应用密钥代算签名，等同于「凭 client_id 换一个有效签名」。client_id 是公开信息，
 * 因此必须校验调用者对该应用的所有权：只有应用 owner 或持有应用管理权限的管理员可用，
 * 否则任何登录用户都能为任意应用伪造合法签名。
 */
export async function verifyAppSignature(input: OpenSignatureVerifyInput) {
  await ensureSignatureToolAccess(input.appKey);
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

/** 校验当前用户是否有权对该应用执行代签操作 */
async function ensureSignatureToolAccess(appKey: string): Promise<void> {
  const user = currentUser();
  if (isSuperAdmin(user)) return;
  const permissions = await getUserPermissions(user.userId);
  if (permissions.includes('system:oauth2-apps:manage')) return;

  const [row] = await db.select({ ownerId: oauth2Clients.ownerId })
    .from(oauth2Clients)
    .where(eq(oauth2Clients.clientId, appKey))
    .limit(1);
  requireRow(row, 'AppKey 无效', 400);
  if (row.ownerId !== user.userId) {
    throw new HTTPException(403, { message: '只能对自己名下的应用计算签名' });
  }
}
