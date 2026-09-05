import { keepPreviousData, useMutation, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { reportEnvironmentContract, reportGovernanceContract, type ReportEnvironment } from '@zenith/shared/report';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';

const silent = { requestOptions: { silent: true } } as const;

// ─── 资源权限 ───────────────────────────────────────────────────────────────

export type ReportResourceAclParams = NonNullable<QueryOf<typeof reportGovernanceContract.acls>>;

export const reportAclKeys = {
  all: contractKey(reportGovernanceContract.acls),
  list: (params: ReportResourceAclParams) => contractKey(reportGovernanceContract.acls, { query: params }),
};

export function useReportResourceAcls(params: ReportResourceAclParams, enabled = true) {
  return useApiQuery(reportGovernanceContract.acls, { query: params }, { enabled: enabled && params.resourceId > 0 });
}

export function useGrantReportResourceAcl() {
  return useApiMutation(reportGovernanceContract.grantAcl, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportAclKeys.all }) });
}

export function useUpdateReportResourceAcl() {
  return useApiMutation(reportGovernanceContract.updateAcl, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportAclKeys.all }) });
}

export function useRevokeReportResourceAcl() {
  return useApiMutation(reportGovernanceContract.revokeAcl, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportAclKeys.all }) });
}

/** 权限检查是纯读操作，结果不进入缓存 */
export function useCheckReportResourceAccess() {
  return useApiMutation(reportGovernanceContract.checkAccess, silent);
}

// ─── 发布审批 ───────────────────────────────────────────────────────────────

export type ReportApprovalListParams = NonNullable<QueryOf<typeof reportGovernanceContract.approvals>>;

export const reportApprovalKeys = {
  all: contractKey(reportGovernanceContract.approvals),
  list: (params: ReportApprovalListParams) => contractKey(reportGovernanceContract.approvals, { query: params }),
};

export function useReportApprovalList(params: ReportApprovalListParams) {
  return useApiQuery(reportGovernanceContract.approvals, { query: params }, { placeholderData: keepPreviousData });
}

export function useCreateReportApproval() {
  return useApiMutation(reportGovernanceContract.createApproval, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportApprovalKeys.all }) });
}

export function useDecideReportApproval() {
  return useApiMutation(reportGovernanceContract.decideApproval, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportApprovalKeys.all }) });
}

export function useCancelReportApproval() {
  return useApiMutation(reportGovernanceContract.cancelApproval, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportApprovalKeys.all }) });
}

// ─── 资源转移 ───────────────────────────────────────────────────────────────

export type ReportTransferListParams = NonNullable<QueryOf<typeof reportGovernanceContract.transfers>>;

export const reportTransferKeys = {
  all: contractKey(reportGovernanceContract.transfers),
  list: (params: ReportTransferListParams) => contractKey(reportGovernanceContract.transfers, { query: params }),
};

export function useReportTransferList(params: ReportTransferListParams) {
  return useApiQuery(reportGovernanceContract.transfers, { query: params }, { placeholderData: keepPreviousData });
}

export function useCreateReportTransfer() {
  return useApiMutation(reportGovernanceContract.createTransfer, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportTransferKeys.all }) });
}

export function useDecideReportTransfer() {
  return useApiMutation(reportGovernanceContract.decideTransfer, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportTransferKeys.all }) });
}

export function useCancelReportTransfer() {
  return useApiMutation(reportGovernanceContract.cancelTransfer, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportTransferKeys.all }) });
}

// ─── 环境 ───────────────────────────────────────────────────────────────────

export const reportEnvironmentKeys = {
  all: contractKey(reportEnvironmentContract.list),
};

export function useReportEnvironmentList() {
  return useApiQuery(reportEnvironmentContract.list);
}

/** 新增 / 编辑共用的保存载荷：code 只在创建时提交 */
export type SaveReportEnvironmentValues = Partial<BodyOf<typeof reportEnvironmentContract.create>>;

/** 无 id 走 create，有 id 走 update（供 useEditModal 使用） */
export function useSaveReportEnvironment() {
  const qc = useQueryClient();
  return useMutation<ReportEnvironment, Error, { id?: number; values: SaveReportEnvironmentValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(reportEnvironmentContract.create, { body: values as BodyOf<typeof reportEnvironmentContract.create> }, { silent: true })
      : api(reportEnvironmentContract.update, { params: { id }, body: values }, { silent: true })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reportEnvironmentKeys.all }),
  });
}

export function useDeleteReportEnvironment() {
  return useApiMutation(reportEnvironmentContract.remove, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportEnvironmentKeys.all }) });
}

// ─── 资源发布 ───────────────────────────────────────────────────────────────

export type ReportPromotionListParams = NonNullable<QueryOf<typeof reportEnvironmentContract.promotions>>;

export const reportPromotionKeys = {
  all: contractKey(reportEnvironmentContract.promotions),
  list: (params: ReportPromotionListParams) => contractKey(reportEnvironmentContract.promotions, { query: params }),
};

export function useReportPromotionList(params: ReportPromotionListParams) {
  return useApiQuery(reportEnvironmentContract.promotions, { query: params }, { placeholderData: keepPreviousData });
}

export function useCreateReportPromotion() {
  return useApiMutation(reportEnvironmentContract.createPromotion, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportPromotionKeys.all }) });
}

export function useTransitionReportPromotion() {
  return useApiMutation(reportEnvironmentContract.transitionPromotion, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportPromotionKeys.all }) });
}
