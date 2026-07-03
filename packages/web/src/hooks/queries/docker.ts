import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export interface PortBinding { privatePort: number; publicPort?: number; type: string }
export interface ContainerInfo {
  id: string; shortId: string; names: string[]; image: string; imageId: string;
  command: string; created: number; state: string; status: string;
  ports: PortBinding[]; composeProject: string | null; composeService: string | null;
}
export interface StatsInfo { cpuPercent: number; memUsage: number; memLimit: number }
export interface ImageInfo { id: string; shortId: string; repoTags: string[]; size: number; created: number; containers: number }
export interface NetworkInfo {
  id: string; name: string; driver: string; scope: string;
  ipam: { driver: string; subnet?: string; gateway?: string };
  internal: boolean; created: string; containers: number;
}
export interface VolumeInfo { name: string; driver: string; mountpoint: string; scope: string; created: string; labels: Record<string, string> }
export interface DockerFileEntry { name: string; path: string; type: 'file' | 'dir' | 'symlink' }
export interface PruneResultData {
  containersDeleted?: number; imagesDeleted?: number; networksDeleted?: number; volumesDeleted?: number; spaceReclaimed?: number;
}

export const dockerKeys = {
  all: ['docker'] as const,
  containers: ['docker', 'containers'] as const,
  images: ['docker', 'images'] as const,
  networks: ['docker', 'networks'] as const,
  volumes: ['docker', 'volumes'] as const,
  stats: (id: string | undefined) => ['docker', 'stats', id] as const,
  files: (containerId: string, path: string) => ['docker', 'files', containerId, path] as const,
};

export function useDockerContainers(options?: { enabled?: boolean; silent?: boolean; refetchInterval?: number | false }) {
  return useQuery({
    queryKey: dockerKeys.containers,
    queryFn: () => request.get<ContainerInfo[]>('/api/docker', { silent: options?.silent }).then(unwrap),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    placeholderData: keepPreviousData,
  });
}

export function useDockerAvailable() {
  return useQuery({
    queryKey: dockerKeys.containers,
    queryFn: () => request.get<ContainerInfo[]>('/api/docker', { silent: true }).then(unwrap),
  });
}

export function useDockerImages() {
  return useQuery({
    queryKey: dockerKeys.images,
    queryFn: () => request.get<ImageInfo[]>('/api/docker/images').then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useDockerNetworks() {
  return useQuery({
    queryKey: dockerKeys.networks,
    queryFn: () => request.get<NetworkInfo[]>('/api/docker/networks').then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useDockerVolumes() {
  return useQuery({
    queryKey: dockerKeys.volumes,
    queryFn: () => request.get<VolumeInfo[]>('/api/docker/volumes').then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useDockerContainerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'stop' | 'restart' }) =>
      request.post<null>(`/api/docker/${id}/${action}`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dockerKeys.all }),
  });
}

export function useDockerRemoveImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request.delete<null>(`/api/docker/images/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dockerKeys.all }),
  });
}

export function useDockerPullImage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoTag: string) => request.post<null>('/api/docker/images/pull', { repoTag }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dockerKeys.all }),
  });
}

export function useDockerCreateNetwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { name: string; driver: string; internal: boolean }) =>
      request.post<null>('/api/docker/networks', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dockerKeys.all }),
  });
}

export function useDockerRemoveNetwork() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request.delete<null>(`/api/docker/networks/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dockerKeys.all }),
  });
}

export function useDockerCreateVolume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: { name: string; driver: string }) => request.post<null>('/api/docker/volumes', values).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dockerKeys.all }),
  });
}

export function useDockerRemoveVolume() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => request.delete<null>(`/api/docker/volumes/${name}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dockerKeys.all }),
  });
}

export function useDockerPrune() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string) => request.post<PruneResultData>(url).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: dockerKeys.all }),
  });
}

export function useDockerFetchStats() {
  return useMutation({
    mutationFn: (id: string) => request.get<StatsInfo>(`/api/docker/${id}/stats`).then(unwrap),
  });
}

export function useDockerInspect() {
  return useMutation({
    mutationFn: (id: string) => request.get<Record<string, unknown>>(`/api/docker/${id}/inspect`).then(unwrap),
  });
}
