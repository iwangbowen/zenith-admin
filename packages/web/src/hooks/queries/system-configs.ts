import { useQuery } from '@tanstack/react-query';
import { LOOKUP_STALE_TIME, unwrap } from '@/lib/query';
import { request } from '@/utils/request';
import type { PasswordPolicy } from '@/utils/password-policy';

export const systemConfigKeys = {
  all: ['system-configs'] as const,
  passwordPolicy: ['system-configs', 'password-policy'] as const,
};

export function useSystemPasswordPolicy() {
  return useQuery({
    queryKey: systemConfigKeys.passwordPolicy,
    queryFn: () => request.get<PasswordPolicy>('/api/system-configs/password-policy').then(unwrap),
    staleTime: LOOKUP_STALE_TIME,
  });
}
