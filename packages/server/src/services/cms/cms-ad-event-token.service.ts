import { requireRow } from '../../lib/db-assert';
import { randomUUID } from 'node:crypto';
import { and, eq, gte, inArray, isNull, lte, or } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { CmsAdEventType } from '@zenith/shared/cms';
import { config } from '../../config';
import { db } from '../../db';
import { cmsAds, cmsAdSlots, cmsSites } from '../../db/schema';
import redis from '../../lib/redis';
import { createSignedTokenCodec } from '../../lib/signed-token';
import { normalizeCmsAdClickUrl } from './cms-ad-events.service';
import { hashCmsIp, hashCmsVisitor } from './cms-visitor';
import { verifyCmsAdRenderProof } from './cms-ad-render-proof';

const TOKEN_VERSION = 'v1';
const TOKEN_TTL_SECONDS = 5 * 60;
const TOKEN_USED_PREFIX = `${config.redis.keyPrefix}cms:ad-event-token:used:`;
const TOKEN_RATE_PREFIX = `${config.redis.keyPrefix}cms:ad-event-token:rate:`;

export interface CmsAdEventTokenPayload {
  version: 1;
  nonce: string;
  eventType: CmsAdEventType;
  siteId: number;
  adId: number;
  path: string;
  memberId: number | null;
  visitorHash: string;
  expiresAt: number;
}

export interface CmsIssuedAdEventTokens {
  adId: number;
  viewToken: string;
  clickToken: string | null;
}

const codec = createSignedTokenCodec<CmsAdEventTokenPayload>({ version: TOKEN_VERSION });

export function signCmsAdEventToken(payload: CmsAdEventTokenPayload): string {
  return codec.encode(payload);
}

function parseSignedToken(token: string): CmsAdEventTokenPayload {
  const payload = codec.decode(token);
  if (!payload) throw new HTTPException(403, { message: '广告事件令牌无效' });
  try {
    if (
      payload.version !== 1
      || !payload.nonce
      || !['impression', 'click'].includes(payload.eventType)
      || !Number.isInteger(payload.siteId)
      || !Number.isInteger(payload.adId)
      || !Number.isInteger(payload.expiresAt)
      || typeof payload.path !== 'string'
      || typeof payload.visitorHash !== 'string'
    ) {
      throw new Error('invalid payload');
    }
    return payload;
  } catch {
    throw new HTTPException(403, { message: '广告事件令牌无效' });
  }
}

export async function throttleCmsAdTokenIssue(ip: string): Promise<void> {
  const key = `${TOKEN_RATE_PREFIX}${hashCmsIp(ip)}`;
  let count: number;
  try {
    count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 60);
  } catch {
    throw new HTTPException(503, { message: '广告事件安全服务暂不可用' });
  }
  if (count > 120) throw new HTTPException(429, { message: '广告事件请求过于频繁' });
}

export async function issueCmsAdEventTokens(input: {
  siteCode: string;
  ads: Array<{ adId: number; renderProof: string }>;
  host?: string | null;
  memberId: number | null;
  ip: string;
  userAgent: string | null;
}): Promise<CmsIssuedAdEventTokens[]> {
  const requests = [...new Map(input.ads
    .filter((item) => Number.isInteger(item.adId) && item.adId > 0 && item.renderProof.length <= 4096)
    .slice(0, 50)
    .map((item) => [item.adId, item])).values()];
  const ids = requests.map((item) => item.adId);
  if (ids.length === 0) return [];
  let proofPath: string | null = null;
  const proofs = requests.map((item) => {
    const proof = verifyCmsAdRenderProof(item.renderProof);
    if (
      proof.siteCode !== input.siteCode
      || !proof.adIds.includes(item.adId)
      || (proofPath !== null && proof.path !== proofPath)
    ) {
      throw new HTTPException(403, { message: '广告渲染凭证与页面不匹配' });
    }
    proofPath = proof.path;
    return proof;
  });
  const firstProof = proofs[0];
  const path = firstProof.path;
  const [site] = await db.select({ id: cmsSites.id }).from(cmsSites).where(and(
    eq(cmsSites.code, input.siteCode),
    eq(cmsSites.id, firstProof.siteId),
    eq(cmsSites.status, 'enabled'),
  )).limit(1);
  requireRow(site, '站点不存在或未启用');
  const now = new Date();
  const rows = await db.select({
    id: cmsAds.id,
    linkUrl: cmsAds.linkUrl,
  })
    .from(cmsAds)
    .innerJoin(cmsAdSlots, eq(cmsAds.slotId, cmsAdSlots.id))
    .where(and(
      inArray(cmsAds.id, ids),
      eq(cmsAdSlots.siteId, site.id),
      eq(cmsAds.status, 'enabled'),
      or(isNull(cmsAds.startAt), lte(cmsAds.startAt, now)),
      or(isNull(cmsAds.endAt), gte(cmsAds.endAt, now)),
    ));
  const visitorHash = hashCmsVisitor(input.ip, input.userAgent);
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  return rows.map((row) => {
    const base = {
      version: 1 as const,
      siteId: site.id,
      adId: row.id,
      path,
      memberId: input.memberId,
      visitorHash,
      expiresAt,
    };
    return {
      adId: row.id,
      viewToken: signCmsAdEventToken({
        ...base,
        nonce: randomUUID(),
        eventType: 'impression',
      }),
      clickToken: normalizeCmsAdClickUrl(row.linkUrl)
        ? signCmsAdEventToken({
          ...base,
          nonce: randomUUID(),
          eventType: 'click',
        })
        : null,
    };
  });
}

export async function consumeCmsAdEventToken(
  token: string,
  expected: CmsAdEventTokenExpectation,
): Promise<CmsAdEventTokenPayload> {
  const payload = parseSignedToken(token);
  const now = Math.floor(Date.now() / 1000);
  if (
    payload.expiresAt <= now
    || payload.eventType !== expected.eventType
    || (expected.adId !== undefined && payload.adId !== expected.adId)
    || payload.visitorHash !== hashCmsVisitor(expected.ip, expected.userAgent)
  ) {
    throw new HTTPException(403, { message: '广告事件令牌无效或已过期' });
  }
  let accepted: string | null;
  try {
    accepted = await redis.set(
      `${TOKEN_USED_PREFIX}${payload.nonce}`,
      '1',
      'EX',
      Math.max(1, payload.expiresAt - now),
      'NX',
    );
  } catch {
    throw new HTTPException(503, { message: '广告事件安全服务暂不可用' });
  }
  if (accepted !== 'OK') throw new HTTPException(409, { message: '广告事件令牌已使用' });
  return payload;
}

interface CmsAdEventTokenExpectation {
  eventType: CmsAdEventType;
  adId?: number;
  ip: string;
  userAgent: string | null;
}

export async function consumeCmsAdEventTokens(
  tokens: readonly string[],
  expected: CmsAdEventTokenExpectation,
): Promise<CmsAdEventTokenPayload[]> {
  const results = await Promise.allSettled(
    tokens.map((token) => consumeCmsAdEventToken(token, expected)),
  );
  const payloads = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') {
    await Promise.all(payloads.map(releaseCmsAdEventToken));
    throw failed.reason;
  }
  return payloads;
}

export async function releaseCmsAdEventToken(payload: Pick<CmsAdEventTokenPayload, 'nonce'>): Promise<void> {
  await redis.del(`${TOKEN_USED_PREFIX}${payload.nonce}`).catch(() => undefined);
}
