import { keepPreviousData } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { cmsSeoContract } from '@zenith/shared/cms';
import { useSaveMutation, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type CmsSeoListParams = NonNullable<QueryOf<typeof cmsSeoContract.redirectList>>;

export type CmsPushLogListParams = NonNullable<QueryOf<typeof cmsSeoContract.pushLogs>>;

export const cmsRedirectKeys = {
  lists: contractKey(cmsSeoContract.redirectList),
  list: (params: CmsSeoListParams) => contractKey(cmsSeoContract.redirectList, { query: params }),
};

export const cmsLinkWordKeys = {
  lists: contractKey(cmsSeoContract.linkWordList),
  list: (params: CmsSeoListParams) => contractKey(cmsSeoContract.linkWordList, { query: params }),
};

export const cmsPushLogKeys = {
  lists: contractKey(cmsSeoContract.pushLogs),
  list: (params: CmsPushLogListParams) => contractKey(cmsSeoContract.pushLogs, { query: params }),
};

// ─── 301 重定向 ───────────────────────────────────────────────────────────────
export function useCmsRedirectList(params: CmsSeoListParams, enabled = true) {
  return useApiQuery(cmsSeoContract.redirectList, { query: params }, {
    placeholderData: keepPreviousData,
    enabled,
  });
}

export type CmsRedirectSaveValues = Partial<BodyOf<typeof cmsSeoContract.redirectCreate>>;

export function useSaveCmsRedirect() {
  return useSaveMutation(cmsSeoContract.redirectCreate, cmsSeoContract.redirectUpdate, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsRedirectKeys.lists }),
  });
}

export function useDeleteCmsRedirect() {
  return useApiMutation(cmsSeoContract.redirectRemove, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsRedirectKeys.lists }),
  });
}

// ─── 内链词 ───────────────────────────────────────────────────────────────────
export function useCmsLinkWordList(params: CmsSeoListParams, enabled = true) {
  return useApiQuery(cmsSeoContract.linkWordList, { query: params }, {
    placeholderData: keepPreviousData,
    enabled,
  });
}

export type CmsLinkWordSaveValues = Partial<BodyOf<typeof cmsSeoContract.linkWordCreate>>;

export function useSaveCmsLinkWord() {
  return useSaveMutation(cmsSeoContract.linkWordCreate, cmsSeoContract.linkWordUpdate, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsLinkWordKeys.lists }),
  });
}

export function useDeleteCmsLinkWord() {
  return useApiMutation(cmsSeoContract.linkWordRemove, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsLinkWordKeys.lists }),
  });
}

// ─── 搜索引擎推送 / 死链检测 ──────────────────────────────────────────────────
export function useCmsPushLogList(params: CmsPushLogListParams, enabled = true) {
  return useApiQuery(cmsSeoContract.pushLogs, { query: params }, {
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** 推送完成后会追加推送日志 */
export function useCmsPush() {
  return useApiMutation(cmsSeoContract.push, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsPushLogKeys.lists }),
  });
}

export function useCmsDeadlinkCheck() {
  return useApiMutation(cmsSeoContract.deadlinkCheck);
}