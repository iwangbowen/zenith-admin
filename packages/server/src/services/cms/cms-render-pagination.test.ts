import { describe, expect, it } from 'vitest';
import { buildCmsPagination } from './cms-render-pagination';

describe('buildCmsPagination', () => {
  const pages = (page: number, total: number, pageSize = 10, windowSize = 5) => buildCmsPagination({
    page,
    pageSize,
    total,
    windowSize,
    makeUrl: (p) => `/items/page/${p}`,
  }).pages;

  it('centres a five-page window while clamping to the start and end', () => {
    expect(pages(1, 100).map((item) => item.page)).toEqual([1, 2, 3, 4, 5]);
    expect(pages(3, 100).map((item) => item.page)).toEqual([1, 2, 3, 4, 5]);
    expect(pages(5, 100).map((item) => item.page)).toEqual([3, 4, 5, 6, 7]);
    expect(pages(9, 100).map((item) => item.page)).toEqual([6, 7, 8, 9, 10]);
    expect(pages(10, 100).map((item) => item.page)).toEqual([6, 7, 8, 9, 10]);
  });

  it('keeps current flags and prev/next URLs byte-compatible with callers', () => {
    const result = buildCmsPagination({ page: 4, pageSize: 10, total: 100, makeUrl: (p) => `/tags/${p}` });
    expect(result.prevUrl).toBe('/tags/3');
    expect(result.nextUrl).toBe('/tags/5');
    expect(result.pages).toEqual([
      { page: 2, url: '/tags/2', current: false },
      { page: 3, url: '/tags/3', current: false },
      { page: 4, url: '/tags/4', current: true },
      { page: 5, url: '/tags/5', current: false },
      { page: 6, url: '/tags/6', current: false },
    ]);
  });

  it('uses one page for empty totals', () => {
    expect(buildCmsPagination({ page: 1, pageSize: 20, total: 0, makeUrl: (p) => `/p/${p}` })).toMatchObject({
      totalPages: 1,
      prevUrl: null,
      nextUrl: null,
      pages: [{ page: 1, url: '/p/1', current: true }],
    });
  });
});
