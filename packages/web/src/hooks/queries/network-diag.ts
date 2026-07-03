import { useMutation } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export type DnsType = 'A' | 'AAAA' | 'MX' | 'TXT' | 'NS' | 'CNAME' | 'SOA';

export interface HttpProbeResult {
  ok: boolean;
  status: number;
  statusText: string;
  latencyMs: number;
  server: string | null;
  contentType: string | null;
  contentLength: string | null;
  redirectLocation: string | null;
  error: string | null;
}

export interface NetworkInterfaceInfo {
  name: string;
  address: string;
  netmask: string;
  family: string;
  mac: string;
  internal: boolean;
  cidr: string | null;
}

export const networkDiagKeys = {
  all: ['network-diag'] as const,
};

export function useNslookup() {
  return useMutation({
    mutationFn: (host: string) =>
      request.get<{ output: string }>(`/api/network-diag/nslookup?host=${encodeURIComponent(host)}`).then(unwrap),
  });
}

export function useDnsLookup() {
  return useMutation({
    mutationFn: ({ host, type }: { host: string; type: DnsType }) =>
      request.get<{ type: string; records: string[] }>(`/api/network-diag/dns?host=${encodeURIComponent(host)}&type=${type}`).then(unwrap),
  });
}

export function useReverseLookup() {
  return useMutation({
    mutationFn: (ip: string) =>
      request.get<{ hostnames: string[] }>(`/api/network-diag/reverse?ip=${encodeURIComponent(ip)}`).then(unwrap),
  });
}

export function useHttpProbe() {
  return useMutation({
    mutationFn: (url: string) => request.post<HttpProbeResult>('/api/network-diag/http-probe', { url }).then(unwrap),
  });
}

export function useNetworkInterfaces() {
  return useMutation({
    mutationFn: () => request.get<NetworkInterfaceInfo[]>('/api/network-diag/interfaces').then(unwrap),
  });
}

export function usePortCheck() {
  return useMutation({
    mutationFn: ({ host, port }: { host: string; port: number }) =>
      request.post<{ open: boolean; latencyMs: number }>('/api/network-diag/port-check', { host, port }).then(unwrap),
  });
}
