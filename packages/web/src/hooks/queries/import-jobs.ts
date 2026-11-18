import { resourceKeyOf } from '@zenith/shared/core';
import { asyncTaskContract, importJobContract } from '@zenith/shared/tasks';
import type { InputOf } from '@zenith/shared/core';
import { contractKey, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { request } from '@/utils/request';
import { asyncTaskKeys } from './async-tasks';

export const importJobKeys = {
  all: [resourceKeyOf(importJobContract.basePath)] as const,
  entities: contractKey(importJobContract.entities),
  stats: contractKey(importJobContract.stats),
};

/** 可导入实体（按权限过滤，登录期内稳定） */
export function useImportEntities(enabled = true) {
  return useApiQuery(importJobContract.entities, {
    staleTime: 5 * 60_000,
    enabled,
    requestOptions: { silent: true },
  });
}

/** 导入中心统计概览（普通用户只统计本人任务） */
export function useImportJobStats() {
  return useApiQuery(importJobContract.stats, { requestOptions: { silent: true } });
}

/** 提交导入任务（文件先经文件中心 `fileContract.upload` 上传拿 fileId）；导入历史是任务中心的 data-import 过滤视图 */
export function useSubmitImportJob() {
  return useApiMutation(importJobContract.submit, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.lists });
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.stats });
      void qc.invalidateQueries({ queryKey: importJobKeys.stats });
    },
  });
}

export function useInspectImportJob() {
  return useApiMutation(importJobContract.inspect);
}

export function useConfirmImportJob() {
  return useApiMutation(importJobContract.confirm, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.lists });
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.stats });
      void qc.invalidateQueries({ queryKey: importJobKeys.stats });
    },
  });
}

export type ImportInspectionInput = InputOf<typeof importJobContract.inspect>;

/** 导入任务详情轮询（运行期 1s 一拉，终态停止） */
export function useImportTaskPolling(taskId: number | null) {
  return useApiQuery(asyncTaskContract.detail, { params: { id: taskId ?? 0 } }, {
    enabled: taskId !== null,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' || status === 'running' ? 1000 : false;
    },
    requestOptions: { silent: true },
  });
}

/** 下载导入模板（带鉴权的二进制下载） */
export function downloadImportTemplate(entity: string, title: string) {
  return request.download(urlOf(importJobContract.template, { params: { entity } }), `${title}导入模板.xlsx`);
}

export function downloadImportErrorFile(taskId: number, filename = '导入错误行.xlsx') {
  return request.download(urlOf(importJobContract.errorFile, { params: { id: taskId } }), filename);
}
