import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { OAuthConfig, OAuthProviderType } from '@zenith/shared';
import { unwrap } from '@/lib/query';
import { request } from '@/utils/request';

export const oauthConfigKeys = {
  all: ['oauth-config'] as const,
  lists: ['oauth-config', 'list'] as const,
  list: () => ['oauth-config', 'list'] as const,
  detail: (provider: OAuthProviderType | undefined) => ['oauth-config', 'detail', provider] as const,
};

export function useOAuthConfigs() {
  return useQuery({
    queryKey: oauthConfigKeys.list(),
    queryFn: () => request.get<OAuthConfig[]>('/api/oauth-config').then(unwrap),
  });
}

export function useSaveOAuthConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ provider, values }: { provider: OAuthProviderType; values: Record<string, unknown> }) =>
      request.put<OAuthConfig>(`/api/oauth-config/${provider}`, values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: oauthConfigKeys.all }),
  });
}
