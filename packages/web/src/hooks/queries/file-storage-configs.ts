// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { keepPreviousData, useMutation } from '@tanstack/react-query';
import type { BodyOf } from '@zenith/shared/core';
import { fileContract, fileStorageConfigContract, type StorageBrowseMode } from '@zenith/shared/platform';
import { api, contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

/** 改配置可能同时改变默认项标记；文件浏览结果与配置增删改无关，不动 */
const DEFAULT_CONFIG_KEY = contractKey(fileStorageConfigContract.defaultConfig);

const FILE_LIST_KEY = contractKey(fileContract.list);
const FILE_DETAIL_KEY = contractKey(fileContract.detail);
const FILE_STATS_KEY = contractKey(fileContract.stats);

function invalidateStorageBrowse(qc: import('@tanstack/react-query').QueryClient, configId: number) {
  if (!configId) return;
  void qc.invalidateQueries({ queryKey: contractKey(fileContract.browseStorage, { query: { storageConfigId: configId } }) });
  void qc.invalidateQueries({ queryKey: contractKey(fileContract.browse, { query: { storageConfigId: configId } }) });
  void qc.invalidateQueries({ queryKey: FILE_LIST_KEY });
  void qc.invalidateQueries({ queryKey: FILE_DETAIL_KEY });
  void qc.invalidateQueries({ queryKey: FILE_STATS_KEY });
}

function bodyConfigId(body: unknown): number {
  const value = (body as { storageConfigId?: unknown } | undefined)?.storageConfigId;
  const id = Number(value);
  return Number.isFinite(id) ? id : 0;
}

const crud = createResourceQueries(fileStorageConfigContract, {
  onSaved: (qc) => {
    void qc.invalidateQueries({ queryKey: DEFAULT_CONFIG_KEY });
    // 下载方式/对象 ACL 改变会影响已有文件的 directUrl
    void qc.invalidateQueries({ queryKey: FILE_LIST_KEY });
    void qc.invalidateQueries({ queryKey: FILE_DETAIL_KEY });
  },
  onDeleted: (qc, ids) => {
    // 该配置下的浏览结果已无对应存储源
    for (const id of ids) {
      qc.removeQueries({ queryKey: contractKey(fileContract.browse, { query: { storageConfigId: id } }) });
      qc.removeQueries({ queryKey: contractKey(fileContract.browseStorage, { query: { storageConfigId: id } }) });
    }
    void qc.invalidateQueries({ queryKey: DEFAULT_CONFIG_KEY });
  },
});

export const fileStorageConfigKeys = {
  ...crud.keys,
  defaultConfig: DEFAULT_CONFIG_KEY,
  browseRoot: contractKey(fileContract.browseStorage),
  browse: (configId: number | undefined, path: string, mode: StorageBrowseMode = 'all', cursor?: string, limit = 100) =>
    contractKey(fileContract.browseStorage, { query: { storageConfigId: configId ?? 0, path, mode, cursor, limit } }),
};

export const useFileStorageConfigList = crud.useList;
export const useFileStorageConfigDetail = crud.useDetail;
export const useSaveFileStorageConfig = crud.useSave;
export const useDeleteFileStorageConfigs = crud.useDelete;

export function useDefaultFileStorageConfig() {
  return useApiQuery(fileStorageConfigContract.defaultConfig, undefined, { staleTime: LOOKUP_STALE_TIME });
}

/** 按存储配置浏览目录；mode=registered 时由服务端走数据库，其它模式走真实存储对象 */
export function useStorageBrowse(
  configId: number | undefined,
  path: string,
  mode: StorageBrowseMode,
  cursor?: string,
  limit = 100,
  enabled = true,
  legacyRegistered = false,
) {
  const useLegacy = legacyRegistered && mode === 'registered';
  const legacy = useApiQuery(
    fileContract.browse,
    { query: { storageConfigId: configId ?? 0, path } },
    { enabled: enabled && configId !== undefined && useLegacy, placeholderData: keepPreviousData },
  );
  const modern = useApiQuery(
    fileContract.browseStorage,
    { query: { storageConfigId: configId ?? 0, path, mode, cursor, limit } },
    { enabled: enabled && configId !== undefined && !useLegacy, placeholderData: keepPreviousData },
  );
  return useLegacy ? legacy : modern;
}

export function useRegisterStorageObject() {
  return useApiMutation(fileContract.registerStorageObject, {
    invalidate: (qc, _saved, vars) => invalidateStorageBrowse(qc, bodyConfigId(vars.body)),
  });
}

export function useRegisterStorageObjects() {
  return useApiMutation(fileContract.registerStorageObjects, {
    invalidate: (qc, _saved, vars) => invalidateStorageBrowse(qc, bodyConfigId(vars.body)),
  });
}

export function useRemoveStorageObject() {
  return useApiMutation(fileContract.removeStorageObject, {
    invalidate: (qc, _saved, vars) => invalidateStorageBrowse(qc, bodyConfigId(vars.body)),
  });
}

export function useRemoveStorageObjects() {
  return useApiMutation(fileContract.removeStorageObjects, {
    invalidate: (qc, _saved, vars) => invalidateStorageBrowse(qc, bodyConfigId(vars.body)),
  });
}

/** 默认项切换会同时改变旧默认项，故刷新整个列表 */
export function useSetDefaultFileStorageConfig() {
  return useApiMutation(fileStorageConfigContract.setDefault, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: fileStorageConfigKeys.lists });
      void qc.invalidateQueries({ queryKey: fileStorageConfigKeys.defaultConfig });
    },
  });
}

