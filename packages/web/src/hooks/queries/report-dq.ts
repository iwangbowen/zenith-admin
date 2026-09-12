import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import { reportDqContract } from '@zenith/shared/report';
import { useSaveMutation, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { asyncTaskKeys } from './async-tasks';

export type ReportDqRuleListParams = NonNullable<QueryOf<typeof reportDqContract.rules>>;
export type ReportDqRunListParams = NonNullable<QueryOf<typeof reportDqContract.runs>>;
export type ReportDqAnomalyListParams = NonNullable<QueryOf<typeof reportDqContract.anomalies>>;

/**
 * 质量页一屏挂着规则、运行历史、异常与评分；数据集页 / 看板页另挂着「未处理异常」列表。
 * 规则写操作只碰规则（删除级联运行、异常置空 ruleId），执行结果由 worker 回写到运行 / 异常 / 评分。
 */
export const reportDqKeys = {
  all: [resourceKeyOf(reportDqContract.basePath)] as const,
  lists: contractKey(reportDqContract.rules),
  list: (params: ReportDqRuleListParams) => contractKey(reportDqContract.rules, { query: params }),
  detail: (id: number | undefined) => contractKey(reportDqContract.ruleDetail, { params: { id: id ?? 0 } }),
  /** 全部运行历史（runs 操作前缀）：按规则 / 数据集 / 状态筛选的各页 */
  runLists: contractKey(reportDqContract.runs),
  runs: (params: ReportDqRunListParams) => contractKey(reportDqContract.runs, { query: params }),
  /** 全部异常列表（anomalies 操作前缀）：状态筛选改变成员关系，状态流转整组回源 */
  anomalyLists: contractKey(reportDqContract.anomalies),
  anomalies: (params: ReportDqAnomalyListParams) => contractKey(reportDqContract.anomalies, { query: params }),
  /** 全部数据集的评分历史 / 当前评分（两个操作前缀）：执行规则时不知道所属数据集，只有挂载中的那一份会回源 */
  scoreLists: contractKey(reportDqContract.scores),
  currentScores: contractKey(reportDqContract.currentScore),
  scores: (datasetId: number | undefined, params: { page: number; pageSize: number }) =>
    contractKey(reportDqContract.scores, { params: { id: datasetId ?? 0 }, query: params }),
  currentScore: (datasetId: number | undefined) => contractKey(reportDqContract.currentScore, { params: { id: datasetId ?? 0 } }),
};

const silent = { requestOptions: { silent: true } } as const;

/** 规则自身（名称 / 阈值 / 启停 / lastRunAt）变化：列表与该规则详情 */
function invalidateRule(qc: QueryClient, id: number) {
  void qc.invalidateQueries({ queryKey: reportDqKeys.lists });
  void qc.invalidateQueries({ queryKey: reportDqKeys.detail(id) });
}

export function useReportDqRuleList(params: ReportDqRuleListParams) {
  return useApiQuery(reportDqContract.rules, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportDqRuleDetail(id: number | undefined, enabled = true) {
  return useApiQuery(reportDqContract.ruleDetail, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

export type SaveReportDqRuleValues = Partial<BodyOf<typeof reportDqContract.createRule>>;

/** 无 id 走 createRule，有 id 走 updateRule（供 useEditModal 使用）；运行 / 异常 / 评分是历史结果，不随规则编辑改变 */
export function useSaveReportDqRule() {
  return useSaveMutation(reportDqContract.createRule, reportDqContract.updateRule, {
    requestOptions: { silent: true },
    invalidate: (qc, saved) => invalidateRule(qc, saved.id),
  });
}

/** 删除规则级联删除其运行历史、并把异常的 ruleId 置空（外键约束）：详情移除，规则 / 运行 / 异常列表回源，评分不动 */
export function useDeleteReportDqRule() {
  return useApiMutation(reportDqContract.removeRule, {
    ...silent,
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: reportDqKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: reportDqKeys.lists });
      void qc.invalidateQueries({ queryKey: reportDqKeys.runLists });
      void qc.invalidateQueries({ queryKey: reportDqKeys.anomalyLists });
    },
  });
}

/** 启停只改规则的 enabled */
export function useToggleReportDqRule() {
  return useApiMutation(reportDqContract.toggleRule, {
    ...silent,
    invalidate: (qc, saved) => invalidateRule(qc, saved.id),
  });
}

/**
 * 执行是异步任务：立刻可见的是任务中心多了一条记录；运行记录、异常、评分与规则的 lastRunAt 由 worker 回写，
 * 把它们标脏让挂载中的列表回源。响应里没有数据集 id，评分按操作前缀失效（只有挂载中的那份数据集会回源）。
 */
export function useRunReportDqRule() {
  return useApiMutation(reportDqContract.runRule, {
    ...silent,
    invalidate: (qc, _task, { params }) => {
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.lists });
      void qc.invalidateQueries({ queryKey: asyncTaskKeys.stats });
      invalidateRule(qc, params.id);
      void qc.invalidateQueries({ queryKey: reportDqKeys.runLists });
      void qc.invalidateQueries({ queryKey: reportDqKeys.anomalyLists });
      void qc.invalidateQueries({ queryKey: reportDqKeys.scoreLists });
      void qc.invalidateQueries({ queryKey: reportDqKeys.currentScores });
    },
  });
}

export function useReportDqRunList(params: ReportDqRunListParams) {
  return useApiQuery(reportDqContract.runs, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportDqScoreHistory(datasetId: number | undefined, params: { page: number; pageSize: number }, enabled = true) {
  return useApiQuery(reportDqContract.scores, { params: { id: datasetId ?? 0 }, query: params }, {
    placeholderData: keepPreviousData,
    enabled: enabled && !!datasetId,
  });
}

export function useCurrentReportDqScore(datasetId: number | undefined, enabled = true) {
  return useApiQuery(reportDqContract.currentScore, { params: { id: datasetId ?? 0 } }, { enabled: enabled && !!datasetId });
}

export function useReportDqAnomalyList(params: ReportDqAnomalyListParams, enabled = true) {
  return useApiQuery(reportDqContract.anomalies, { query: params }, { placeholderData: keepPreviousData, enabled });
}

/** 确认 / 解决只改异常记录的 status（数据集页 / 看板页的「未处理异常」按 status 过滤，同在前缀之下） */
export function useUpdateReportDqAnomalyStatus() {
  return useApiMutation(reportDqContract.updateAnomalyStatus, {
    ...silent,
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportDqKeys.anomalyLists }),
  });
}
