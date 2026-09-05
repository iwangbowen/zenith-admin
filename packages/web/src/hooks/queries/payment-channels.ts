import { useMutation, useQuery, useQueryClient, keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { paymentChannelContract, type PaymentChannelConfig } from '@zenith/shared/payment';
import { api, contractKey, useApiMutation } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type PaymentChannelListParams = NonNullable<QueryOf<typeof paymentChannelContract.channels>>;

/** 商户配置表单载荷：新增与编辑共用一张表单，凭证字段只在填写时提交 */
export type PaymentChannelSaveValues = Partial<BodyOf<typeof paymentChannelContract.createChannel>>;

/**
 * 商户配置与订单 / 退款共用 `/api/payment` 根，key 按操作名区分：
 * 列表、详情、全量下拉与资金运营下拉各自独立失效。
 */
export const paymentChannelKeys = {
  lists: contractKey(paymentChannelContract.channels),
  list: (params: PaymentChannelListParams) => contractKey(paymentChannelContract.channels, { query: params }),
  details: contractKey(paymentChannelContract.channelDetail),
  detail: (id: number | undefined) => contractKey(paymentChannelContract.channelDetail, { params: { id: id ?? 0 } }),
  /** 全量渠道下拉源（支付应用配置等场景共享） */
  lookup: contractKey(paymentChannelContract.channelsAll),
  /** 资金运营页面专用最小下拉源 */
  operationLookup: contractKey(paymentChannelContract.channelOperationLookup),
};

/** 渠道增删改会同时改变列表、下拉源与资金运营下拉；详情按 id 单独处理 */
function invalidateChannelCollections(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: paymentChannelKeys.lists });
  void qc.invalidateQueries({ queryKey: paymentChannelKeys.lookup });
  void qc.invalidateQueries({ queryKey: paymentChannelKeys.operationLookup });
}

export function usePaymentChannelList(params: PaymentChannelListParams, enabled = true) {
  return useQuery({
    queryKey: paymentChannelKeys.list(params),
    queryFn: () => api(paymentChannelContract.channels, { query: params }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePaymentChannelDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentChannelKeys.detail(id),
    queryFn: () => api(paymentChannelContract.channelDetail, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

/** 无 id 走新增，有 id 走更新；isDefault 全域唯一，设为默认会连带清掉原默认渠道，其它渠道的详情缓存一并失效 */
export function useSavePaymentChannel() {
  const qc = useQueryClient();
  return useMutation<PaymentChannelConfig, Error, { id?: number; values: PaymentChannelSaveValues }>({
    mutationFn: ({ id, values }) =>
      id === undefined
        ? api(paymentChannelContract.createChannel, { body: values as BodyOf<typeof paymentChannelContract.createChannel> })
        : api(paymentChannelContract.updateChannel, { params: { id }, body: values }),
    onSuccess: (saved) => {
      if (saved.isDefault) void qc.invalidateQueries({ queryKey: paymentChannelKeys.details });
      else void qc.invalidateQueries({ queryKey: paymentChannelKeys.detail(saved.id) });
      invalidateChannelCollections(qc);
    },
  });
}

/** 服务端未提供 DELETE /batch，多选删除按单条并发执行；详情缓存移除而非失效，避免已删记录回源 404 */
export function useDeletePaymentChannels() {
  const qc = useQueryClient();
  return useMutation<null, Error, number[]>({
    mutationFn: async (ids) => {
      await Promise.all(ids.map((id) => api(paymentChannelContract.removeChannel, { params: { id } })));
      return null;
    },
    onSuccess: (_data, ids) => {
      for (const id of ids) qc.removeQueries({ queryKey: paymentChannelKeys.detail(id) });
      invalidateChannelCollections(qc);
    },
  });
}

export function useAllPaymentChannelConfigsLookup(enabled = true) {
  return useQuery({
    queryKey: paymentChannelKeys.lookup,
    queryFn: () => api(paymentChannelContract.channelsAll),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

/** 资金运营页面专用最小下拉源：仅含当前租户启用的商户配置 */
export function usePaymentChannelOperationLookup(enabled = true) {
  return useQuery({
    queryKey: paymentChannelKeys.operationLookup,
    queryFn: () => api(paymentChannelContract.channelOperationLookup),
    staleTime: LOOKUP_STALE_TIME,
    enabled,
  });
}

/** 连通性探测不改变任何数据，无需失效 */
export function useTestPaymentChannel() {
  return useApiMutation(paymentChannelContract.testChannel);
}

/** 默认标记在列表、详情、下拉源里都会展示，整域失效 */
export function useSetDefaultPaymentChannel() {
  return useApiMutation(paymentChannelContract.setDefaultChannel, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: paymentChannelKeys.details });
      invalidateChannelCollections(qc);
    },
  });
}
