import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export interface NginxInfo {
  installed: boolean;
  version: string | null;
  configPath: string | null;
  sitesAvailable: string | null;
  sitesEnabled: string | null;
  runningStatus: 'running' | 'stopped' | 'unknown';
}

export interface NginxSite {
  name: string;
  enabled: boolean;
  configPath: string;
  serverName: string | null;
  listenPort: number | null;
  root: string | null;
  sslEnabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface NginxSiteDetail extends NginxSite {
  content: string;
}

export interface CreateNginxSiteValues {
  name: string;
  serverName: string;
  listenPort: number;
  type: 'static' | 'proxy';
  root?: string;
  proxyPass?: string;
  sslEnabled?: boolean;
}

export const nginxSiteKeys = {
  all: ['nginx-sites'] as const,
  lists: ['nginx-sites', 'list'] as const,
  list: () => ['nginx-sites', 'list'] as const,
  detail: (name: string | undefined) => ['nginx-sites', 'detail', name] as const,
};

export function useNginxSitesOverview() {
  return useQuery({
    queryKey: nginxSiteKeys.list(),
    queryFn: async () => {
      const [info, sites] = await Promise.all([
        request.get<NginxInfo>('/api/nginx-sites/info', { silent: true }).then(unwrap),
        request.get<NginxSite[]>('/api/nginx-sites', { silent: true }).then(unwrap),
      ]);
      return { info, sites };
    },
  });
}

export function useNginxSiteDetail(name: string | undefined, enabled = true) {
  return useQuery({
    queryKey: nginxSiteKeys.detail(name),
    queryFn: () => request.get<NginxSiteDetail>(`/api/nginx-sites/${encodeURIComponent(name ?? '')}`).then(unwrap),
    enabled: enabled && !!name,
  });
}

export function useCreateNginxSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateNginxSiteValues) =>
      request.post<null>('/api/nginx-sites', {
        name: values.name,
        serverName: values.serverName,
        listenPort: values.listenPort,
        sslEnabled: !!values.sslEnabled,
        ...(values.type === 'proxy' ? { proxyPass: values.proxyPass } : { root: values.root }),
      }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: nginxSiteKeys.all }),
  });
}

export function useUpdateNginxSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      request.put<null>(`/api/nginx-sites/${encodeURIComponent(name)}`, { content }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: nginxSiteKeys.all }),
  });
}

export function useNginxSiteAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, action }: { name: string; action: 'enable' | 'disable' | 'delete' }) =>
      (action === 'delete'
        ? request.delete<null>(`/api/nginx-sites/${encodeURIComponent(name)}`)
        : request.post<null>(`/api/nginx-sites/${encodeURIComponent(name)}/${action}`, {})
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: nginxSiteKeys.all }),
  });
}

export function useTestNginxConfig() {
  return useMutation({
    mutationFn: () => request.post<{ success: boolean; output: string }>('/api/nginx-sites/test', {}).then(unwrap),
  });
}

export function useReloadNginx() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request.post<null>('/api/nginx-sites/reload', {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: nginxSiteKeys.all }),
  });
}
