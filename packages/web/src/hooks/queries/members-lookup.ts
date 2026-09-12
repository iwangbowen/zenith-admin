import { memberContract } from '@zenith/shared/member';
import { contractKey, useApiQuery } from '@/lib/contract-query';

export const memberLookupKeys = {
  /** 全部关键词下的会员搜索下拉（MemberSelect 等跨页共享缓存） */
  optionsRoot: contractKey(memberContract.options),
  options: (keyword?: string) => contractKey(memberContract.options, { query: { keyword } }),
};

export function useMemberOptions(keyword?: string) {
  return useApiQuery(memberContract.options, { query: { keyword } }, { staleTime: 30_000 });
}
