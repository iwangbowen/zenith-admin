import { useQuery } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { paymentLinkContract, paymentLinkPublicContract } from '@zenith/shared/payment';
import { api, contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type PaymentLinkListParams = NonNullable<QueryOf<typeof paymentLinkContract.list>>;

/** 支付链接表单载荷：新增必填 applicationId，编辑时不可改，同一表单共用 */
export type PaymentLinkSaveValues = Partial<BodyOf<typeof paymentLinkContract.create>>;

/** 公开收银台视图按 token 缓存，链接内容变更后一并失效 */
const publicPrefix = contractKey(paymentLinkPublicContract.detail);
const publicSessionPrefix = contractKey(paymentLinkPublicContract.session);

const resource = createResourceQueries(paymentLinkContract, {
  onSaved: (qc) => {
    void qc.invalidateQueries({ queryKey: publicPrefix });
    void qc.invalidateQueries({ queryKey: publicSessionPrefix });
  },
  onDeleted: (qc) => {
    void qc.invalidateQueries({ queryKey: publicPrefix });
    void qc.invalidateQueries({ queryKey: publicSessionPrefix });
  },
});

export const paymentLinkKeys = {
  ...resource.keys,
  public: (token: string | undefined) => contractKey(paymentLinkPublicContract.detail, { params: { token: token ?? '' } }),
  publicSession: (token: string | undefined, sessionToken: string | undefined) =>
    contractKey(paymentLinkPublicContract.session, { params: { token: token ?? '', sessionToken: sessionToken ?? '' } }),
};

export const usePaymentLinkList = resource.useList;
export const usePaymentLinkDetail = resource.useDetail;
export const useSavePaymentLink = resource.useSave;
/** 服务端未提供 DELETE /batch，多选删除按单条并发执行 */
export const useDeletePaymentLinks = resource.useDelete;

/** 换 token 后旧公开链接立即失效：列表、详情与公开视图全部回源 */
export function useRotatePaymentLinkToken() {
  return useApiMutation(paymentLinkContract.rotateToken, {
    invalidate: (qc, _link, { params }) => {
      void qc.invalidateQueries({ queryKey: paymentLinkKeys.lists });
      void qc.invalidateQueries({ queryKey: paymentLinkKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: publicPrefix });
      void qc.invalidateQueries({ queryKey: publicSessionPrefix });
    },
  });
}

/** 公开端点：匿名访问，请求失败不弹全局提示（页面自行渲染不可用原因） */
const publicRequestOptions = { skipAuth: true, silent: true } as const;

export function usePublicPaymentLink(token: string | undefined) {
  return useQuery({
    queryKey: paymentLinkKeys.public(token),
    queryFn: () => api(paymentLinkPublicContract.detail, { params: { token: token ?? '' } }, publicRequestOptions),
    enabled: !!token,
  });
}

/** 下单后把收银台会话写入缓存，后续轮询直接复用同一 key */
export function usePayPublicPaymentLink() {
  return useApiMutation(paymentLinkPublicContract.pay, {
    requestOptions: publicRequestOptions,
    invalidate: (qc, session, { params }) => {
      qc.setQueryData(paymentLinkKeys.publicSession(params.token, session.sessionToken), session);
    },
  });
}

/** 收银台会话恢复与轮询：刷新、第三方回跳均使用同一不可枚举 token */
export function usePublicPaymentCashierSession(token: string, sessionToken: string | undefined) {
  return useQuery({
    queryKey: paymentLinkKeys.publicSession(token, sessionToken),
    queryFn: () => api(paymentLinkPublicContract.session, { params: { token, sessionToken: sessionToken ?? '' } }, publicRequestOptions),
    enabled: !!token && !!sessionToken,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'succeeded' || status === 'failed' || status === 'expired' ? false : 3000;
    },
  });
}
