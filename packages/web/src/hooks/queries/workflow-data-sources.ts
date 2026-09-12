import type { QueryOf } from '@zenith/shared/core';
import { workflowDataSourceContract } from '@zenith/shared/workflow';
import { contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type WorkflowDataSourceListParams = QueryOf<typeof workflowDataSourceContract.list>;

const resource = createResourceQueries(workflowDataSourceContract, {
  // 设计器按数据源远程取的选项 / 记录随数据源配置（接口地址、字段映射）一起变化
  onSaved: (qc) => {
    void qc.invalidateQueries({ queryKey: workflowDataSourceKeys.options });
    void qc.invalidateQueries({ queryKey: workflowDataSourceKeys.records });
  },
  onDeleted: (qc) => {
    void qc.invalidateQueries({ queryKey: workflowDataSourceKeys.options });
    void qc.invalidateQueries({ queryKey: workflowDataSourceKeys.records });
  },
});

export const workflowDataSourceKeys = {
  ...resource.keys,
  /** 设计器远程选项（各数据源 / 关键词）的公共前缀；设计器的「启用数据源」下拉走 list 操作，已在 lists 之下 */
  options: contractKey(workflowDataSourceContract.options),
  records: contractKey(workflowDataSourceContract.record),
};

export const useWorkflowDataSourceList = resource.useList;
export const useSaveWorkflowDataSource = resource.useSave;
export const useDeleteWorkflowDataSources = resource.useDelete;

/** 连通性测试：直接拉一次选项，结果只在弹窗内展示，不进入缓存 */
export function useTestWorkflowDataSource() {
  return useApiMutation(workflowDataSourceContract.options, { requestOptions: { silent: true } });
}
