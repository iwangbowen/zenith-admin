import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EmailConfig } from '@zenith/shared';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export const emailConfigKeys = {
  all: ['email-config'] as const,
  detail: () => ['email-config', 'detail'] as const,
};

export function useEmailConfig() {
  return useQuery({
    queryKey: emailConfigKeys.detail(),
    queryFn: () => request.get<EmailConfig>('/api/email-config').then(unwrap),
  });
}

export function useSaveEmailConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Partial<EmailConfig>) => request.put<EmailConfig>('/api/email-config', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: emailConfigKeys.all }),
  });
}

export function useTestEmailConfig() {
  return useMutation({
    mutationFn: (email: string) => request.post<null>('/api/email-config/test', { email }).then(unwrap),
  });
}
