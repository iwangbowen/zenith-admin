import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { cmsMemberSubscriptions } from '../../db/schema';
import { normalizeCmsAuthorKey } from './cms-subscriptions.service';

describe('CMS Stage4 subscriptions', () => {
  it('normalizes author keys with NFKC, trim, whitespace collapse and stable case folding', () => {
    expect(normalizeCmsAuthorKey('  Ａlice　Smith  ')).toBe('alice smith');
    expect(normalizeCmsAuthorKey('Alice   Smith')).toBe('alice smith');
    expect(normalizeCmsAuthorKey('ALICE SMITH')).toBe('alice smith');
  });

  it('keeps one durable member/site/type/key row so resubscribe cannot re-award first points', () => {
    const config = getTableConfig(cmsMemberSubscriptions);
    const unique = config.indexes.find((item) => item.config.name === 'cms_member_subscriptions_subject_uq');
    expect(unique?.config.unique).toBe(true);
    expect(config.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'active',
      'points_awarded_at',
      'notification_enabled',
    ]));
  });

  it('wires IDOR ownership, CMS point idempotency and outbox notifications', async () => {
    const [route, service, tasks, contents] = await Promise.all([
      readFile(new URL('../../routes/member/member-cms.ts', import.meta.url), 'utf8'),
      readFile(new URL('./cms-subscriptions.service.ts', import.meta.url), 'utf8'),
      readFile(new URL('./cms-stage4-tasks.ts', import.meta.url), 'utf8'),
      readFile(new URL('./cms-contents.service.ts', import.meta.url), 'utf8'),
    ]);
    expect(route).toContain('memberAuthMiddleware');
    expect(service).toContain('eq(cmsMemberSubscriptions.memberId, memberId)');
    expect(service).toContain("bizType: 'cms_interaction'");
    expect(service).toContain('subscribe:');
    expect(service).toContain('changePointsInTransaction');
    expect(service).toContain("eq(cmsSites.status, 'enabled')");
    expect(service).toContain("eq(cmsChannels.status, 'enabled')");
    expect(service).toContain("eq(cmsContents.status, 'published')");
    expect(service).toContain("from(cmsMemberSubscriptions)");
    expect(tasks).toContain("taskType: 'cms-subscription-notify'");
    expect(tasks).toContain('createMemberNotification');
    expect(tasks).toContain('subscriberCutoffId');
    expect(tasks).toContain('getPublicCmsSubscriptionNotificationContent');
    expect(tasks).toContain('runWithCurrentUser({');
    expect(tasks).not.toContain('label: `会员 #${recipient.memberId}`');
    expect(contents).toContain('insertCmsSubscriptionNotificationOutbox(tx, updated)');
  });
});
