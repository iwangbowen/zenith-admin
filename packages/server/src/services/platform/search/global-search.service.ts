import type { QueryOutputOf } from '@zenith/shared/core';
import { globalSearchContract } from '@zenith/shared/platform';
import { runGlobalSearch } from './registry';

export async function searchGlobal(query: QueryOutputOf<typeof globalSearchContract.search>) {
  const { q, limit, types } = query;
  const { results, failedTypes } = await runGlobalSearch({ q, limit }, types);
  return {
    results,
    partial: failedTypes.length > 0,
    failedTypes,
  };
}

