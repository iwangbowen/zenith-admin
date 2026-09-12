import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import {
  reportEnvironmentContract,
  reportGovernanceContract,
  type ReportPublishApproval,
  type ReportResourceTransfer,
  type ReportResourceType,
} from '@zenith/shared/report';
import { useSaveMutation, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { reportAssetKeys } from './report-assets';
import { reportDashboardKeys } from './report-dashboards';
import { reportDatasetKeys } from './report-datasets';
import { reportDatasourceKeys } from './report-datasources';
import { reportFillKeys } from './report-fill';
import { reportMetricKeys } from './report-metrics';
import { reportPrintKeys } from './report-print';

const silent = { requestOptions: { silent: true } } as const;

// ─── 被治理资源的失效面 ──────────────────────────────────────────────────────

/**
 * 审批通过 / 转移接受会改写被治理资源本身（lifecycleStatus / revision / ownerId），
 * 治理页面之外真正展示这些字段的是所有者域的列表与详情，以及跨类型汇总 ownerName / lifecycleStatus 的资产目录。
 * 只按资源类型触达对应域，其余六类资源与治理列表自身都不在此处失效。
 */
export function invalidateGovernedReportResource(qc: QueryClient, resourceType: ReportResourceType, resourceId: number) {
  switch (resourceType) {
    case 'datasource':
      void qc.invalidateQueries({ queryKey: reportDatasourceKeys.lists });
      void qc.invalidateQueries({ queryKey: reportDatasourceKeys.detail(resourceId) });
      break;
    case 'dataset':
      void qc.invalidateQueries({ queryKey: reportDatasetKeys.lists });
      void qc.invalidateQueries({ queryKey: reportDatasetKeys.detail(resourceId) });
      break;
    case 'dashboard':
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.lists });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.detailOf(resourceId) });
      break;
    case 'metric':
      void qc.invalidateQueries({ queryKey: reportMetricKeys.lists });
      void qc.invalidateQueries({ queryKey: reportMetricKeys.detail(resourceId) });
      break;
    case 'print_template':
      void qc.invalidateQueries({ queryKey: reportPrintKeys.lists });
      void qc.invalidateQueries({ queryKey: reportPrintKeys.detail(resourceId) });
      break;
    case 'fill_template':
      void qc.invalidateQueries({ queryKey: reportFillKeys.templateLists });
      void qc.invalidateQueries({ queryKey: reportFillKeys.templateDetail(resourceId) });
      break;
    case 'asset_template':
      void qc.invalidateQueries({ queryKey: reportAssetKeys.templateLists });
      void qc.invalidateQueries({ queryKey: reportAssetKeys.templateDetail(resourceId) });
      break;
  }
  void qc.invalidateQueries({ queryKey: reportAssetKeys.lists });
}

// ─── 资源权限 ───────────────────────────────────────────────────────────────

export type ReportResourceAclParams = NonNullable<QueryOf<typeof reportGovernanceContract.acls>>;

export const reportAclKeys = {
  /** 全部资源的权限列表（acls 操作前缀）；撤销接口不回传资源引用时的兜底范围 */
  all: contractKey(reportGovernanceContract.acls),
  /** 某个资源的权限列表（含 / 不含目录继承两种查询）：query 段做部分匹配，inheritFromFolder 不参与 */
  of: (resourceType: ReportResourceType, resourceId: number) =>
    contractKey(reportGovernanceContract.acls, { query: { resourceType, resourceId } }),
  list: (params: ReportResourceAclParams) => contractKey(reportGovernanceContract.acls, { query: params }),
};

export function useReportResourceAcls(params: ReportResourceAclParams, enabled = true) {
  return useApiQuery(reportGovernanceContract.acls, { query: params }, { enabled: enabled && params.resourceId > 0 });
}

/**
 * 权限变更只在该资源的权限侧栏可见：资源列表 / 详情不渲染 ACL，资产目录也不含权限列。
 * 授予与更新都回传带资源引用的 ACL 实体，精确到该资源；撤销只回传提示文案，退回 acls 操作前缀
 * （同屏最多挂载一个资源的权限侧栏，其余资源的列表只是被标脏）。
 */
export function useGrantReportResourceAcl() {
  return useApiMutation(reportGovernanceContract.grantAcl, {
    ...silent,
    invalidate: (qc, acl) => void qc.invalidateQueries({ queryKey: reportAclKeys.of(acl.resourceType, acl.resourceId) }),
  });
}

export function useUpdateReportResourceAcl() {
  return useApiMutation(reportGovernanceContract.updateAcl, {
    ...silent,
    invalidate: (qc, acl) => void qc.invalidateQueries({ queryKey: reportAclKeys.of(acl.resourceType, acl.resourceId) }),
  });
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
  /** 全部审批列表（approvals 操作前缀）：状态 / 类型筛选下的各页都渲染同一批记录 */
  all: contractKey(reportGovernanceContract.approvals),
  list: (params: ReportApprovalListParams) => contractKey(reportGovernanceContract.approvals, { query: params }),
};

export function useReportApprovalList(params: ReportApprovalListParams) {
  return useApiQuery(reportGovernanceContract.approvals, { query: params }, { placeholderData: keepPreviousData });
}

/**
 * 审批裁决：审批列表必回源。只有「通过」会落到资源本身——
 * publish 把 dashboard / metric 置为 published 并推进 revision（看板 published 模式取数随之变化），
 * deprecate 把 metric 置为 deprecated；其余动作 / 资源类型以及拒绝，服务端只改审批记录。
 */
