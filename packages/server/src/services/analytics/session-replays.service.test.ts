import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const { update } = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock('../../db', () => ({ db: { update } }));

import { reconcileReplayErrorCount } from './session-replays.service';

describe('reconcileReplayErrorCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    update.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it('uses an idempotent count of linked errors instead of a race-prone increment', async () => {
    await reconcileReplayErrorCount({ update }, 'replay-1');

    const set = update.mock.results[0]?.value.set as ReturnType<typeof vi.fn>;
    const values = set.mock.calls[0]?.[0] as { errorCount: unknown };
    const { sql: sqlText, params } = new PgDialect().sqlToQuery(values.errorCount as never);
    expect(sqlText).toContain('GREATEST');
    expect(sqlText).toContain('COUNT(*)::int');
    expect(params).toEqual([]);
  });
});
