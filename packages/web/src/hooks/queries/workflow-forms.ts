import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { workflowFormContract } from '@zenith/shared/workflow';
import { api, useApiMutation } from '@/lib/contract-query';

export type WorkflowFormListParams = QueryOf<typeof workflowFormContract.list>;

export const workflowFormKeys = {
  all: ['workflow', 'forms'] as const,
  lists: ['workflow', 'forms', 'list'] as const,
  list: (params: WorkflowFormListParams) => ['workflow', 'forms', 'list', params] as const,
  detail: (id: number | null | undefined) => ['workflow', 'forms', 'detail', id ?? null] as const,
};

export function useWorkflowFormList(params: WorkflowFormListParams) {
  return useQuery({
    queryKey: workflowFormKeys.list(params),
    queryFn: () => api(workflowFormContract.list, { query: params }),
    placeholderData: keepPreviousData,
  });
}

export function useWorkflowFormDetail(id: number | null | undefined, enabled = true) {
  return useQuery({
    queryKey: workflowFormKeys.detail(id),
    queryFn: () => api(workflowFormContract.detail, { params: { id: id as number } }),
    enabled: enabled && !!id,
  });
}

/** 表单增删改都会影响列表 / 详情 / 设计器表单下拉（同一前缀），整体失效 */
const invalidateForms = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: workflowFormKeys.all });
};

// silent：错误交由调用方处理（409 乐观锁冲突需弹窗引导，而非通用 toast）
const silent = { silent: true };

export function useDeleteWorkflowForm() {
  return useApiMutation(workflowFormContract.remove, { invalidate: invalidateForms, requestOptions: silent });
}

export function useDuplicateWorkflowForm() {
  return useApiMutation(workflowFormContract.duplicate, { invalidate: invalidateForms, requestOptions: silent });
}

/** 表单设计器保存载荷：创建入参 + 编辑时的乐观锁 / 字段重命名映射（新建时服务端忽略后两者） */
export type WorkflowFormSaveValues = BodyOf<typeof workflowFormContract.create> &
  Pick<BodyOf<typeof workflowFormContract.update>, 'expectedRevision' | 'renamedKeys'>;

/** 无 id 走创建、有 id 走更新；409 乐观锁冲突由调用方按 ApiError.code 处理 */
export function useSaveWorkflowForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id: number | null; values: WorkflowFormSaveValues }) =>
      id == null
        ? api(workflowFormContract.create, { body: values }, silent)
        : api(workflowFormContract.update, { params: { id }, body: values }, silent),
    onSuccess: () => invalidateForms(qc),
  });
}
