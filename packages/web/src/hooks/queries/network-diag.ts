import { useMutation } from '@tanstack/react-query';
import { networkDiagContract, type DnsRecordType, type NetDiagStreamType } from '@zenith/shared/ops';
import { api, urlOf, useApiMutation } from '@/lib/contract-query';

export const networkDiagKeys = {
  all: ['network-diag'] as const,
};

/** 诊断均为一次性查询（不进缓存），故以 mutation 形态暴露 */

export function useNslookup() {
  return useMutation({
    mutationFn: (host: string) => api(networkDiagContract.nslookup, { query: { host } }),
  });
}

export function useDnsLookup() {
  return useMutation({
    mutationFn: ({ host, type }: { host: string; type: DnsRecordType }) => api(networkDiagContract.dns, { query: { host, type } }),
  });
}

export function useReverseLookup() {
  return useMutation({
    mutationFn: (ip: string) => api(networkDiagContract.reverse, { query: { ip } }),
  });
}

export function useHttpProbe() {
  return useMutation({
    mutationFn: (url: string) => api(networkDiagContract.httpProbe, { body: { url } }),
  });
}

export function useNetworkInterfaces() {
  return useApiMutation(networkDiagContract.interfaces);
}

export function usePortCheck() {
  return useApiMutation(networkDiagContract.portCheck);
}

/** ping / traceroute 流式地址（`streamText` 消费） */
export function networkDiagStreamUrl(type: NetDiagStreamType, host: string) {
  return urlOf(networkDiagContract.stream, { query: { type, host } });
}
