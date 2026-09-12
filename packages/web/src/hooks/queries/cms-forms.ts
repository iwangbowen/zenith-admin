import { keepPreviousData } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsFormContract } from '@zenith/shared/cms';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type CmsFormListParams = NonNullable<QueryOf<typeof cmsFormContract.list>>;

const resource = createResourceQueries(cmsFormContract);

export const cmsFormKeys = {
  ...resource.keys,
  /** 某个表单全部分页提交数据的前缀（按 params 段匹配） */
  submissionsOf: (formId: number) => [...contractKey(cmsFormContract.submissions), { params: { id: formId } }] as const,
  submissions: (formId: number | undefined, page: number, pageSize: number) =>
    contractKey(cmsFormContract.submissions, { params: { id: formId ?? 0 }, query: { page, pageSize } }),
};

export const useCmsFormList = resource.useList;
export const useSaveCmsForm = resource.useSave;
export const useDeleteCmsForms = resource.useDelete;

export function useCmsFormSubmissions(formId: number | undefined, page: number, pageSize: number) {
  return useApiQuery(cmsFormContract.submissions, { params: { id: formId ?? 0 }, query: { page, pageSize } }, {
    placeholderData: keepPreviousData,
    enabled: formId !== undefined,
  });
}

/** 删除提交数据改变该表单的提交列表与表单列表的 submissionCount 列；其它表单的提交数据不受影响 */
export function useDeleteCmsFormSubmissions() {
  return useApiMutation(cmsFormContract.deleteSubmissions, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsFormKeys.submissionsOf(params.id) });
      void qc.invalidateQueries({ queryKey: cmsFormKeys.lists });
    },
  });
}