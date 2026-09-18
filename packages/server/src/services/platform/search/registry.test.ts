import { describe, expect, it, vi } from 'vitest';
import type { GlobalSearchAdapter } from './types';

vi.mock('../../../lib/context', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

import { hasPermission } from '../../../lib/context';
import { globalSearchAdapters, runGlobalSearch } from './registry';

const item = (type: GlobalSearchAdapter['type'], id: string) => ({
  type,
  id,
  title: `${type}-${id}`,
  route: '/system/users',
  highlights: [],
});

function adapter(type: GlobalSearchAdapter['type'], search: GlobalSearchAdapter['search']): GlobalSearchAdapter {
  return { type, permissions: ['system:user:list'], search };
}

describe('global search adapter registry', () => {
  it('requires every registered adapter to declare a discovery permission', () => {
    expect(globalSearchAdapters.every((adapter) => adapter.permissions.length > 0)).toBe(true);
  });

  it('keeps successful results when one authorized adapter fails', async () => {
    const result = await runGlobalSearch(
      { q: 'QA', limit: 5 },
      undefined,
      [
        adapter('user', async () => [item('user', '1')]),
        adapter('member', async () => { throw new Error('simulated adapter failure'); }),
        adapter('order', async () => [item('order', '3')]),
      ],
      50,
    );

    expect(result.results.map((row) => row.id)).toEqual(['1', '3']);
    expect(result.failedTypes).toEqual(['member']);
  });

  it('times out a slow adapter without appending its late result', async () => {
    const slow = adapter('file', () => new Promise((resolve) => {
      setTimeout(() => resolve([item('file', 'late')]), 30);
    }));
    const result = await runGlobalSearch({ q: 'QA', limit: 5 }, undefined, [
      adapter('user', async () => [item('user', '1')]),
      slow,
    ], 5);

    expect(result.results.map((row) => row.id)).toEqual(['1']);
    expect(result.failedTypes).toEqual(['file']);
  });

  it('skips an adapter when its discovery permission is absent', async () => {
    vi.mocked(hasPermission).mockResolvedValueOnce(false);
    const search = vi.fn().mockResolvedValue([item('user', 'hidden')]);
    const result = await runGlobalSearch({ q: 'hidden', limit: 5 }, undefined, [adapter('user', search)]);

    expect(search).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
    expect(result.failedTypes).toEqual([]);
  });

  it('keeps other results when permission lookup itself fails', async () => {
    vi.mocked(hasPermission).mockRejectedValueOnce(new Error('permission store unavailable'));
    const result = await runGlobalSearch({ q: 'QA', limit: 5 }, undefined, [
      adapter('user', async () => [item('user', '1')]),
      adapter('member', async () => [item('member', '2')]),
    ], 50);

    expect(result.results.map((row) => row.id)).toEqual(['2']);
    expect(result.failedTypes).toEqual(['user']);
  });
});
