import type { QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { iotProductContract } from '@zenith/shared/iot';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type IotProductListParams = NonNullable<QueryOf<typeof iotProductContract.list>>;

export const {
  keys: iotProductKeys,
  useList: useIotProductList,
  useDetail: useIotProductDetail,
  useSave: useSaveIotProduct,
  useDelete: useDeleteIotProducts,
  useLookup: useAllIotProducts,
} = createResourceQueries(iotProductContract);

// ─── 物模型（独立命名空间：随产品编辑失效，不与产品列表连坐）──────────────────
export const iotModelKeys = {
  all: contractKey(iotProductContract.model),
  of: (productId: number) => contractKey(iotProductContract.model, { params: { id: productId } }),
};

export function useIotThingModel(productId: number | null) {
  return useApiQuery(iotProductContract.model, { params: { id: productId ?? 0 } }, { enabled: productId !== null });
}

/** 物模型写操作共用失效：模型本体 + 产品列表（三元组计数列） */
function invalidateModel(qc: QueryClient, productId: number) {
  void qc.invalidateQueries({ queryKey: iotModelKeys.of(productId) });
  void qc.invalidateQueries({ queryKey: iotProductKeys.lists });
}

// 物模型子资源的新增 / 更新带父级路径参数（productId），成对操作各自一个 useApiMutation，由弹窗按有无 id 选择
export function useCreateIotProperty() {
  return useApiMutation(iotProductContract.createProperty, {
    invalidate: (qc, _saved, { params }) => invalidateModel(qc, params.id),
  });
}

export function useUpdateIotProperty() {
  return useApiMutation(iotProductContract.updateProperty, {
    invalidate: (qc, _saved, { params }) => invalidateModel(qc, params.id),
  });
}

export function useDeleteIotProperty() {
  return useApiMutation(iotProductContract.removeProperty, {
    invalidate: (qc, _data, { params }) => invalidateModel(qc, params.id),
  });
}

export function useCreateIotService() {
  return useApiMutation(iotProductContract.createService, {
    invalidate: (qc, _saved, { params }) => invalidateModel(qc, params.id),
  });
}

export function useUpdateIotService() {
  return useApiMutation(iotProductContract.updateService, {
    invalidate: (qc, _saved, { params }) => invalidateModel(qc, params.id),
  });
}

export function useDeleteIotService() {
  return useApiMutation(iotProductContract.removeService, {
    invalidate: (qc, _data, { params }) => invalidateModel(qc, params.id),
  });
}

export function useCreateIotEvent() {
  return useApiMutation(iotProductContract.createEvent, {
    invalidate: (qc, _saved, { params }) => invalidateModel(qc, params.id),
  });
}

export function useUpdateIotEvent() {
  return useApiMutation(iotProductContract.updateEvent, {
    invalidate: (qc, _saved, { params }) => invalidateModel(qc, params.id),
  });
}

export function useDeleteIotEvent() {
  return useApiMutation(iotProductContract.removeEvent, {
    invalidate: (qc, _data, { params }) => invalidateModel(qc, params.id),
  });
}

export function useImportIotTsl() {
  return useApiMutation(iotProductContract.importModel, {
    invalidate: (qc, _saved, { params }) => invalidateModel(qc, params.id),
  });
}
