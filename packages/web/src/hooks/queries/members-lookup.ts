import { useQuery } from '@tanstack/react-query';
import type { MemberOption } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export const memberLookupKeys = {
  all: ['members'] as const,
  optionsRoot: ['members', 'options'] as const,
  options: (keyword?: string) => ['members', 'options', keyword ?? ''] as const,
};

export function useMemberOptions(keyword?: string) {
  return useQuery({
    queryKey: memberLookupKeys.options(keyword),
    queryFn: () => request.get<MemberOption[]>(`/api/members/options${toQueryString({ keyword })}`).then(unwrap),
    staleTime: 30_000,
  });
}
