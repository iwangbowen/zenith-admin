import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { authContract, enterpriseAuthContract, oauthContract, type OAuthProviderType } from '@zenith/shared/identity';
import { api } from '@/lib/contract-query';

export const authPublicKeys = {
  all: ['auth-public'] as const,
  captcha: ['auth-public', 'captcha'] as const,
  enterpriseProviders: (tenantCode: string) => ['auth-public', 'enterprise-providers', tenantCode] as const,
  oauthProviders: ['auth-public', 'oauth-providers'] as const,
};

export function usePublicCaptcha() {
  return useQuery({
    queryKey: authPublicKeys.captcha,
    queryFn: () => api(authContract.captcha, { silent: true }),
  });
}

export function useEnterpriseProviders(tenantCode: string) {
  return useQuery({
    queryKey: authPublicKeys.enterpriseProviders(tenantCode),
    queryFn: () =>
      api(enterpriseAuthContract.providers, { query: { tenantCode: tenantCode || undefined } }, { silent: true })
        .catch(() => ({ tenantCode, providers: [] })),
    placeholderData: keepPreviousData,
  });
}

/**
 * 已启用的第三方登录提供方（公开接口）。
 * 后端不可达 / 接口异常时按「无可用提供方」处理（返回空数组），登录页据此整块不渲染，而不是渲染出点了就报错的入口。
 */
export function useOAuthProviders(enabled = true) {
  return useQuery({
    queryKey: authPublicKeys.oauthProviders,
    queryFn: () =>
      api(oauthContract.providers, { silent: true })
        .catch((): OAuthProviderType[] => []),
    enabled,
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (values: { email: string }) =>
      api(authContract.forgotPassword, { body: { email: values.email } }, { silent: true }),
  });
}
