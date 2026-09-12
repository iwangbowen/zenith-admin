import { networkDiagContract, type NetDiagStreamType } from '@zenith/shared/ops';
import { urlOf, useApiMutation } from '@/lib/contract-query';

/** 诊断均为一次性查询（不进缓存），故以 mutation 形态暴露；变量即契约输入（`{ query }` / `{ body }`） */

export function useNslookup() {
  return useApiMutation(networkDiagContract.nslookup);
}

export function useDnsLookup() {
  return useApiMutation(networkDiagContract.dns);
}

export function useReverseLookup() {
  return useApiMutation(networkDiagContract.reverse);
}

export function useHttpProbe() {
  return useApiMutation(networkDiagContract.httpProbe);
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
