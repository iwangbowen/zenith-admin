import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { paymentJournalContract } from '@zenith/shared/payment';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

export type PaymentLedgerAccountListParams = NonNullable<QueryOf<typeof paymentJournalContract.accounts>>;
export type PaymentJournalListParams = NonNullable<QueryOf<typeof paymentJournalContract.list>>;
export type PaymentFundReservationListParams = NonNullable<QueryOf<typeof paymentJournalContract.reservations>>;

export const paymentLedgerAccountKeys = {
  lists: contractKey(paymentJournalContract.accounts),
  list: (params: PaymentLedgerAccountListParams) => contractKey(paymentJournalContract.accounts, { query: params }),
  activeReservations: contractKey(paymentJournalContract.activeReservation),
  activeReservation: (accountId: number | undefined) => contractKey(paymentJournalContract.activeReservation, { params: { id: accountId ?? 0 } }),
};

export const paymentJournalKeys = {
  lists: contractKey(paymentJournalContract.list),
  list: (params: PaymentJournalListParams) => contractKey(paymentJournalContract.list, { query: params }),
  details: contractKey(paymentJournalContract.detail),
  detail: (id: number | undefined) => contractKey(paymentJournalContract.detail, { params: { id: id ?? 0 } }),
};

export const paymentFundReservationKeys = {
  lists: contractKey(paymentJournalContract.reservations),
  list: (params: PaymentFundReservationListParams) => contractKey(paymentJournalContract.reservations, { query: params }),
};

export function usePaymentLedgerAccountList(params: PaymentLedgerAccountListParams, enabled = true) {
  return useApiQuery(paymentJournalContract.accounts, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useCreatePaymentLedgerAccount() {
  return useApiMutation(paymentJournalContract.createAccount, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: paymentLedgerAccountKeys.lists }),
  });
}

export function usePaymentActiveReservationAmount(accountId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentLedgerAccountKeys.activeReservation(accountId),
    queryFn: () => api(paymentJournalContract.activeReservation, { params: { id: accountId ?? 0 } }),
    enabled: enabled && accountId !== undefined,
  });
}

export function usePaymentJournalList(params: PaymentJournalListParams, enabled = true) {
  return useApiQuery(paymentJournalContract.list, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function usePaymentJournalDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: paymentJournalKeys.detail(id),
    queryFn: () => api(paymentJournalContract.detail, { params: { id: id ?? 0 } }),
    enabled: enabled && id !== undefined,
  });
}

/** 过账后把凭证写入详情缓存，列表回源 */
export function usePostPaymentJournal() {
  return useApiMutation(paymentJournalContract.post, {
    invalidate: (qc, journal) => {
      qc.setQueryData(paymentJournalKeys.detail(journal.id), journal);
      void qc.invalidateQueries({ queryKey: paymentJournalKeys.lists });
    },
  });
}

/** 冲正生成子凭证并回写原凭证的 reversedByJournalId：新凭证入缓存，原凭证详情与列表回源 */
export function useReversePaymentJournal() {
  return useApiMutation(paymentJournalContract.reverse, {
    invalidate: (qc, journal, { params }) => {
      qc.setQueryData(paymentJournalKeys.detail(journal.id), journal);
      void qc.invalidateQueries({ queryKey: paymentJournalKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: paymentJournalKeys.lists });
    },
  });
}

export function usePaymentFundReservationList(params: PaymentFundReservationListParams, enabled = true) {
  return useApiQuery(paymentJournalContract.reservations, { query: params }, { placeholderData: keepPreviousData, enabled });
}

/** 预占改变账户的有效预占金额 */
export function useCreatePaymentFundReservation() {
  return useApiMutation(paymentJournalContract.createReservation, {
    invalidate: (qc, _reservation, { body }) => {
      void qc.invalidateQueries({ queryKey: paymentFundReservationKeys.lists });
      void qc.invalidateQueries({ queryKey: paymentLedgerAccountKeys.activeReservation(body.accountId) });
    },
  });
}

/** 核销 / 释放预占：预占列表与所属账户的有效预占金额回源 */
export function useTransitionPaymentFundReservation(action: 'capture' | 'release') {
  return useApiMutation(action === 'capture' ? paymentJournalContract.captureReservation : paymentJournalContract.releaseReservation, {
    invalidate: (qc, reservation) => {
      void qc.invalidateQueries({ queryKey: paymentFundReservationKeys.lists });
      void qc.invalidateQueries({ queryKey: paymentLedgerAccountKeys.activeReservation(reservation.accountId) });
    },
  });
}
