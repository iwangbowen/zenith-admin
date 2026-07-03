import { useMutation } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export function useGenerateMpOAuthUrl() {
  return useMutation({
    mutationFn: (values: { accountId: number; redirectUri: string; scope: 'snsapi_base' | 'snsapi_userinfo'; state?: string }) =>
      request.post<{ url: string }>('/api/mp/oauth/url', values).then(unwrap),
  });
}

export function useGenerateMpJsConfig() {
  return useMutation({
    mutationFn: (values: { accountId: number; url: string }) =>
      request.post<{ appId: string; timestamp: number; nonceStr: string; signature: string }>('/api/mp/jssdk/config', values).then(unwrap),
  });
}
