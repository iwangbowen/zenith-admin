import { mpJsSdkContract, mpOAuthContract } from '@zenith/shared/mp';
import { useApiMutation } from '@/lib/contract-query';

/** 生成授权链接 / JS-SDK 签名都是无副作用的计算，不涉及缓存 */
export function useGenerateMpOAuthUrl() {
  return useApiMutation(mpOAuthContract.buildUrl);
}

export function useGenerateMpJsConfig() {
  return useApiMutation(mpJsSdkContract.config);
}
