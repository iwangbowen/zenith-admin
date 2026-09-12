import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { authContract, enterpriseAuthContract, oauthContract, type OAuthProviderType } from '@zenith/shared/identity';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

const silent = { silent: true } as const;

export const authPublicKeys = {
  captcha: contractKey(authContract.captcha),
  enterpriseProviders: (tenantCode: string) =>
    contractKey(enterpriseAuthContract.providers, { query: { tenantCode: tenantCode || undefined } }),
  oauthProviders: contractKey(oauthContract.providers),
};

export function usePublicCaptcha() {
  return useApiQuery(authContract.captcha, { requestOptions: silent });
}

/**
 * H5 保留手写 useQuery：queryFn 不是单次 `api(op)`——租户发现失败时兜底为「无企业身份源」（成功态 + 空列表），
 * 登录页据此隐藏企业登录入口而不是报错；key 仍由契约派生。
 */
export function useEnterpriseProviders(tenantCode: string) {
  return useQuery({
    queryKey: authPublicKeys.enterpriseProviders(tenantCode),
    queryFn: () =>
      api(enterpriseAuthContract.providers, { query: { tenantCode: tenantCode || undefined } }, silent)
        .catch(() => ({ tenantCode, providers: [] })),
    placeholderData: keepPreviousData,
  });
}

/**
 * 已启用的第三方登录提供方（公开接口）。
 * 后端不可达 / 接口异常时按「无可用提供方」处理（返回空数组），登录页据此整块不渲染，而不是渲染出点了就报错的入口。
 *
 * H5 保留手写 useQuery：queryFn 带失败兜底，不是单次 `api(op)`；key 仍由契约派生。
 */
export function useOAuthProviders(enabled = true) {
  return useQuery({
    queryKey: authPublicKeys.oauthProviders,
    queryFn: () =>
      api(oauthContract.providers, silent)
        .catch((): OAuthProviderType[] => []),
    enabled,
  });
}

export function useForgotPassword() {
  return useApiMutation(authContract.forgotPassword, { requestOptions: silent });
}
