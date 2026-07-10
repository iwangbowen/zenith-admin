import { describe, expect, it } from 'vitest';
import { HTTPException } from 'hono/http-exception';
import {
  buildRunIdempotencyKey,
  computeScheduleClaim,
  parseRecipientEmails,
  validateNotifyChannels,
  REPORT_DEFAULT_TIMEZONE,
} from './report-delivery.service';

describe('report delivery core', () => {
  it('parses recipient emails and trims blanks', () => {
    expect(parseRecipientEmails(' a@test.com, b@test.com ,, ', true)).toEqual(['a@test.com', 'b@test.com']);
    expect(parseRecipientEmails(null, false)).toEqual([]);
  });

  it('validates channels for email/webhook/inApp', () => {
    expect(() => validateNotifyChannels(['email'], 'ops@example.com', null, 1)).not.toThrow();
    expect(() => validateNotifyChannels(['webhook'], null, 'https://example.com/hook', 1)).not.toThrow();
    expect(() => validateNotifyChannels(['inApp'], null, null, 1)).not.toThrow();
    expect(() => validateNotifyChannels(['email'], null, null, 1)).toThrow(HTTPException);
    expect(() => validateNotifyChannels(['inApp'], null, null, null)).toThrow(HTTPException);
  });

  it('computes misfire claim for skip and fire_once', () => {
    const nextRunAt = new Date('2026-07-01T00:00:00.000Z');
    const now = new Date('2026-07-03T00:00:00.000Z');
    const skip = computeScheduleClaim({
      cron: '0 0 9 * * *',
      timezone: REPORT_DEFAULT_TIMEZONE,
      misfirePolicy: 'skip',
      nextRunAt,
      now,
    });
    const fireOnce = computeScheduleClaim({
      cron: '0 0 9 * * *',
      timezone: REPORT_DEFAULT_TIMEZONE,
      misfirePolicy: 'fire_once',
      nextRunAt,
      now,
    });
    expect(skip.shouldExecute).toBe(false);
    expect(skip.nextRunAt).not.toBeNull();
    expect(fireOnce.shouldExecute).toBe(true);
    expect(fireOnce.nextRunAt).not.toBeNull();
  });

  it('builds bounded idempotency key', () => {
    const key = buildRunIdempotencyKey(['report', 'subscription', 1, '', null, undefined, 'manual']);
    expect(key).toBe('report:subscription:1:manual');
    expect(buildRunIdempotencyKey([`x`.repeat(300)])).toHaveLength(128);
  });
});
