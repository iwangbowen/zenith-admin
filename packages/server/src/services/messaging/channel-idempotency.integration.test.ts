import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const integration = testDatabaseUrl ? describe : describe.skip;

integration('targeted channel message idempotency', () => {
  let database: typeof import('../../db');
  let schema: typeof import('../../db/schema');
  let publishTargeted: typeof import('./channel.service').publishTargeted;
  let channelId = 0;
  let userId = 0;

  beforeAll(async () => {
    const url = new URL(testDatabaseUrl!);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.pathname !== '/zenith_review') {
      throw new Error('TEST_DATABASE_URL must target a disposable local zenith_review database');
    }
    vi.stubEnv('DATABASE_URL', testDatabaseUrl!);
    vi.resetModules();
    database = await import('../../db');
    schema = await import('../../db/schema');
    ({ publishTargeted } = await import('./channel.service'));
    const suffix = randomUUID().slice(0, 8);
    const [user] = await database.db.insert(schema.users).values({
      username: `channel-idem-${suffix}`,
      nickname: 'Channel idempotency test',
      password: 'test-only-not-a-login-hash',
    }).returning({ id: schema.users.id });
    const [channel] = await database.db.insert(schema.channels).values({
      code: `channel-idem-${suffix}`,
      name: 'Channel idempotency test',
    }).returning({ id: schema.channels.id });
    userId = user.id;
    channelId = channel.id;
  }, 120_000);

  afterAll(async () => {
    if (database && schema) {
      if (channelId) await database.db.delete(schema.channels).where(eq(schema.channels.id, channelId));
      if (userId) await database.db.delete(schema.users).where(eq(schema.users.id, userId));
      await database.closeDb();
    }
    vi.unstubAllEnvs();
  });

  it('commits one message and one recipient for a repeated workflow event', async () => {
    const dedupeKey = `workflow-event:${randomUUID()}:chat`;
    const first = await publishTargeted(channelId, [userId], { type: 'card', content: 'Approval', dedupeKey });
    const replay = await publishTargeted(channelId, [userId], { type: 'card', content: 'Approval', dedupeKey });
    expect(replay?.id).toBe(first?.id);
    expect(await database.db.$count(schema.channelMessages, eq(schema.channelMessages.dedupeKey, dedupeKey))).toBe(1);
    expect(await database.db.$count(schema.channelMessageTargets, and(
      eq(schema.channelMessageTargets.messageId, first!.id),
      eq(schema.channelMessageTargets.userId, userId),
    ))).toBe(1);
  });
});
