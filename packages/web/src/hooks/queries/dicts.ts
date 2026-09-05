import type { QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { dictContract } from '@zenith/shared/platform';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type DictListParams = NonNullable<QueryOf<typeof dictContract.list>>;

const resource = createResourceQueries(dictContract);

export const dictKeys = {
  ...resource.keys,
  items: (dictId: number | undefined) => contractKey(dictContract.items, { params: { id: dictId ?? 0 } }),
  itemsByCode: (code: string) => contractKey(dictContract.itemsByCode, { params: { code } }),
  itemDetail: (dictId: number | undefined, itemId: number | undefined) =>
    contractKey(dictContract.itemDetail, { params: { id: dictId ?? 0, itemId: itemId ?? 0 } }),
};

export const useDictList = resource.useList;
export const useDictDetail = resource.useDetail;
export const useSaveDict = resource.useSave;
export const useDeleteDicts = resource.useDelete;

export function useDictItemsById(dictId: number | undefined) {
  return useApiQuery(dictContract.items, { params: { id: dictId ?? 0 } }, { enabled: !!dictId });
}

export function useDictItemDetail(dictId: number | undefined, itemId: number | undefined, enabled = true) {
  return useApiQuery(
    dictContract.itemDetail,
    { params: { id: dictId ?? 0, itemId: itemId ?? 0 } },
    { enabled: enabled && dictId !== undefined && itemId !== undefined },
  );
}

/**
 * 字典项变更只影响所属字典的项列表 / 项详情与按编码读取的下拉源；
 * 字典本身（名称 / 编码 / 状态）不变，列表与详情无需回源。
 */
function invalidateDictItems(qc: QueryClient, dictId: number) {
  void qc.invalidateQueries({ queryKey: dictKeys.items(dictId) });
  void qc.invalidateQueries({ queryKey: contractKey(dictContract.itemDetail) });
  void qc.invalidateQueries({ queryKey: contractKey(dictContract.itemsByCode) });
}

export function useCreateDictItem() {
  return useApiMutation(dictContract.createItem, {
    invalidate: (qc, _output, { params }) => invalidateDictItems(qc, params.id),
  });
}

export function useUpdateDictItem() {
  return useApiMutation(dictContract.updateItem, {
    invalidate: (qc, _output, { params }) => invalidateDictItems(qc, params.id),
  });
}

export function useDeleteDictItem() {
  return useApiMutation(dictContract.removeItem, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: dictKeys.itemDetail(params.id, params.itemId) });
      invalidateDictItems(qc, params.id);
    },
  });
}
