import type { GlobalSearchResult, GlobalSearchType } from '@zenith/shared/platform';
import type { Permission } from '@zenith/shared/core';

export interface GlobalSearchInput {
  readonly q: string;
  readonly limit: number;
}

export interface GlobalSearchAdapter {
  readonly type: GlobalSearchType;
  readonly permissions: readonly [Permission, ...Permission[]];
  readonly search: (input: GlobalSearchInput) => Promise<GlobalSearchResult[]>;
}
