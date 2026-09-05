import type { QueryOf } from '@zenith/shared/core';
import { cmsErrorProneWordContract, cmsSensitiveWordContract } from '@zenith/shared/cms';
import { createResourceQueries } from '@/lib/contract-query';

export type CmsSensitiveWordListParams = NonNullable<QueryOf<typeof cmsSensitiveWordContract.list>>;

export type CmsErrorProneWordListParams = NonNullable<QueryOf<typeof cmsErrorProneWordContract.list>>;

export const {
  keys: cmsSensitiveWordKeys,
  useList: useCmsSensitiveWordList,
  useSave: useSaveCmsSensitiveWord,
  useDelete: useDeleteCmsSensitiveWords,
} = createResourceQueries(cmsSensitiveWordContract);

export const {
  keys: cmsErrorProneWordKeys,
  useList: useCmsErrorProneWordList,
  useSave: useSaveCmsErrorProneWord,
  useDelete: useDeleteCmsErrorProneWords,
} = createResourceQueries(cmsErrorProneWordContract);
