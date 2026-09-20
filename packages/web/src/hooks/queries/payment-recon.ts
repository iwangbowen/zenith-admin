import { useEffect, useRef } from 'react';
import { keepPreviousData, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import { paymentChannelAccountContract, paymentReconContract } from '@zenith/shared/payment';
import { contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { paymentJournalKeys, paymentLedgerAccountKeys } from './payment-journals';
import { invalidateEntityRelations } from '@/lib/entity-relation-cache';

const periods = createResourceQueries(paymentReconContract);
const accounts = createResourceQueries(paymentChannelAccountContract);
export const usePaymentChannelAccounts = accounts.useLookup;
export const usePaymentStatementPeriods = periods.useList;
export const usePaymentStatementPeriod = periods.useDetail;
export const paymentReconKeys = {
  ...periods.keys,
  all: [resourceKeyOf(paymentReconContract.basePath)] as const,
  statements: contractKey(paymentReconContract.statements),
  entries: contractKey(paymentReconContract.entries),
  runs: contractKey(paymentReconContract.runs),
  cases: contractKey(paymentReconContract.cases),
  adjustments: contractKey(paymentReconContract.adjustments),
  summary: contractKey(paymentReconContract.summary),
};

/** 核对、案件与审批均互相影响；任务完成和所有变更复用同一失效边界。 */
export function invalidatePaymentReconciliation(qc: QueryClient) {
  void invalidateEntityRelations(qc);
  void qc.invalidateQueries({ queryKey: paymentReconKeys.all });
  void qc.invalidateQueries({ queryKey: ['async-tasks'] });
  void qc.invalidateQueries({ queryKey: paymentJournalKeys.lists });
  void qc.invalidateQueries({ queryKey: paymentLedgerAccountKeys.lists });
}

export function usePaymentStatements(periodId?: number) {
  return useApiQuery(paymentReconContract.statements, { params: { id: periodId ?? 0 } }, { enabled: periodId !== undefined });
}
export function usePaymentStatement(id?: number) {
  return useApiQuery(paymentReconContract.statement, { params: { id: id ?? 0 } }, { enabled: id !== undefined });
}
export function usePaymentStatementEntries(id: number | undefined, query: QueryOf<typeof paymentReconContract.entries>) {
  return useApiQuery(paymentReconContract.entries, { params: { id: id ?? 0 }, query }, { enabled: id !== undefined, placeholderData: keepPreviousData });
}
export function usePaymentReconRuns(query: QueryOf<typeof paymentReconContract.runs>, enabled = true) {
  return useApiQuery(paymentReconContract.runs, { query }, { enabled, placeholderData: keepPreviousData });
}
export function usePaymentReconCases(query: QueryOf<typeof paymentReconContract.cases>, enabled = true) {
  return useApiQuery(paymentReconContract.cases, { query }, { enabled, placeholderData: keepPreviousData });
}
export function usePaymentReconCase(id?: number) {
  return useApiQuery(paymentReconContract.caseDetail, { params: { id: id ?? 0 } }, { enabled: id !== undefined });
}
export function usePaymentReconAdjustments(query: QueryOf<typeof paymentReconContract.adjustments>, enabled = true) {
  return useApiQuery(paymentReconContract.adjustments, { query }, { enabled, placeholderData: keepPreviousData });
}
export function usePaymentReconSummary(accountId?: number) {
  const qc = useQueryClient();
  const observed = useRef<{ accountId?: number; revision: string } | undefined>(undefined);
  const summary = useApiQuery(paymentReconContract.summary, { query: { accountId } }, {
    staleTime: 0,
    // Automatic reconciliation has no owner and sends no "my task" event. Keep a
    // slow idle probe for scheduled runs, and poll faster while any run is active.
    refetchInterval: (query) => query.state.data?.activeRuns ? 3000 : 15_000,
  });
  const revision = summary.data?.runRevision;
  useEffect(() => {
    if (revision === undefined) return;
    const previous = observed.current;
    observed.current = { accountId, revision };
    if (!previous || previous.accountId !== accountId || previous.revision === revision) return;
    // Published versions and completed/failed runs affect these views, including
    // open detail sheets. Do not invalidate this polling query or unrelated lookups.
    for (const op of [paymentReconContract.list, paymentReconContract.detail, paymentReconContract.statements,
      paymentReconContract.statement, paymentReconContract.entries, paymentReconContract.runs,
      paymentReconContract.cases, paymentReconContract.caseDetail]) {
      void qc.invalidateQueries({ queryKey: contractKey(op) });
    }
  }, [accountId, qc, revision]);
  return summary;
}
export function usePaymentReconWorkflowContext(id?: number, instanceId?: number) {
  return useApiQuery(paymentReconContract.workflowContext, { params: { id: id ?? 0 }, query: { instanceId } }, { enabled: id !== undefined });
}
export function usePaymentReconWorkflowPreview(id?: number, definitionId?: number) {
  return useApiQuery(paymentReconContract.workflowPreview, { params: { id: id ?? 0 }, body: { definitionId: definitionId ?? 0 } }, { enabled: id !== undefined && definitionId !== undefined });
}
export function usePaymentReconApprovalDetail(id?: number, instanceId?: number) {
  return useApiQuery(paymentReconContract.approvalDetail, { params: { id: id ?? 0 }, query: { instanceId: instanceId ?? 0 } }, { enabled: id !== undefined && instanceId !== undefined });
}

export const useSubmitPaymentStatement = () => useApiMutation(paymentReconContract.submit, { invalidate: invalidatePaymentReconciliation });
export const useRetryPaymentStatement = () => useApiMutation(paymentReconContract.retry, { invalidate: invalidatePaymentReconciliation });
export const useImportPaymentStatement = () => useApiMutation(paymentReconContract.importBill, { invalidate: invalidatePaymentReconciliation });
export const useRunPaymentRecon = () => useApiMutation(paymentReconContract.reconcile, { invalidate: invalidatePaymentReconciliation });
export const useHandlePaymentReconCase = () => useApiMutation(paymentReconContract.handleCase, { invalidate: invalidatePaymentReconciliation });
export const useCompensatePaymentReconCase = () => useApiMutation(paymentReconContract.compensate, { invalidate: invalidatePaymentReconciliation });
export const useCreatePaymentReconAdjustment = () => useApiMutation(paymentReconContract.createAdjustment, { invalidate: invalidatePaymentReconciliation });
export const useSubmitPaymentReconAdjustment = () => useApiMutation(paymentReconContract.submitAdjustment, { invalidate: invalidatePaymentReconciliation });
export const useExecutePaymentReconAdjustment = () => useApiMutation(paymentReconContract.executeAdjustment, { invalidate: invalidatePaymentReconciliation });
export const useReversePaymentReconAdjustment = () => useApiMutation(paymentReconContract.reverseAdjustment, { invalidate: invalidatePaymentReconciliation });
export const useMatchPaymentBankEntries = () => useApiMutation(paymentReconContract.matchBank, { invalidate: invalidatePaymentReconciliation });
