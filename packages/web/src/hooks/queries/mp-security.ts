import { mpSecurityContract } from '@zenith/shared/mp';
import { useApiMutation } from '@/lib/contract-query';

/** 内容安全校验是只读探测，不涉及缓存 */
export function useCheckMpContent() {
  return useApiMutation(mpSecurityContract.checkText);
}
