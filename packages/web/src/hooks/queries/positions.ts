import { useQuery } from '@tanstack/react-query';
import type { BodyOf } from '@zenith/shared/core';
import { positionContract } from '@zenith/shared/identity';
import { api, useSaveMutation, createResourceQueries, useApiMutation } from '@/lib/contract-query';

/** 保存载荷：创建入参的部分形态，同一表单同时服务新增与编辑 */
export type PositionFormValues = Partial<BodyOf<typeof positionContract.create>>;

const resource = createResourceQueries(positionContract, {
  onDeleted: (qc, ids) => {
    // 实体已不存在：移除缓存而非失效，否则仍挂载的成员抽屉会去请求一个必然 404 的资源
    for (const id of ids) qc.removeQueries({ queryKey: positionKeys.members(id) });
  },
});

export const positionKeys = {
  ...resource.keys,
  /** 全量岗位下拉源（用户管理等跨页共享缓存） */
  allPositions: resource.keys.lookup,
  members: (id: number | undefined) => [...resource.keys.all, 'members', id] as const,
};

export const usePositionList = resource.useList;
export const usePositionDetail = resource.useDetail;
export const useDeletePositions = resource.useDelete;

export function useAllPositions(options?: { enabled?: boolean }) {
  return resource.useLookup(options?.enabled ?? true);
}

export function usePositionMembers(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: positionKeys.members(id),
    queryFn: () => api(positionContract.members, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

/**
 * 保存岗位：写接口与详情接口同源（服务端同为 mapPosition），直接回填详情缓存，省掉一次详情回源；
 * 列表注入了 userCount / userPreview 需回源，下拉源渲染岗位名称与状态，改名 / 停用后必须回源。
 */
export function useSavePosition() {
  return useSaveMutation(positionContract.create, positionContract.update, {
    invalidate: (qc, saved) => {
      qc.setQueryData(positionKeys.detail(saved.id), saved);
      void qc.invalidateQueries({ queryKey: positionKeys.lists });
      void qc.invalidateQueries({ queryKey: positionKeys.lookup });
    },
  });
}

/** 列表的「成员」列渲染 userCount / userPreview（仅列表接口注入），成员变更后必须回源；详情与下拉源都不含成员字段 */
export function useAssignPositionMembers() {
  return useApiMutation(positionContract.setMembers, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: positionKeys.members(params.id) });
      void qc.invalidateQueries({ queryKey: positionKeys.lists });
    },
  });
}
