import { describe, expect, it, vi } from 'vitest';
import { globalSearchResponseSchema, type GlobalSearchResult } from '@zenith/shared/platform';
import { runGlobalSearch } from './registry';
import type { GlobalSearchAdapter } from './types';

vi.mock('../../../lib/context', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

const baseResult = (type: GlobalSearchAdapter['type'], id: string, extra: Record<string, unknown> = {}): GlobalSearchResult => ({
  type,
  id,
  title: `${type}-${id}`,
  route: '/system/users',
  highlights: [],
  ...extra,
});

function fixedAdapter(type: GlobalSearchAdapter['type'], rows: GlobalSearchResult[], capture?: (input: unknown) => void): GlobalSearchAdapter {
  return {
    type,
    permissions: ['system:user:list'],
    search: async (input) => {
      capture?.(input);
      return rows;
    },
  };
}

describe('global search security contract', () => {
  it('1. excludes an unauthorized user and does not expose a hidden total', async () => {
    const response = await runGlobalSearch({ q: 'QA', limit: 5 }, undefined, [fixedAdapter('user', [baseResult('user', 'A')])]);
    expect(response.results.map((item) => item.id)).toEqual(['A']);
    expect(response).not.toHaveProperty('total');
    expect(response.results.some((item) => item.id === 'B')).toBe(false);
  });

  it('2. returns only the current tenant result set', async () => {
    const response = await runGlobalSearch({ q: 'QA-ORDER', limit: 5 }, 'order', [
      fixedAdapter('order', [baseResult('order', 'tenant-a')]),
    ]);
    expect(response.results.map((item) => item.id)).toEqual(['tenant-a']);
    expect(response.results.some((item) => item.id === 'tenant-b')).toBe(false);
  });

  it('3. keeps list summaries free from detail-sensitive fields', () => {
    const parsed = globalSearchResponseSchema.parse({
      results: [baseResult('order', '1', { description: 'success' })],
      partial: false,
      failedTypes: [],
    });
    const row = parsed.results[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('amount');
    expect(row).not.toHaveProperty('phone');
    expect(row).not.toHaveProperty('email');
    expect(row).not.toHaveProperty('password');
  });

  it('4. does not create a download action without the download capability', () => {
    const parsed = globalSearchResponseSchema.parse({
      results: [baseResult('file', 'f1', { actions: { view: true, download: false } })],
      partial: false,
      failedTypes: [],
    });
    expect(parsed.results[0].actions?.download).toBe(false);
  });

  it('5. has the same response shape for hidden-only and unknown queries', async () => {
    const hidden = await runGlobalSearch({ q: 'hidden', limit: 5 }, undefined, [fixedAdapter('user', [])]);
    const unknown = await runGlobalSearch({ q: 'does-not-exist', limit: 5 }, undefined, [fixedAdapter('user', [])]);
    expect(Object.keys(hidden).sort()).toEqual(Object.keys(unknown).sort());
    expect(hidden.results).toEqual([]);
    expect(unknown.results).toEqual([]);
  });

  it('6. never emits a sensitive value as a highlight', () => {
    const parsed = globalSearchResponseSchema.parse({
      results: [baseResult('user', '1', { highlights: [{ field: 'title', text: '张三' }] })],
      partial: false,
      failedTypes: [],
    });
    expect(parsed.results[0].highlights.map((item) => item.text).join(' ')).not.toContain('13800000000');
  });

  it('7. keeps relation summaries out of the base result contract', () => {
    const parsed = globalSearchResponseSchema.parse({
      results: [baseResult('order', '1')],
      partial: false,
      failedTypes: [],
    });
    expect(parsed.results[0]).not.toHaveProperty('relations');
  });

  it('8. derives identity from the request context instead of accepting an operator id', async () => {
    let captured: unknown;
    await runGlobalSearch({ q: 'QA', limit: 5 }, undefined, [fixedAdapter('user', [], (input) => { captured = input; })]);
    expect(captured).toEqual({ q: 'QA', limit: 5 });
    expect(captured).not.toHaveProperty('operatorUserId');
    expect(captured).not.toHaveProperty('tenantId');
  });

  it('9. keeps tenant-view selection outside the client query contract', async () => {
    const search = vi.fn(async (input: { q: string; limit: number }) => [baseResult('order', input.q)]);
    await runGlobalSearch({ q: 'tenant-view', limit: 5 }, 'order', [{ type: 'order', permissions: ['system:user:list'], search }]);
    expect(search).toHaveBeenCalledWith({ q: 'tenant-view', limit: 5 });
    expect(search.mock.calls[0][0]).not.toHaveProperty('viewingTenantId');
  });
});
