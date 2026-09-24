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
  consumeCmsAdEventTokens,
  signCmsAdEventToken,
  verifyCmsAdNavigationToken,
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

function token(overrides: Partial<CmsAdEventTokenPayload> = {}): string {
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
    ...overrides,
  };
  return signCmsAdEventToken(payload);
}

describe('CMS ad event signed tokens', () => {
  it('allows signed expired navigation without accepting an event or relaxing visitor binding', async () => {
    const signed = token({ eventType: 'click', expiresAt: 1 });
    const expected = { eventType: 'click' as const, adId: 9, ip, userAgent };
    expect(verifyCmsAdNavigationToken(signed, expected).adId).toBe(9);
    await expect(consumeCmsAdEventToken(signed, expected)).rejects.toMatchObject({ status: 403 });
    expect(redis.set).not.toHaveBeenCalled();
    expect(() => verifyCmsAdNavigationToken(`${signed}x`, expected)).toThrow();
    expect(() => verifyCmsAdNavigationToken(signed, { ...expected, adId: 10 })).toThrow();
    expect(() => verifyCmsAdNavigationToken(signed, { ...expected, ip: '203.0.113.21' })).toThrow();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(redis.set).mockResolvedValue('OK');
    vi.mocked(redis.del).mockResolvedValue(1);
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

  it('consumes impression token batches concurrently', async () => {
    let active = 0;
    let maxActive = 0;
    vi.mocked(redis.set).mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return 'OK';
    });

    const accepted = await consumeCmsAdEventTokens([
      token({ nonce: 'batch-a', adId: 9 }),
      token({ nonce: 'batch-b', adId: 10 }),
    ], {
      eventType: 'impression',
      ip,
      userAgent,
    });

    expect(accepted.map((payload) => payload.adId)).toEqual([9, 10]);
    expect(maxActive).toBe(2);
  });

  it('releases accepted tokens when any batch token is rejected', async () => {
    vi.mocked(redis.set).mockResolvedValueOnce('OK').mockResolvedValueOnce(null);

    await expect(consumeCmsAdEventTokens([
      token({ nonce: 'accepted-nonce', adId: 9 }),
      token({ nonce: 'rejected-nonce', adId: 10 }),
    ], {
      eventType: 'impression',
      ip,
      userAgent,
    })).rejects.toMatchObject({ status: 409 });

    expect(redis.del).toHaveBeenCalledWith(expect.stringContaining('accepted-nonce'));
    expect(redis.del).not.toHaveBeenCalledWith(expect.stringContaining('rejected-nonce'));
  });
});
