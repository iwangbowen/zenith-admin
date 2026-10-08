import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlobalSearchAdapter } from './types';

vi.mock('../../../lib/context', () => ({
  hasPermission: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../lib/licensing', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
}));

import { hasPermission } from '../../../lib/context';
import { isFeatureEnabled } from '../../../lib/licensing';
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
  beforeEach(() => {
    vi.mocked(hasPermission).mockReset().mockResolvedValue(true);
    vi.mocked(isFeatureEnabled).mockReset().mockResolvedValue(true);
  });

  it('requires every registered adapter to declare a discovery permission', () => {
    expect(globalSearchAdapters.every((adapter) => adapter.permissions === 'authenticated' || adapter.permissions.length > 0)).toBe(true);
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

  it.each([
    ['iot-device', 'iot'], ['iot-alarm', 'iot'], ['member', 'member'], ['order', 'payment'],
    ['workflow', 'workflow'], ['file', 'drive'], ['cms-content', 'cms'], ['wiki-document', 'wiki'],
    ['chat-message', 'chat'], ['report-dashboard', 'report'], ['report-dataset', 'report'],
    ['ai-knowledge-base', 'ai'],
  ] as const)('skips unlicensed %s searches before querying business data', async (type, feature) => {
    vi.mocked(isFeatureEnabled).mockResolvedValue(false);
    const search = vi.fn().mockResolvedValue([item(type, 'hidden')]);
    const result = await runGlobalSearch({ q: 'hidden', limit: 5 }, undefined, [adapter(type, search)]);

    expect(isFeatureEnabled).toHaveBeenCalledWith(feature);
    expect(search).not.toHaveBeenCalled();
    expect(result).toEqual({ results: [], failedTypes: [] });
  });

  it('keeps licensed searches and core results while excluding unlicensed IoT results', async () => {
    vi.mocked(isFeatureEnabled).mockImplementation(async (feature) => feature !== 'iot');
    const iotSearch = vi.fn().mockResolvedValue([item('iot-device', 'hidden')]);
    const result = await runGlobalSearch({ q: 'QA', limit: 5 }, undefined, [
      adapter('user', async () => [item('user', '1')]),
      adapter('iot-device', iotSearch),
      adapter('order', async () => [item('order', '2')]),
    ]);

    expect(iotSearch).not.toHaveBeenCalled();
    expect(result.results.map((row) => row.id)).toEqual(['1', '2']);
    expect(result.failedTypes).toEqual([]);
  });

  it.each(['user', 'announcement', 'biz-leave', 'async-task', 'operation-log', 'exception-log'] as const)(
    'keeps core %s search available without a License', async (type) => {
      vi.mocked(isFeatureEnabled).mockResolvedValue(false);
      const search = vi.fn().mockResolvedValue([item(type, 'core')]);
      const result = await runGlobalSearch({ q: 'core', limit: 5 }, undefined, [adapter(type, search)]);

      expect(isFeatureEnabled).not.toHaveBeenCalled();
      expect(search).toHaveBeenCalled();
      expect(result.results.map((row) => row.id)).toEqual(['core']);
    },
  );

  it('fails closed on a License lookup failure and keeps core results', async () => {
    vi.mocked(isFeatureEnabled).mockRejectedValueOnce(new Error('License store unavailable'));
    const search = vi.fn().mockResolvedValue([item('iot-alarm', 'hidden')]);
    const result = await runGlobalSearch({ q: 'QA', limit: 5 }, undefined, [
      adapter('iot-alarm', search),
      adapter('user', async () => [item('user', '1')]),
    ]);

    expect(search).not.toHaveBeenCalled();
    expect(result.results.map((row) => row.id)).toEqual(['1']);
    expect(result.failedTypes).toEqual(['iot-alarm']);
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

  it('deduplicates by type and ranks exact title matches first', async () => {
    const result = await runGlobalSearch({ q: 'QA', limit: 5 }, undefined, [
      adapter('user', async () => [
        { ...item('user', '1'), title: 'QA' },
        { ...item('user', '1'), title: 'QA duplicate' },
        { ...item('user', '2'), title: 'A QA result' },
      ]),
    ]);

    expect(result.results.map((row) => row.id)).toEqual(['1', '2']);
    expect(result.results[0].title).toBe('QA');
  });
});
