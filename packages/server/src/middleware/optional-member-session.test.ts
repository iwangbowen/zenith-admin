import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { config } from '../config';

const mocks = vi.hoisted(() => ({
  blacklisted: vi.fn(),
  getSession: vi.fn(),
  touchSession: vi.fn(),
  memberEnabled: true,
}));

vi.mock('../lib/member-session-manager', () => ({
  isMemberTokenBlacklisted: mocks.blacklisted,
  getMemberSession: mocks.getSession,
  touchMemberSession: mocks.touchSession,
}));

vi.mock('../db', () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.memberEnabled ? [{ id: 7 }] : [],
        }),
      }),
    }),
  },
}));

import { optionalMemberSessionMiddleware } from './optional-member-session';

async function memberToken() {
  const now = Math.floor(Date.now() / 1000);
  return sign({
    memberId: 7,
    identifier: 'member-7',
    type: 'member',
    tenantId: null,
    jti: 'member-session-7',
    iat: now,
    exp: now + 600,
  }, config.jwtSecret, 'HS256');
}

function app() {
  const instance = new Hono();
  instance.get('/probe', optionalMemberSessionMiddleware, (c) =>
    c.json({ memberId: c.get('member')?.memberId ?? null }));
  return instance;
}

describe('optional member session middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.memberEnabled = true;
    mocks.blacklisted.mockResolvedValue(false);
    mocks.getSession.mockResolvedValue({ memberId: 7 });
    mocks.touchSession.mockResolvedValue(true);
  });

  it('grants member audience only to an active token with a live Redis session', async () => {
    const response = await app().request('/probe', {
      headers: { Authorization: `Bearer ${await memberToken()}` },
    });
    expect(await response.json()).toEqual({ memberId: 7 });
    expect(mocks.touchSession).toHaveBeenCalledWith('member-session-7');
  });

  it('treats a force-logged-out token as guest even when its JWT is still valid', async () => {
    mocks.blacklisted.mockResolvedValue(true);
    const response = await app().request('/probe', {
      headers: { Authorization: `Bearer ${await memberToken()}` },
    });
    expect(await response.json()).toEqual({ memberId: null });
    expect(mocks.touchSession).not.toHaveBeenCalled();
  });

  it('fails closed to guest for a missing session or disabled member', async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const missingSession = await app().request('/probe', {
      headers: { Authorization: `Bearer ${await memberToken()}` },
    });
    expect(await missingSession.json()).toEqual({ memberId: null });

    mocks.memberEnabled = false;
    const disabled = await app().request('/probe', {
      headers: { Authorization: `Bearer ${await memberToken()}` },
    });
    expect(await disabled.json()).toEqual({ memberId: null });
  });
});
