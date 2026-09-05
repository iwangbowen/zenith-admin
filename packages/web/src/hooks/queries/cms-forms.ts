import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsFormContract } from '@zenith/shared/cms';
import { apiQueryOptions, contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type CmsFormListParams = NonNullable<QueryOf<typeof cmsFormContract.list>>;

const resource = createResourceQueries(cmsFormContract);

export const cmsFormKeys = {
  ...resource.keys,
  submissions: (formId: number | undefined, page: number, pageSize: number) =>
    contractKey(cmsFormContract.submissions, { params: { id: formId ?? 0 }, query: { page, pageSize } }),
};

export const useCmsFormList = resource.useList;
export const useSaveCmsForm = resource.useSave;
export const useDeleteCmsForms = resource.useDelete;

export function useCmsFormSubmissions(formId: number | undefined, page: number, pageSize: number) {
  return useQuery({
    ...apiQueryOptions(cmsFormContract.submissions, { params: { id: formId ?? 0 }, query: { page, pageSize } }),
    placeholderData: keepPreviousData,
    enabled: formId !== undefined,
  });
}

/** 删除提交数据改变提交列表与表单列表的提交计数 */
export function useDeleteCmsFormSubmissions() {
  return useApiMutation(cmsFormContract.deleteSubmissions, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: cmsFormKeys.all }),
  });
}
