import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/redis', () => ({
  default: {
    set: vi.fn(),
    del: vi.fn(),
    incr: vi.fn(),
    expire: vi.fn(),
  },
}));

import redis from '../../lib/redis';
import {
  consumeCmsAdEventToken,
  signCmsAdEventToken,
  type CmsAdEventTokenPayload,
} from './cms-ad-event-token.service';
import { hashCmsVisitor } from './cms-visitor';
import {
  resolveCmsRenderedPagePath,
  signCmsAdRenderProof,
  verifyCmsAdRenderProof,
} from './cms-ad-render-proof';

const ip = '203.0.113.20';
const userAgent = 'Stage4 Browser';

function token(): string {
  const payload: CmsAdEventTokenPayload = {
    version: 1,
    nonce: 'one-time-nonce',
    eventType: 'impression',
    siteId: 1,
    adId: 9,
    path: '/news/?from=home',
    publishChannelId: 1,
    memberId: null,
    visitorHash: hashCmsVisitor(ip, userAgent),
    expiresAt: Math.floor(Date.now() / 1000) + 60,
  };
  return signCmsAdEventToken(payload);
}

describe('CMS ad event signed tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.set).mockResolvedValue('OK');
  });

  it('binds the token to ad/page/site and the issuing visitor fingerprint', async () => {
    const accepted = await consumeCmsAdEventToken(token(), {
      eventType: 'impression',
      adId: 9,
      ip,
      userAgent,
    });

    expect(accepted).toMatchObject({ siteId: 1, adId: 9, path: '/news/?from=home' });

    await expect(consumeCmsAdEventToken(token(), {
      eventType: 'impression',
      adId: 9,
      ip,
      userAgent: 'forged user agent',
    })).rejects.toMatchObject({ status: 403 });
  });

  it('requires a server-rendered proof bound to the exact page and advertised ad', () => {
    const path = resolveCmsRenderedPagePath({
      baseUrl: '/__cms/main',
      canonical: 'https://cms.example/news/',
    });
    const proof = signCmsAdRenderProof({
      version: 1,
      siteId: 1,
      siteCode: 'main',
      adIds: [9],
      path,
    });
    expect(verifyCmsAdRenderProof(proof)).toMatchObject({
      siteId: 1,
      siteCode: 'main',
      adIds: [9],
      path: '/__cms/main/news/',
    });
    expect(() => verifyCmsAdRenderProof(`${proof}x`)).toThrow();
  });

  it('rejects replay and tampering fail-closed', async () => {
    vi.mocked(redis.set).mockResolvedValueOnce('OK').mockResolvedValueOnce(null);
    const signed = token();
    await expect(consumeCmsAdEventToken(signed, {
      eventType: 'impression',
      ip,
      userAgent,
    })).resolves.toBeTruthy();
    await expect(consumeCmsAdEventToken(signed, {
      eventType: 'impression',
      ip,
      userAgent,
    })).rejects.toMatchObject({ status: 409 });
    await expect(consumeCmsAdEventToken(`${signed}x`, {
      eventType: 'impression',
      ip,
      userAgent,
    })).rejects.toMatchObject({ status: 403 });
  });
});
