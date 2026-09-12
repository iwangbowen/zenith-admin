import type { QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { workflowFormContract } from '@zenith/shared/workflow';
import { contractKey, createResourceQueries, useApiMutation, useSaveMutation } from '@/lib/contract-query';

export type WorkflowFormListParams = QueryOf<typeof workflowFormContract.list>;

// silent：错误交由调用方处理（409 乐观锁冲突需弹窗引导，而非通用 toast）
const silent = { silent: true };

/** 只用工厂的列表 / 详情与 keys：写操作需要 silent 请求选项与乐观锁载荷，单独声明 */
const resource = createResourceQueries(workflowFormContract);

export const workflowFormKeys = {
  ...resource.keys,
  detail: (id: number | null | undefined) => resource.keys.detail(id ?? undefined),
  /** 启用表单下拉（设计器表单选择器的组合查询挂在这一前缀下） */
  enabled: contractKey(workflowFormContract.enabled),
};

export const useWorkflowFormList = resource.useList;

export function useWorkflowFormDetail(id: number | null | undefined, enabled = true) {
  return resource.useDetail(id ?? undefined, enabled);
}

/** 表单新增 / 复制 / 改名 / 启停都会改变列表与设计器的「启用表单」下拉 */
const invalidateFormLists = (qc: QueryClient) => {
  void qc.invalidateQueries({ queryKey: workflowFormKeys.lists });
  void qc.invalidateQueries({ queryKey: workflowFormKeys.enabled });
};

export function useDeleteWorkflowForm() {
  return useApiMutation(workflowFormContract.remove, {
    requestOptions: silent,
    invalidate: (qc, _output, { params }) => {
      // 实体已不存在：移除详情而非失效
      qc.removeQueries({ queryKey: workflowFormKeys.detail(params.id) });
      invalidateFormLists(qc);
    },
  });
}

export function useDuplicateWorkflowForm() {
  return useApiMutation(workflowFormContract.duplicate, { requestOptions: silent, invalidate: invalidateFormLists });
}

/** 表单设计器保存载荷：创建入参 + 编辑时的乐观锁 / 字段重命名映射（新建时服务端忽略后两者） */
export type WorkflowFormSaveValues = BodyOf<typeof workflowFormContract.create> &
  Pick<BodyOf<typeof workflowFormContract.update>, 'expectedRevision' | 'renamedKeys'>;

/** 无 id 走创建、有 id 走更新；409 乐观锁冲突由调用方按 ApiError.code 处理 */
export function useSaveWorkflowForm() {
  return useSaveMutation<typeof workflowFormContract.create, typeof workflowFormContract.update, WorkflowFormSaveValues>(
    workflowFormContract.create,
    workflowFormContract.update,
    {
      requestOptions: silent,
      invalidate: (qc, saved) => {
        // 详情带 revision / schema，保存后必须回源（编辑器按详情重置基线）
        void qc.invalidateQueries({ queryKey: workflowFormKeys.detail(saved.id) });
        invalidateFormLists(qc);
      },
    },
  );
}
