import { keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';
import { dockerContract } from '@zenith/shared/ops';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const dockerKeys = {
  all: ['docker'] as const,
  containers: contractKey(dockerContract.containers),
  images: contractKey(dockerContract.images),
  networks: contractKey(dockerContract.networks),
  volumes: contractKey(dockerContract.volumes),
  stats: (id: string | undefined) => contractKey(dockerContract.stats, { params: { id: id ?? '' } }),
  files: (containerId: string, path: string) => contractKey(dockerContract.containerFiles, { params: { id: containerId }, query: { path } }),
};

export function useDockerContainers(options?: { enabled?: boolean; silent?: boolean; refetchInterval?: number | false }) {
  return useApiQuery(dockerContract.containers, {
    requestOptions: { silent: options?.silent },
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    placeholderData: keepPreviousData,
  });
}

/** 容器清单同时充当 Docker 可用性探测（daemon 不可达时服务端回 503） */
export function useDockerAvailable() {
  return useApiQuery(dockerContract.containers, { requestOptions: { silent: true } });
}

export function useDockerImages() {
  return useApiQuery(dockerContract.images, { placeholderData: keepPreviousData });
}

export function useDockerNetworks() {
  return useApiQuery(dockerContract.networks, { placeholderData: keepPreviousData });
}

export function useDockerVolumes() {
  return useApiQuery(dockerContract.volumes, { placeholderData: keepPreviousData });
}

export type DockerContainerAction = 'start' | 'stop' | 'restart';

const CONTAINER_ACTION_OPS = {
  start: dockerContract.start,
  stop: dockerContract.stop,
  restart: dockerContract.restart,
} as const;

/** 启停只改容器状态：镜像 / 网络 / 存储卷清单与其占用计数都不变 */
export function useDockerContainerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: DockerContainerAction }) => api(CONTAINER_ACTION_OPS[action], { params: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: dockerKeys.containers }),
  });
}

/** 容器日志（末尾 N 行）；日志抽屉按固定间隔轮询，不进缓存 */
export function fetchDockerContainerLogs(id: string, tail: number) {
  return api(dockerContract.logs, { params: { id }, query: { tail } });
}

export function useDockerRemoveImage() {
  return useApiMutation(dockerContract.removeImage, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dockerKeys.images });
    },
  });
}

export function useDockerPullImage() {
  return useApiMutation(dockerContract.pullImage, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dockerKeys.images });
    },
  });
}

export function useDockerCreateNetwork() {
  return useApiMutation(dockerContract.createNetwork, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dockerKeys.networks });
    },
  });
}

export function useDockerRemoveNetwork() {
  return useApiMutation(dockerContract.removeNetwork, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dockerKeys.networks });
    },
  });
}

export function useDockerCreateVolume() {
  return useApiMutation(dockerContract.createVolume, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dockerKeys.volumes });
    },
  });
}

export function useDockerRemoveVolume() {
  return useApiMutation(dockerContract.removeVolume, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: dockerKeys.volumes });
    },
  });
}

export type DockerPruneScope = 'containers' | 'images' | 'networks' | 'volumes' | 'system';

export interface DockerPruneVariables {
  scope: DockerPruneScope;
  /** 仅 images：true 清理全部未使用镜像，缺省只清理悬空镜像 */
  all?: boolean;
}

/**
 * 清理：`system` 一次清理已停止容器 + 悬空镜像 + 未使用网络，
 * 各范围对其他资源的占用计数亦有影响，故保留域根广播。
 */
export function useDockerPrune() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ scope, all }: DockerPruneVariables) => {
      switch (scope) {
        case 'containers': return api(dockerContract.pruneContainers);
        case 'images': return api(dockerContract.pruneImages, { query: all ? { all: 'true' } : {} });
        case 'networks': return api(dockerContract.pruneNetworks);
        case 'volumes': return api(dockerContract.pruneVolumes);
        case 'system': return api(dockerContract.pruneSystem);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: dockerKeys.all }),
  });
}

export function useDockerFetchStats() {
  return useApiMutation(dockerContract.stats);
}

export function useDockerInspect() {
  return useApiMutation(dockerContract.inspect);
}
