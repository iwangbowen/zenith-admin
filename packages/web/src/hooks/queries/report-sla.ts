import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { reportSlaContract } from '@zenith/shared/report';
import { useSaveMutation, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { asyncTaskKeys } from './async-tasks';

export type ReportSlaRuleListParams = NonNullable<QueryOf<typeof reportSlaContract.rules>>;
export type ReportSlaViolationListParams = NonNullable<QueryOf<typeof reportSlaContract.violations>>;

/** 规则列表与违规列表同页挂载：规则写操作只碰规则（删除级联违规），违规状态流转只碰违规 */
export const reportSlaKeys = {
  all: [resourceKeyOf(reportSlaContract.basePath)] as const,
  lists: contractKey(reportSlaContract.rules),
  list: (params: ReportSlaRuleListParams) => contractKey(reportSlaContract.rules, { query: params }),
  detail: (id: number | undefined) => contractKey(reportSlaContract.ruleDetail, { params: { id: id ?? 0 } }),
  /** 全部违规列表（violations 操作前缀）：状态筛选改变成员关系，任何状态流转都整组回源 */
  violationLists: contractKey(reportSlaContract.violations),
  violations: (params: ReportSlaViolationListParams) => contractKey(reportSlaContract.violations, { query: params }),
};

const silent = { requestOptions: { silent: true } } as const;

/** 规则自身（名称 / 目标值 / 调度 / 启停 / lastEvaluatedAt）变化：列表与该规则详情 */
function invalidateRule(qc: QueryClient, id: number) {
  void qc.invalidateQueries({ queryKey: reportSlaKeys.lists });
  void qc.invalidateQueries({ queryKey: reportSlaKeys.detail(id) });
}

export function useReportSlaRuleList(params: ReportSlaRuleListParams) {
  return useApiQuery(reportSlaContract.rules, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportSlaRuleDetail(id: number | undefined, enabled = true) {
  return useApiQuery(reportSlaContract.ruleDetail, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

export type SaveReportSlaRuleValues = Partial<BodyOf<typeof reportSlaContract.createRule>>;

/** 无 id 走 createRule，有 id 走 updateRule（供 useEditModal 使用）；违规记录是历史观测，不随规则编辑改变 */
export function useSaveReportSlaRule() {
  return useSaveMutation(reportSlaContract.createRule, reportSlaContract.updateRule, {
    requestOptions: { silent: true },
    invalidate: (qc, saved) => invalidateRule(qc, saved.id),
  });
}

/** 删除规则级联删除其违规记录（外键 onDelete cascade）：详情移除、规则列表与违规列表回源 */
export function useDeleteReportSlaRule() {
  return useApiMutation(reportSlaContract.removeRule, {
    ...silent,
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: reportSlaKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: reportSlaKeys.lists });
      void qc.invalidateQueries({ queryKey: reportSlaKeys.violationLists });
    },
  });
}

/**
 * 评估是异步任务：立刻可见的是任务中心多了一条记录；lastEvaluatedAt 与新增违规由 worker 回写，
 * 把该规则（列表 / 详情）与违规列表标脏，让它们在回源或下次挂载时拿到结果。
 */
export function useEvaluateReportSlaRule() {
  return useApiMutation(reportSlaContract.evaluate, {
    ...silent,
    invalidate: (qc, _task, { params }) => {
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.lists });
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.stats });
      invalidateRule(qc, params.id);
      void qc.invalidateQueries({ queryKey: reportSlaKeys.violationLists });
    },
  });
}

export function useReportSlaViolationList(params: ReportSlaViolationListParams) {
  return useApiQuery(reportSlaContract.violations, { query: params }, { placeholderData: keepPreviousData });
}

/** 确认 / 解决只改违规记录的 status；规则列表不渲染违规计数，不动 */
export function useUpdateReportSlaViolation() {
  return useApiMutation(reportSlaContract.updateViolationStatus, {
    ...silent,
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportSlaKeys.violationLists }),
  });
}
