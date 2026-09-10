import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cronJobContract } from '@zenith/shared/platform';
import { api, useSaveMutation, contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';

export type CronJobListParams = NonNullable<QueryOf<typeof cronJobContract.list>>;

export type CronJobLogsParams = { jobId: number } & NonNullable<QueryOf<typeof cronJobContract.jobLogs>>;

export type CronJobAllLogsParams = NonNullable<QueryOf<typeof cronJobContract.logs>>;

export type CronJobStatsParams = NonNullable<QueryOf<typeof cronJobContract.stats>>;

/** 执行概览（各统计周期）的公共前缀 */
const statsKey = contractKey(cronJobContract.stats);
/** 单任务下钻统计的公共前缀 */
const jobStatsKey = contractKey(cronJobContract.jobStats);
/** 全量执行日志（各筛选条件）的公共前缀 */
const logsKey = contractKey(cronJobContract.logs);
/** 单任务执行日志的公共前缀 */
const jobLogsKey = contractKey(cronJobContract.jobLogs);

/** 概览与单任务下钻都由日志聚合而来，凡影响概览的写操作两者同时失效 */
function invalidateCronJobStats(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: statsKey });
  void qc.invalidateQueries({ queryKey: jobStatsKey });
}

/** 执行日志分两个端点（全量 / 单任务），凡影响日志的写操作两者同时失效 */
function invalidateCronJobLogs(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: logsKey });
  void qc.invalidateQueries({ queryKey: jobLogsKey });
}

const {
  keys: resourceKeys,
  useList: useCronJobList,
  useDetail: useCronJobDetail,
  useDelete: useDeleteCronJob,
} = createResourceQueries(cronJobContract, {
  // 执行日志按任务级联清理，且全量日志列表带 jobName；概览含 totalJobs / enabledJobs
  onDeleted: (qc) => {
    invalidateCronJobStats(qc);
    invalidateCronJobLogs(qc);
  },
});

export { useCronJobList, useCronJobDetail, useDeleteCronJob };

export const cronJobKeys = {
  ...resourceKeys,
  handlers: contractKey(cronJobContract.handlers),
  stats: statsKey,
  jobStats: jobStatsKey,
  statsOf: (params: CronJobStatsParams) => contractKey(cronJobContract.stats, { query: params }),
  logs: logsKey,
  allLogs: (params: CronJobAllLogsParams) => contractKey(cronJobContract.logs, { query: params }),
  jobLogs: jobLogsKey,
  jobLogList: ({ jobId, ...query }: CronJobLogsParams) => contractKey(cronJobContract.jobLogs, { params: { id: jobId }, query }),
};

export function useCronJobHandlers() {
  return useApiQuery(cronJobContract.handlers, { staleTime: LOOKUP_STALE_TIME });
}

/** 执行概览刷新周期：运行中 / 心跳等状态需要准实时 */
export const CRON_STATS_REFETCH_INTERVAL_MS = 30_000;

/** 执行概览：切换统计周期时保留上一周期数据，避免整页闪成骨架；页面可见时定时轮询 */
export function useCronJobStats(params: CronJobStatsParams = {}) {
  return useApiQuery(cronJobContract.stats, { query: params }, {
    placeholderData: keepPreviousData,
    refetchInterval: CRON_STATS_REFETCH_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

/** 单任务下钻统计（抽屉打开时才拉取） */
export function useCronJobDetailStats(jobId: number | null, params: CronJobStatsParams = {}) {
  return useApiQuery(cronJobContract.jobStats, { params: { id: jobId ?? 0 }, query: params }, {
    enabled: jobId != null,
    placeholderData: keepPreviousData,
  });
}

export function useCronJobLogs({ jobId, ...query }: CronJobLogsParams, enabled = true) {
  return useApiQuery(cronJobContract.jobLogs, { params: { id: jobId }, query }, { enabled, placeholderData: keepPreviousData });
}

export function useCronJobAllLogs(params: CronJobAllLogsParams, enabled = true) {
  return useApiQuery(cronJobContract.logs, { query: params }, { enabled, placeholderData: keepPreviousData });
}

/**
 * 保存（新增 / 编辑）：写接口与详情接口同源（服务端同为 mapCronJob），响应直接回填详情缓存，
 * 不再对详情发起一次必然返回相同数据的回源。
 */
export function useSaveCronJob() {
  return useSaveMutation(cronJobContract.create, cronJobContract.update, {
    invalidate: (qc, saved) => {
      qc.setQueryData(cronJobKeys.detail(saved.id), saved);
      void qc.invalidateQueries({ queryKey: cronJobKeys.lists });
      // 概览含 totalJobs / enabledJobs 与 perJob.jobName，新增或改名都会变
      invalidateCronJobStats(qc);
    },
  });
}

/**
 * 手动执行：接口只返回提示文案（`okBody(null, msg)`），但副作用覆盖面很广——
 * 任务的 lastRunAt/lastRunStatus/lastRunMessage、执行日志、概览统计都会变。
 * 「命令型接口」不等于「无需失效」，判据是有没有已挂载的查询读了被改动的状态。
 */
export function useRunCronJob() {
  return useApiMutation(cronJobContract.run, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cronJobKeys.lists });
      void qc.invalidateQueries({ queryKey: cronJobKeys.detail(params.id) });
      invalidateCronJobStats(qc);
      invalidateCronJobLogs(qc);
    },
  });
}

export function useUpdateCronJobStatus() {
  return useApiMutation(cronJobContract.setStatus, {
    // 状态接口返回 okBody(null, msg)，没有实体可回填，只能失效
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cronJobKeys.lists });
      void qc.invalidateQueries({ queryKey: cronJobKeys.detail(params.id) });
      // 概览含 enabledJobs
      invalidateCronJobStats(qc);
    },
  });
}

/** 清除执行日志：指定 jobId 走单任务端点，否则清除全部 */
export function useClearCronJobLogs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ days, jobId }: { days: number; jobId?: number | null }) => (jobId !== null && jobId !== undefined
      ? api(cronJobContract.clearJobLogs, { params: { id: jobId }, query: { days } })
      : api(cronJobContract.clearLogs, { query: { days } })),
    onSuccess: () => {
      invalidateCronJobLogs(qc);
      // 概览的汇总 / 趋势 / perJob / 错误聚合均由日志聚合而来
      invalidateCronJobStats(qc);
      // 任务本身字段不受影响，不动 lists / detail
    },
  });
}
