import { tagContract } from '@zenith/shared/platform';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

/** 分组选项由标签聚合而来，新建、改组、删除都可能改变集合 */
const TAG_GROUPS_KEY = contractKey(tagContract.groups);

const resource = createResourceQueries(tagContract, {
  onSaved: (qc) => void qc.invalidateQueries({ queryKey: TAG_GROUPS_KEY }),
  onDeleted: (qc) => void qc.invalidateQueries({ queryKey: TAG_GROUPS_KEY }),
});

export const tagKeys = { ...resource.keys, groups: TAG_GROUPS_KEY };

export const useTagList = resource.useList;
export const useTagDetail = resource.useDetail;
export const useSaveTag = resource.useSave;
/** 删除：单条与批量 */
export const useDeleteTags = resource.useDelete;

export function useTagGroups() {
  return useApiQuery(tagContract.groups, { staleTime: LOOKUP_STALE_TIME });
}

/** 停启用不改变分组集合，只刷详情与列表 */
export function useUpdateTagStatus() {
  return useApiMutation(tagContract.update, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: tagKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: tagKeys.lists });
    },
  });
}