/** 无 id 测试表单中的新配置；有 id 在已保存配置上叠加表单值测试（密钥留空沿用原值） */
export type TestFileStorageConfigVariables =
  | { id?: undefined; values: BodyOf<typeof fileStorageConfigContract.test> }
  | { id: number; values: BodyOf<typeof fileStorageConfigContract.testExisting> };

export function useTestFileStorageConfig() {
  return useMutation<null, Error, TestFileStorageConfigVariables>({
    mutationFn: (vars) => (vars.id === undefined
      ? api(fileStorageConfigContract.test, { body: vars.values })
      : api(fileStorageConfigContract.testExisting, { params: { id: vars.id }, body: vars.values })),
  });
}

/** Bucket 权限探测 / 修改会同时改变详情中的云端状态字段，精确失效列表与当前详情 */
export function useProbeFileStorageConfigBucketAccess() {
  return useApiMutation(fileStorageConfigContract.probeBucketAccess, {
    invalidate: (qc, _output, vars) => {
      void qc.invalidateQueries({ queryKey: fileStorageConfigKeys.lists });
      void qc.invalidateQueries({ queryKey: fileStorageConfigKeys.detail(vars.params.id) });
      void qc.invalidateQueries({ queryKey: FILE_LIST_KEY });
      void qc.invalidateQueries({ queryKey: FILE_DETAIL_KEY });
    },
  });
}

export function useProbeDraftFileStorageConfigBucketAccess() {
  return useApiMutation(fileStorageConfigContract.probeDraftBucketAccess);
}

export function useUpdateDraftFileStorageConfigBucketAccess() {
  return useApiMutation(fileStorageConfigContract.updateDraftBucketAccess);
}

export function useUpdateFileStorageConfigBucketAccess() {
  return useApiMutation(fileStorageConfigContract.updateBucketAccess, {
    invalidate: (qc, _output, vars) => {
      void qc.invalidateQueries({ queryKey: fileStorageConfigKeys.lists });
      void qc.invalidateQueries({ queryKey: fileStorageConfigKeys.detail(vars.params.id) });
      void qc.invalidateQueries({ queryKey: FILE_LIST_KEY });
      void qc.invalidateQueries({ queryKey: FILE_DETAIL_KEY });
    },
  });
}
