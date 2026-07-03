import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import type { EnterpriseIdentityDiscovery } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export interface CaptchaResult {
  captchaId: string;
  svg: string;
  enabled: boolean;
}

export const authPublicKeys = {
  all: ['auth-public'] as const,
  captcha: ['auth-public', 'captcha'] as const,
  publicConfig: (key: string) => ['auth-public', 'public-config', key] as const,
  enterpriseProviders: (tenantCode: string) => ['auth-public', 'enterprise-providers', tenantCode] as const,
};

export function usePublicCaptcha() {
  return useQuery({
    queryKey: authPublicKeys.captcha,
    queryFn: () => request.get<CaptchaResult>('/api/auth/captcha', { silent: true }).then(unwrap),
  });
}

export function usePublicSystemConfig(key: string) {
  return useQuery({
    queryKey: authPublicKeys.publicConfig(key),
    queryFn: () => request.get<{ configValue: string }>(`/api/system-configs/public/${key}`, { silent: true }).then(unwrap),
  });
}

export function useEnterpriseProviders(tenantCode: string) {
  return useQuery({
    queryKey: authPublicKeys.enterpriseProviders(tenantCode),
    queryFn: () =>
      request
        .get<EnterpriseIdentityDiscovery>(`/api/auth/enterprise/providers${toQueryString({ tenantCode })}`, { silent: true })
        .then(unwrap)
        .catch(() => ({ tenantCode, providers: [] })),
    placeholderData: keepPreviousData,
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (values: { email: string }) =>
      request.post<null>('/api/auth/forgot-password', { email: values.email }, { silent: true }).then(unwrap),
  });
}