export function invalidateAfterReportApprovalDecision(qc: QueryClient, approval: ReportPublishApproval) {
  void qc.invalidateQueries({ queryKey: reportApprovalKeys.all });
  if (approval.status !== 'approved') return;
  const touchesResource = approval.action === 'publish'
    ? approval.resourceType === 'dashboard' || approval.resourceType === 'metric'
    : approval.action === 'deprecate' && approval.resourceType === 'metric';
  if (!touchesResource) return;
  invalidateGovernedReportResource(qc, approval.resourceType, approval.resourceId);
  if (approval.resourceType === 'dashboard') void qc.invalidateQueries({ queryKey: reportDashboardKeys.dataOf(approval.resourceId) });
  // 指标下拉源按生命周期状态过滤
  if (approval.resourceType === 'metric') void qc.invalidateQueries({ queryKey: reportMetricKeys.lookup });
}

/** 申请 / 取消只新增或改写审批记录本身 */
export function useCreateReportApproval() {
  return useApiMutation(reportGovernanceContract.createApproval, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportApprovalKeys.all }) });
}

export function useDecideReportApproval() {
  return useApiMutation(reportGovernanceContract.decideApproval, {
    ...silent,
    invalidate: (qc, approval) => invalidateAfterReportApprovalDecision(qc, approval),
  });
}

export function useCancelReportApproval() {
  return useApiMutation(reportGovernanceContract.cancelApproval, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportApprovalKeys.all }) });
}

// ─── 资源转移 ───────────────────────────────────────────────────────────────

export type ReportTransferListParams = NonNullable<QueryOf<typeof reportGovernanceContract.transfers>>;

export const reportTransferKeys = {
  /** 全部转移列表（transfers 操作前缀） */
  all: contractKey(reportGovernanceContract.transfers),
  list: (params: ReportTransferListParams) => contractKey(reportGovernanceContract.transfers, { query: params }),
};

export function useReportTransferList(params: ReportTransferListParams) {
  return useApiQuery(reportGovernanceContract.transfers, { query: params }, { placeholderData: keepPreviousData });
}

/** 转移裁决：转移列表必回源；「接受」改写资源 ownerId（所有者域列表 / 详情与资产目录的负责人列），拒绝只改转移记录 */
export function invalidateAfterReportTransferDecision(qc: QueryClient, transfer: ReportResourceTransfer) {
  void qc.invalidateQueries({ queryKey: reportTransferKeys.all });
  if (transfer.status === 'accepted') invalidateGovernedReportResource(qc, transfer.resourceType, transfer.resourceId);
}

/** 申请 / 取消只新增或改写转移记录本身 */
export function useCreateReportTransfer() {
  return useApiMutation(reportGovernanceContract.createTransfer, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportTransferKeys.all }) });
}

export function useDecideReportTransfer() {
  return useApiMutation(reportGovernanceContract.decideTransfer, {
    ...silent,
    invalidate: (qc, transfer) => invalidateAfterReportTransferDecision(qc, transfer),
  });
}

export function useCancelReportTransfer() {
  return useApiMutation(reportGovernanceContract.cancelTransfer, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportTransferKeys.all }) });
}

// ─── 环境 ───────────────────────────────────────────────────────────────────

export const reportEnvironmentKeys = {
  /** 环境列表无入参，该 key 即唯一一条查询 */
  all: contractKey(reportEnvironmentContract.list),
};

export type ReportPromotionListParams = NonNullable<QueryOf<typeof reportEnvironmentContract.promotions>>;

export const reportPromotionKeys = {
  /** 全部发布历史列表（promotions 操作前缀） */
  all: contractKey(reportEnvironmentContract.promotions),
  list: (params: ReportPromotionListParams) => contractKey(reportEnvironmentContract.promotions, { query: params }),
};

export function useReportEnvironmentList() {
  return useApiQuery(reportEnvironmentContract.list);
}

/** 新增 / 编辑共用的保存载荷：code 只在创建时提交 */
export type SaveReportEnvironmentValues = Partial<BodyOf<typeof reportEnvironmentContract.create>>;

/**
 * 无 id 走 create，有 id 走 update（供 useEditModal 使用）。
 * 发布历史按环境 id 关联并渲染环境名称，编辑（可能改名）后一并回源；新建环境尚无发布记录引用。
 */
export function useSaveReportEnvironment() {
  return useSaveMutation(reportEnvironmentContract.create, reportEnvironmentContract.update, {
    requestOptions: { silent: true },
    invalidate: (qc, _saved, vars) => {
      void qc.invalidateQueries({ queryKey: reportEnvironmentKeys.all });
      if (vars.id !== undefined) void qc.invalidateQueries({ queryKey: reportPromotionKeys.all });
    },
  });
}

/** 服务端拒绝删除已有发布历史的环境，因此删除只影响环境列表 */
export function useDeleteReportEnvironment() {
  return useApiMutation(reportEnvironmentContract.remove, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportEnvironmentKeys.all }) });
}

// ─── 资源发布 ───────────────────────────────────────────────────────────────

export function useReportPromotionList(params: ReportPromotionListParams) {
  return useApiQuery(reportEnvironmentContract.promotions, { query: params }, { placeholderData: keepPreviousData });
}

/** 创建 / 流转（审批、部署、取消、回滚）只改发布记录自身的状态与快照，不改写资源 */
export function useCreateReportPromotion() {
  return useApiMutation(reportEnvironmentContract.createPromotion, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportPromotionKeys.all }) });
}

export function useTransitionReportPromotion() {
  return useApiMutation(reportEnvironmentContract.transitionPromotion, { ...silent, invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportPromotionKeys.all }) });
}
