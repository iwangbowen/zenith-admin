import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, tenantScope } = vi.hoisted(() => ({
  execute: vi.fn(async () => []),
  tenantScope: vi.fn(() => undefined as unknown),
}));

vi.mock('../../db', () => ({ db: { execute } }));
vi.mock('../../lib/tenant', () => ({ tenantScope }));

import { getPathAnalysis } from './analytics.service';

describe('getPathAnalysis — 起点筛选统计口径', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue([
      { source: '/a', target: '/b', value: 5 },
      { source: '/b', target: '/c', value: 3 },
      { source: '/c', target: '$exit', value: 2 },
      { source: '/other', target: '/unrelated', value: 7 },
    ]);
  });

  it('uses the reachable subgraph total when a start page is selected', async () => {
    const result = await getPathAnalysis({ days: 7, startPage: '/a', limit: 30 });

    expect(result.totalTransitions).toBe(10);
    expect(result.links.every((link) => ['/a', '/b', '/c', '$exit'].includes(link.source))).toBe(true);
  });
});
