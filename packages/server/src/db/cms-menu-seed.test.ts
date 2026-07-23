import { describe, expect, it, vi } from 'vitest';
import { SEED_MENUS } from '@zenith/shared';
import type { DbExecutor } from './types';
import { mapMenuSeedRows, upsertCmsMenuSeedRows } from './cms-menu-seed';

describe('CMS menu seed upgrades', () => {
  it('upserts CMS rows by id so renamed publish permission reaches existing installations', async () => {
    const rows = mapMenuSeedRows(SEED_MENUS);
    expect(rows.find((row) => row.id === 1745)?.permission).toBe('cms:publish:build');

    const onConflictDoUpdate = vi.fn(async () => undefined);
    const values = vi.fn(() => ({ onConflictDoUpdate }));
    const insert = vi.fn(() => ({ values }));
    await upsertCmsMenuSeedRows({ insert } as unknown as DbExecutor, rows);

    const submitted = values.mock.calls[0]![0];
    expect(submitted.every((row) => row.id >= 1700 && row.id < 1900)).toBe(true);
    expect(submitted.find((row) => row.id === 1745)?.permission).toBe('cms:publish:build');
    expect(onConflictDoUpdate).toHaveBeenCalledWith(expect.objectContaining({ target: expect.anything() }));
  });
});
