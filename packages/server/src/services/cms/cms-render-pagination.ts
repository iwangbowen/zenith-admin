import type { CmsPagination } from '../../cms/themes/types';

export interface BuildCmsPaginationInput {
  page: number;
  pageSize: number;
  total: number;
  makeUrl: (page: number) => string;
  windowSize?: number;
}

export function buildCmsPagination({ page, pageSize, total, makeUrl, windowSize = 5 }: BuildCmsPaginationInput): CmsPagination {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = Math.max(1, Math.min(page - Math.floor(windowSize / 2), totalPages - windowSize + 1));
  const end = Math.min(totalPages, start + windowSize - 1);
  const pages = [];
  for (let p = start; p <= end; p++) {
    pages.push({ page: p, url: makeUrl(p), current: p === page });
  }
  return {
    page,
    pageSize,
    total,
    totalPages,
    prevUrl: page > 1 ? makeUrl(page - 1) : null,
    nextUrl: page < totalPages ? makeUrl(page + 1) : null,
    pages,
  };
}
