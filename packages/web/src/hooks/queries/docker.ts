// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { dockerContract } from '@zenith/shared/ops';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export const dockerKeys = {
  containers: contractKey(dockerContract.containers),
  images: contractKey(dockerContract.images),
  networks: contractKey(dockerContract.networks),
  volumes: contractKey(dockerContract.volumes),
  stats: (id: string | undefined) => contractKey(dockerContract.stats, { params: { id: id ?? '' } }),
  /** 某容器的全部目录浏览（`query: {}` 对任何 path 都子集匹配） */
  filesOf: (containerId: string) => contractKey(dockerContract.containerFiles, { params: { id: containerId }, query: {} }),
  files: (containerId: string, path: string) => contractKey(dockerContract.containerFiles, { params: { id: containerId }, query: { path } }),
};

/**
 * 启停 / 重启只改容器自身：容器清单的状态列与该容器的容器内目录浏览（停止后不可读；资源占用按需拉取不进缓存）；
 * 镜像 / 网络 / 存储卷清单与其占用计数都不变。终端页 Docker Explorer 与 Docker 管理页共用。
 */
export function invalidateAfterContainerStateChange(qc: QueryClient, id: string) {
  void qc.invalidateQueries({ queryKey: dockerKeys.containers });
  void qc.invalidateQueries({ queryKey: dockerKeys.filesOf(id) });
}

/**
 * 清理会跨资源改变占用计数：删掉停止的容器后镜像 / 网络 / 存储卷的 containers / 使用中标记随之变化，
 * `system` 更是一次动三类资源——四张清单都需回源；容器级的 stats / 目录浏览只属于仍在运行的容器，不受影响。
 */
export function invalidateDockerInventory(qc: QueryClient) {
  for (const queryKey of [dockerKeys.containers, dockerKeys.images, dockerKeys.networks, dockerKeys.volumes]) {
    void qc.invalidateQueries({ queryKey });
  }
}

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

/** H5：start / stop / restart 三条同形操作按动作分派，页面以 `{ id, action }` 一个变量驱动行级忙碌态 */
export function useDockerContainerAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: string; action: DockerContainerAction }) => api(CONTAINER_ACTION_OPS[action], { params: { id } }),
    onSuccess: (_data, { id }) => invalidateAfterContainerStateChange(qc, id),
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

/** H5：五个清理范围分派到五条操作，页面以 `{ scope, all }` 一个变量驱动；失效面见 invalidateDockerInventory */
export function useDockerPrune() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ scope, all }: DockerPruneVariables) => {
      switch (scope) {
        case 'containers': return api(dockerContract.pruneContainers);
        case 'images': return api(dockerContract.pruneImages, { query: { all: all || undefined } });
        case 'networks': return api(dockerContract.pruneNetworks);
        case 'volumes': return api(dockerContract.pruneVolumes);
        case 'system': return api(dockerContract.pruneSystem);
      }
    },
    onSuccess: () => invalidateDockerInventory(qc),
  });
}

export function useDockerFetchStats() {
  return useApiMutation(dockerContract.stats);
}

export function useDockerInspect() {
  return useApiMutation(dockerContract.inspect);
}
