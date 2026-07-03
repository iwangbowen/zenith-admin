import { useMutation } from '@tanstack/react-query';
import type { CheckMpContentInput } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export interface MpContentCheckResult {
  pass: boolean;
  suggest: string;
}

export const mpSecurityKeys = {
  all: ['mp', 'security'] as const,
};

export function useCheckMpContent() {
  return useMutation({
    mutationFn: (values: CheckMpContentInput) => request.post<MpContentCheckResult>('/api/mp/security/check-text', values).then(unwrap),
  });
}
