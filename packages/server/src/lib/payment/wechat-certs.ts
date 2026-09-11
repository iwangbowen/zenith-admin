/**
 * 微信支付平台证书管理。
 *
 * 微信平台证书会定期轮换,回调头 `Wechatpay-Serial` 标识本次用的是哪张证书。
 * 本模块自动 `GET /v3/certificates` 下载平台证书(响应中的证书用商户 APIv3 Key 做
 * AES-256-GCM 加密),解密后按 serial 缓存(12h TTL),供回调验签按 serial 选证。
 *
 * 设计:adapter 单向依赖本模块(本模块不反向依赖 wechat.adapter,避免循环)。
 */
import { httpGet } from '../http-client';
import { aesGcmDecrypt, buildWechatPayAuthorization } from './signing';
import logger from '../logger';
import type { AdapterContext } from './types';
import { providerHttpOptions } from './provider-http';

const WECHAT_BASE = 'https://api.mch.weixin.qq.com';
const CERT_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时

interface CertCacheEntry {
  fetchedAt: number;
  certs: Map<string, string>; // serial_no -> 证书 PEM
}
const cache = new Map<string, CertCacheEntry>(); // key: mchId

function buildAuthToken(ctx: AdapterContext, method: string, urlPath: string, body: string): string | null {
  const mchid = ctx.config.wechatMchId;
  const serialNo = ctx.config.wechatSerialNo;
  const privateKey = ctx.secrets.wechatPrivateKey;
  if (!mchid || !serialNo || !privateKey) return null;
  return buildWechatPayAuthorization({ mchid, serialNo, privateKey, method, urlPath, body });
}

interface CertListResponse {
  data?: Array<{
    serial_no: string;
    encrypt_certificate: { algorithm: string; nonce: string; associated_data: string; ciphertext: string };
  }>;
}

async function fetchCertificates(ctx: AdapterContext): Promise<Map<string, string>> {
  const certs = new Map<string, string>();
  const urlPath = '/v3/certificates';
  const auth = buildAuthToken(ctx, 'GET', urlPath, '');
  const apiV3Key = ctx.secrets.wechatApiV3Key;
  if (!auth || !apiV3Key) return certs;

  const resp = await httpGet(`${WECHAT_BASE}${urlPath}`, {
    ...providerHttpOptions(),
    headers: { Authorization: auth, Accept: 'application/json', 'User-Agent': 'zenith-admin' },
  });
  const text = await resp.text();
  if (!resp.ok) {
    logger.warn('[wechat-pay] fetch certificates failed', { status: resp.status, body: text.slice(0, 300) });
    return certs;
  }
  let parsed: CertListResponse;
  try {
    parsed = JSON.parse(text) as CertListResponse;
  } catch {
    return certs;
  }
  // 用 APIv3 Key 解密每张证书(解密成功即证明真实性,GCM tag 已鉴权)
  for (const item of parsed.data ?? []) {
    try {
      const enc = item.encrypt_certificate;
      const pem = aesGcmDecrypt(apiV3Key, enc.nonce, enc.associated_data ?? '', enc.ciphertext);
      certs.set(item.serial_no, pem);
    } catch (err) {
      logger.warn('[wechat-pay] decrypt platform cert failed', { serial: item.serial_no, err });
    }
  }
  return certs;
}

/** 按 serial 获取平台证书 PEM;缓存过期或未命中目标 serial 时刷新下载。失败返回 null。 */
export async function getPlatformCert(ctx: AdapterContext, serial: string): Promise<string | null> {
  const mchid = ctx.config.wechatMchId;
  if (!mchid || !serial) return null;
  const now = Date.now();
  const entry = cache.get(mchid);
  const stale = !entry || now - entry.fetchedAt > CERT_TTL_MS;
  if (!entry || stale || !entry.certs.has(serial)) {
    try {
      const certs = await fetchCertificates(ctx);
      if (certs.size > 0) cache.set(mchid, { fetchedAt: now, certs });
    } catch (err) {
      logger.warn('[wechat-pay] refresh certificates error', { err });
    }
  }
  return cache.get(mchid)?.certs.get(serial) ?? null;
}

/** 清空平台证书缓存(测试/运维用)。 */
export function clearWechatCertCache(): void {
  cache.clear();
}
