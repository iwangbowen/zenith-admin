// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { keepPreviousData, useMutation } from '@tanstack/react-query';
import type { BodyOf } from '@zenith/shared/core';
import { fileContract, fileStorageConfigContract } from '@zenith/shared/platform';
import { api, contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

/** 改配置可能同时改变默认项标记；文件浏览结果与配置增删改无关，不动 */
const DEFAULT_CONFIG_KEY = contractKey(fileStorageConfigContract.defaultConfig);

const crud = createResourceQueries(fileStorageConfigContract, {
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: DEFAULT_CONFIG_KEY }),
  onDeleted: (qc, ids) => {
    // 该配置下的浏览结果已无对应存储源
    for (const id of ids) qc.removeQueries({ queryKey: contractKey(fileContract.browse, { query: { storageConfigId: id } }) });
    void qc.invalidateQueries({ queryKey: DEFAULT_CONFIG_KEY });
  },
});

export const fileStorageConfigKeys = {
  ...crud.keys,
  defaultConfig: DEFAULT_CONFIG_KEY,
  browseRoot: contractKey(fileContract.browse),
  browse: (configId: number | undefined, path: string) =>
    contractKey(fileContract.browse, { query: { storageConfigId: configId ?? 0, path } }),
};

export const useFileStorageConfigList = crud.useList;
export const useFileStorageConfigDetail = crud.useDetail;
export const useSaveFileStorageConfig = crud.useSave;
export const useDeleteFileStorageConfigs = crud.useDelete;

export function useDefaultFileStorageConfig() {
  return useApiQuery(fileStorageConfigContract.defaultConfig, undefined, { staleTime: LOOKUP_STALE_TIME });
}

/** 按存储配置浏览目录；key 与 `fileStorageConfigKeys.browse(configId, path)` 一致 */
export function useStorageBrowse(configId: number | undefined, path: string, enabled = true) {
  return useApiQuery(
    fileContract.browse,
    { query: { storageConfigId: configId ?? 0, path } },
    { enabled: enabled && configId !== undefined, placeholderData: keepPreviousData },
  );
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
