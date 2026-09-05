import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type AnyOperation, type BodyOf, type InputOf, type QueryOf } from '@zenith/shared/core';
import {
  ANALYTICS_CONFIG_VERSION_KEY,
  analyticsCampaignContract,
  analyticsContract,
  analyticsExperimentContract,
  analyticsSiteContract,
  frontendErrorContract,
  type AnalyticsDeviceType,
  type AnalyticsDrillUsersInput,
  type AnalyticsEventQueryInput,
  type AnalyticsEventSource,
} from '@zenith/shared/analytics';
import { userContract } from '@zenith/shared/identity';
import { api, apiQueryOptions, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { reloadTrackerConfig } from '@/utils/tracker';

// ─── 查询参数类型（均由契约推导）────────────────────────────────────────────

export type AnalyticsRangeParams = QueryOf<typeof analyticsContract.overview>;
export type AnalyticsSessionsParams = QueryOf<typeof analyticsContract.sessions>;
export type AnalyticsRetentionParams = BodyOf<typeof analyticsContract.retention>;
export type AnalyticsAcquisitionParams = QueryOf<typeof analyticsContract.acquisition>;
export type AnalyticsEventsParams = QueryOf<typeof analyticsContract.events>;
export type AnalyticsMetaParams = QueryOf<typeof analyticsContract.eventMeta>;
export type AnalyticsOverrideParams = QueryOf<typeof analyticsContract.eventOverrides>;
export type AnalyticsQualityParams = QueryOf<typeof analyticsContract.quality>;
export type AnalyticsDebugEventsParams = QueryOf<typeof analyticsContract.debugEvents>;
export type AnalyticsSegmentListParams = QueryOf<typeof analyticsContract.segments>;
export type AnalyticsSegmentMembersParams = QueryOf<typeof analyticsContract.segmentMembers>;
export type AnalyticsCampaignListParams = QueryOf<typeof analyticsCampaignContract.campaigns>;
export type AnalyticsSiteListParams = QueryOf<typeof analyticsSiteContract.sites>;
export type AnalyticsExperimentListParams = QueryOf<typeof analyticsExperimentContract.experiments>;
export type AnalyticsExperimentReportParams = QueryOf<typeof analyticsExperimentContract.experimentReport>;
export type FrontendErrorGroupParams = QueryOf<typeof frontendErrorContract.groups>;
export type FrontendErrorEventParams = QueryOf<typeof frontendErrorContract.events>;
export type FrontendSourceMapParams = QueryOf<typeof frontendErrorContract.sourceMaps>;
export type FrontendSimplePageParams = QueryOf<typeof frontendErrorContract.alerts>;
export type FrontendAlertLogParams = QueryOf<typeof frontendErrorContract.alertLogs>;

export type { AnalyticsDrillUsersInput, AnalyticsEventQueryInput };

/** 新增 / 编辑共用的保存载荷：必填字段由表单 rules 保证，服务端 schema 兜底校验 */
type SaveValues<Op extends AnyOperation> = Partial<NonNullable<BodyOf<Op>>>;

// ─── query key ───────────────────────────────────────────────────────────────

/** 数据管理面（事件 / 字典 / 覆盖 / 质量 / 聚合 / 设置 / 分群 / 触达 / 站点 / 实验）的全部查询 */
const ANALYTICS_DATA_OPS: readonly AnyOperation[] = [
  analyticsContract.events, analyticsContract.eventDetail,
  analyticsContract.eventMeta, analyticsContract.eventMetaReferences,
  analyticsContract.eventOverrides, analyticsContract.quality, analyticsContract.debugEvents,
  analyticsContract.settings, analyticsContract.rollup,
  analyticsContract.segments, analyticsContract.segmentDetail, analyticsContract.segmentMembers,
  analyticsCampaignContract.campaigns,
  analyticsSiteContract.sites,
  analyticsExperimentContract.experiments, analyticsExperimentContract.experimentDetail, analyticsExperimentContract.experimentReport,
];

export const analyticsKeys = {
  /** 全部行为分析查询（本域所有契约操作共享该前缀） */
  all: [resourceKeyOf(analyticsContract.basePath)] as const,
  realtime: contractKey(analyticsContract.realtime),
  sessionsLists: contractKey(analyticsContract.sessions),
  retention: (params: AnalyticsRetentionParams) => contractKey(analyticsContract.retention, { body: params }),
  savedReports: contractKey(analyticsContract.reports),
  data: {
    eventsLists: contractKey(analyticsContract.events),
    metaLists: contractKey(analyticsContract.eventMeta),
    metaReferences: contractKey(analyticsContract.eventMetaReferences),
    settings: contractKey(analyticsContract.settings),
    overridesLists: contractKey(analyticsContract.eventOverrides),
    quality: contractKey(analyticsContract.quality),
    debugEvents: contractKey(analyticsContract.debugEvents),
    segmentsLists: contractKey(analyticsContract.segments),
    segmentDetail: (id: number | undefined) => contractKey(analyticsContract.segmentDetail, { params: { id: id ?? 0 } }),
    campaignsLists: contractKey(analyticsCampaignContract.campaigns),
    sitesLists: contractKey(analyticsSiteContract.sites),
    experimentsLists: contractKey(analyticsExperimentContract.experiments),
    experimentDetail: (id: number | undefined) => contractKey(analyticsExperimentContract.experimentDetail, { params: { id: id ?? 0 } }),
  },
  frontendErrors: {
    all: [resourceKeyOf(frontendErrorContract.basePath)] as const,
    groupsLists: contractKey(frontendErrorContract.groups),
    groupDetail: (id: number | undefined) => contractKey(frontendErrorContract.groupDetail, { params: { id: id ?? 0 } }),
    sourceMapsLists: contractKey(frontendErrorContract.sourceMaps),
    alertsLists: contractKey(frontendErrorContract.alerts),
    adminUsers: contractKey(userContract.list, { query: { page: 1, pageSize: 100 } }),
  },
};

/** 数据管理面的写操作（字典 / 覆盖 / 聚合重建）会改变多处派生视图，整面失效 */
export function invalidateAnalyticsData(qc: QueryClient) {
  for (const op of ANALYTICS_DATA_OPS) void qc.invalidateQueries({ queryKey: contractKey(op) });
}

/** 优先自定义 startDate / endDate（含端点日），否则最近 days 天 */
function rangeQuery(range: AnalyticsRangeParams): AnalyticsRangeParams {
  return range.startDate && range.endDate
    ? { startDate: range.startDate, endDate: range.endDate }
    : { days: range.days };
}

// ─── 概览 / 趋势 / 实时 ───────────────────────────────────────────────────────

export function useAnalyticsOverview(range: AnalyticsRangeParams) {
  return useApiQuery(analyticsContract.overview, { query: rangeQuery(range) });
}

export function useAnalyticsTrends(range: AnalyticsRangeParams, compare = false) {
  return useApiQuery(analyticsContract.trends, { query: { ...rangeQuery(range), compare: compare ? 'true' : undefined } });
}

export function useAnalyticsRealtime() {
  return useApiQuery(analyticsContract.realtime, {
    refetchInterval: 10_000,
    requestOptions: { silent: true },
  });
}

// ─── 页面 / 功能 / 会话 / 用户 ────────────────────────────────────────────────

export function useAnalyticsPageStats(days: number, page = 1, pageSize = 20) {
  return useApiQuery(analyticsContract.pageStats, { query: { days, page, pageSize } }, { placeholderData: keepPreviousData });
}

export function useAnalyticsFeatureStats(days: number, page = 1, pageSize = 20) {
  return useApiQuery(analyticsContract.featureStats, { query: { days, page, pageSize } }, { placeholderData: keepPreviousData });
}

export function useAnalyticsSessions(params: AnalyticsSessionsParams) {
  return useApiQuery(analyticsContract.sessions, { query: params }, { placeholderData: keepPreviousData });
}

export function useAnalyticsUserStats(days: number, page = 1, pageSize = 20) {
  return useApiQuery(analyticsContract.userStats, { query: { days, page, pageSize } }, { placeholderData: keepPreviousData });
}

export function useAnalyticsUserTimeline(userId: number | null, enabled = true) {
  return useApiQuery(analyticsContract.userTimeline, { query: { userId: userId ?? undefined, limit: 100 } }, {
    enabled: enabled && userId != null,
  });
}

export function useSessionTimeline(sessionId: string | null, enabled = true) {
  return useApiQuery(analyticsContract.sessionTimeline, { query: { sessionId: sessionId ?? '' } }, {
    enabled: enabled && !!sessionId,
  });
}

// ─── 漏斗 / 留存 / 下钻 / 获客 / 事件分析 / 路径 ──────────────────────────────

export function useAnalyzeFunnel() {
  return useApiMutation(analyticsContract.funnel);
}

/**
 * 留存是 POST（对比轴是判别联合对象，query string 无法自然承载），
 * 但仍用 useQuery 而非 useMutation —— 它是读操作，切换筛选只需换 key 就能复用缓存。
 */
export function useAnalyticsRetention(params: AnalyticsRetentionParams) {
  return useApiQuery(analyticsContract.retention, { body: params }, { placeholderData: keepPreviousData });
}

/** 图表下钻用户列表：漏斗某步流失 / 留存某周期未回访 → 具体是谁；未打开抽屉时不发请求 */
export function useAnalyticsDrillUsers(input: AnalyticsDrillUsersInput | null) {
  return useApiQuery(analyticsContract.drillUsers, { body: input! }, {
    enabled: input !== null,
    placeholderData: keepPreviousData,
  });
}

export function useAnalyticsAcquisition(params: AnalyticsAcquisitionParams) {
  return useApiQuery(analyticsContract.acquisition, { query: params }, { placeholderData: keepPreviousData });
}

/** 事件分析是读操作，用 query 而非 mutation：翻页只需改 key，不必手动重放提交 */
export function useAnalyticsEventQuery(input: AnalyticsEventQueryInput | null) {
  return useApiQuery(analyticsContract.queryEvents, { body: input! }, {
    enabled: input !== null,
    placeholderData: keepPreviousData,
  });
}

export function useAnalyticsPath(days: number, startPage?: string, limit = 30) {
  return useApiQuery(analyticsContract.path, { query: { days, limit, startPage: startPage || undefined } }, {
    placeholderData: keepPreviousData,
  });
}

// ─── 保存的漏斗报表 ───────────────────────────────────────────────────────────

export function useSavedFunnelReports(enabled = true) {
  return useApiQuery(analyticsContract.reports, { query: { type: 'funnel' } }, { enabled });
}

export function useSaveFunnelReport() {
  return useApiMutation(analyticsContract.createReport, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: analyticsKeys.savedReports }),
  });
}

export function useDeleteFunnelReport() {
  return useApiMutation(analyticsContract.removeReport, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: analyticsKeys.savedReports }),
  });
}

// ─── 热力图 ───────────────────────────────────────────────────────────────────

export function useAnalyticsHeatmapPages(days: number) {
  return useApiQuery(analyticsContract.heatmapPages, { query: { days } });
}

export function useAnalyticsHeatmap(pagePath: string, componentArea: string, days: number, deviceType?: AnalyticsDeviceType, source?: AnalyticsEventSource) {
  return useApiQuery(analyticsContract.heatmap, { query: { pagePath, componentArea: componentArea || undefined, days, deviceType, source } }, {
    enabled: !!pagePath,
  });
}

// ─── 事件数据管理 ─────────────────────────────────────────────────────────────

export function useAnalyticsEvents(params: AnalyticsEventsParams) {
  return useApiQuery(analyticsContract.events, { query: params }, { placeholderData: keepPreviousData });
}

export function useAnalyticsEventDetail(id: number | undefined, enabled = true) {
  return useApiQuery(analyticsContract.eventDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useCleanAnalyticsEvents() {
  return useApiMutation(analyticsContract.clean, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: analyticsKeys.all }),
  });
}

// ─── 事件字典（Tracking Plan）─────────────────────────────────────────────────

export function useAnalyticsEventMeta(params: AnalyticsMetaParams) {
  return useApiQuery(analyticsContract.eventMeta, { query: params }, { placeholderData: keepPreviousData });
}

/** 事件字典下游引用查询配置：hook 与删除确认的 fetchQuery 共用，避免两份 queryFn */
export function eventMetaReferencesQueryOptions(eventName: string) {
  return apiQueryOptions(analyticsContract.eventMetaReferences, { query: { eventName } }, { staleTime: 30_000 });
}

export function useEventMetaReferences(eventName: string | undefined, enabled = true) {
  return useQuery({
    ...eventMetaReferencesQueryOptions(eventName ?? ''),
    enabled: enabled && !!eventName,
  });
}

export function useSaveAnalyticsEventMeta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: SaveValues<typeof analyticsContract.createEventMeta> }) =>
      (id === undefined
        ? api(analyticsContract.createEventMeta, { body: values } as InputOf<typeof analyticsContract.createEventMeta>)
        : api(analyticsContract.updateEventMeta, { params: { id }, body: values })),
    onSuccess: () => invalidateAnalyticsData(qc),
  });
}

export function useDeleteAnalyticsEventMeta() {
  return useApiMutation(analyticsContract.removeEventMeta, { invalidate: invalidateAnalyticsData });
}

// ─── 采集设置 / 每日聚合 ──────────────────────────────────────────────────────

export function useAnalyticsSettings(enabled = true) {
  return useApiQuery(analyticsContract.settings, { enabled });
}

export function useSaveAnalyticsSettings() {
  return useApiMutation(analyticsContract.updateSettings, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: analyticsKeys.all }),
    onSuccess: () => {
      // 设置热更新：当前标签页立即重拉配置；写入版本号触发同浏览器其它标签页的 storage 事件重拉
      reloadTrackerConfig();
      try { localStorage.setItem(ANALYTICS_CONFIG_VERSION_KEY, String(Date.now())); } catch { /* storage unavailable */ }
    },
  });
}

export function useAnalyticsRollup(days: number, enabled = true) {
  return useApiQuery(analyticsContract.rollup, { query: { days } }, { enabled });
}

export function useRebuildAnalyticsRollup() {
  return useApiMutation(analyticsContract.rebuildRollup, { invalidate: invalidateAnalyticsData });
}

// ─── 租户级事件启停覆盖 ───────────────────────────────────────────────────────

export function useAnalyticsEventOverrides(params: AnalyticsOverrideParams, enabled = true) {
  return useApiQuery(analyticsContract.eventOverrides, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useSaveAnalyticsEventOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: SaveValues<typeof analyticsContract.createEventOverride> }) =>
      (id === undefined
        ? api(analyticsContract.createEventOverride, { body: values } as InputOf<typeof analyticsContract.createEventOverride>)
        : api(analyticsContract.updateEventOverride, { params: { id }, body: values })),
    onSuccess: () => invalidateAnalyticsData(qc),
  });
}

export function useDeleteAnalyticsEventOverride() {
  return useApiMutation(analyticsContract.removeEventOverride, { invalidate: invalidateAnalyticsData });
}

// ─── 埋点质量看板 / 事件调试流 ────────────────────────────────────────────────

export function useAnalyticsQuality(params: AnalyticsQualityParams, enabled = true) {
  return useApiQuery(analyticsContract.quality, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useAnalyticsDebugEvents(params: AnalyticsDebugEventsParams, enabled = true) {
  return useApiQuery(analyticsContract.debugEvents, { query: params }, {
    enabled,
    placeholderData: keepPreviousData,
    requestOptions: { silent: true },
  });
}

// ─── 站点管理 ─────────────────────────────────────────────────────────────────

export function useAnalyticsSites(params: AnalyticsSiteListParams) {
  return useApiQuery(analyticsSiteContract.sites, { query: params }, { placeholderData: keepPreviousData });
}

const invalidateSites = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: analyticsKeys.data.sitesLists });

export function useCreateSite() {
  return useApiMutation(analyticsSiteContract.createSite, { invalidate: invalidateSites });
}

export function useUpdateSite() {
  return useApiMutation(analyticsSiteContract.updateSite, { invalidate: invalidateSites });
}

export function useDeleteSite() {
  return useApiMutation(analyticsSiteContract.removeSite, { invalidate: invalidateSites });
}

export function useRegenerateSiteKey() {
  return useApiMutation(analyticsSiteContract.regenerateSiteKey, { invalidate: invalidateSites });
}

// ─── A/B 实验 ─────────────────────────────────────────────────────────────────

export function useExperiments(params: AnalyticsExperimentListParams) {
  return useApiQuery(analyticsExperimentContract.experiments, { query: params }, { placeholderData: keepPreviousData });
}

export function useExperiment(id: number | undefined, enabled = true) {
  return useApiQuery(analyticsExperimentContract.experimentDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

const invalidateExperiments = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: analyticsKeys.data.experimentsLists });

/** 列表与详情都会随状态 / 配置变化，报告口径不变故不失效 */
const invalidateExperiment = (qc: QueryClient, _output: unknown, input: { params: { id: number } }) => {
  invalidateExperiments(qc);
  void qc.invalidateQueries({ queryKey: analyticsKeys.data.experimentDetail(input.params.id) });
};

export function useCreateExperiment() {
  return useApiMutation(analyticsExperimentContract.createExperiment, { invalidate: invalidateExperiments });
}

export function useUpdateExperiment() {
  return useApiMutation(analyticsExperimentContract.updateExperiment, { invalidate: invalidateExperiment });
}

export function useDeleteExperiment() {
  return useApiMutation(analyticsExperimentContract.removeExperiment, { invalidate: invalidateExperiments });
}

const EXPERIMENT_ACTIONS = {
  start: analyticsExperimentContract.startExperiment,
  pause: analyticsExperimentContract.pauseExperiment,
  complete: analyticsExperimentContract.completeExperiment,
} as const;

export function useExperimentAction(action: keyof typeof EXPERIMENT_ACTIONS) {
  return useApiMutation(EXPERIMENT_ACTIONS[action], { invalidate: invalidateExperiment });
}

export function useExperimentReport(id: number | undefined, params: AnalyticsExperimentReportParams, enabled = true) {
  return useApiQuery(analyticsExperimentContract.experimentReport, { params: { id: id ?? 0 }, query: params }, {
    enabled: enabled && id !== undefined,
  });
}

// ─── 用户分群 ─────────────────────────────────────────────────────────────────

export function useAnalyticsSegments(params: AnalyticsSegmentListParams) {
  return useApiQuery(analyticsContract.segments, { query: params }, { placeholderData: keepPreviousData });
}

export function useAnalyticsSegmentDetail(id: number | undefined, enabled = true) {
  return useApiQuery(analyticsContract.segmentDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useAnalyticsSegmentMembers(id: number | undefined, params: AnalyticsSegmentMembersParams, enabled = true) {
  return useApiQuery(analyticsContract.segmentMembers, { params: { id: id ?? 0 }, query: params }, {
    placeholderData: keepPreviousData,
    enabled: enabled && id !== undefined,
  });
}

const invalidateSegments = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: analyticsKeys.data.segmentsLists });

export function useSaveAnalyticsSegment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: SaveValues<typeof analyticsContract.createSegment> }) =>
      (id === undefined
        ? api(analyticsContract.createSegment, { body: values } as InputOf<typeof analyticsContract.createSegment>)
        : api(analyticsContract.updateSegment, { params: { id }, body: values })),
    onSuccess: () => invalidateSegments(qc),
  });
}

export function useDeleteAnalyticsSegment() {
  return useApiMutation(analyticsContract.removeSegment, { invalidate: invalidateSegments });
}

export function useMaterializeAnalyticsSegment() {
  return useApiMutation(analyticsContract.materializeSegment, { invalidate: invalidateSegments });
}

// ─── 分群触达 ─────────────────────────────────────────────────────────────────

export function useCampaigns(params: AnalyticsCampaignListParams, enabled = true, refetchInterval?: number | false) {
  return useApiQuery(analyticsCampaignContract.campaigns, { query: params }, {
    placeholderData: keepPreviousData,
    enabled,
    refetchInterval,
  });
}

const invalidateCampaigns = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: analyticsKeys.data.campaignsLists });

export function useCreateCampaign() {
  return useApiMutation(analyticsCampaignContract.createCampaign, { invalidate: invalidateCampaigns });
}

export function useUpdateCampaign() {
  return useApiMutation(analyticsCampaignContract.updateCampaign, { invalidate: invalidateCampaigns });
}

export function useDeleteCampaign() {
  return useApiMutation(analyticsCampaignContract.removeCampaign, { invalidate: invalidateCampaigns });
}

export function useExecuteCampaign() {
  return useApiMutation(analyticsCampaignContract.executeCampaign, { invalidate: invalidateCampaigns });
}

// ─── 前端错误监控 ─────────────────────────────────────────────────────────────

export function useFrontendErrorOverview(days: number, enabled = true) {
  return useApiQuery(frontendErrorContract.overview, { query: { days } }, { enabled });
}

export function useFrontendErrorGroups(params: FrontendErrorGroupParams, enabled = true) {
  return useApiQuery(frontendErrorContract.groups, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useFrontendErrorGroupDetail(id: number | undefined, enabled = true) {
  return useApiQuery(frontendErrorContract.groupDetail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

/** 错误分组指派人候选：后台用户列表（identity 域契约） */
export function useFrontendAdminUsers(enabled = true) {
  return useApiQuery(userContract.list, { query: { page: 1, pageSize: 100 } }, {
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

const invalidateFrontendErrors = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.all });

export function useUpdateFrontendErrorGroup() {
  return useApiMutation(frontendErrorContract.updateGroup, { invalidate: invalidateFrontendErrors });
}

export function useBatchUpdateFrontendErrorGroups() {
  return useApiMutation(frontendErrorContract.batchUpdateGroupStatus, { invalidate: invalidateFrontendErrors });
}

export function useBatchDeleteFrontendErrorGroups() {
  return useApiMutation(frontendErrorContract.batchDeleteGroups, { invalidate: invalidateFrontendErrors });
}

export function useFrontendErrorEvents(params: FrontendErrorEventParams, enabled = true) {
  return useApiQuery(frontendErrorContract.events, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useFrontendSourceMaps(params: FrontendSourceMapParams, enabled = true) {
  return useApiQuery(frontendErrorContract.sourceMaps, { query: params }, { placeholderData: keepPreviousData, enabled });
}

const invalidateSourceMaps = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.sourceMapsLists });

export function useDeleteFrontendSourceMap() {
  return useApiMutation(frontendErrorContract.removeSourceMap, { invalidate: invalidateSourceMaps });
}

export function useSubmitFrontendSourceMap() {
  return useApiMutation(frontendErrorContract.uploadSourceMap, { invalidate: invalidateSourceMaps });
}

export function useFrontendAlerts(params: FrontendSimplePageParams, enabled = true) {
  return useApiQuery(frontendErrorContract.alerts, { query: params }, { placeholderData: keepPreviousData, enabled });
}

const invalidateAlerts = (qc: QueryClient) => void qc.invalidateQueries({ queryKey: analyticsKeys.frontendErrors.alertsLists });

export function useSaveFrontendAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: SaveValues<typeof frontendErrorContract.createAlert> }) =>
      (id === undefined
        ? api(frontendErrorContract.createAlert, { body: values } as InputOf<typeof frontendErrorContract.createAlert>)
        : api(frontendErrorContract.updateAlert, { params: { id }, body: values })),
    onSuccess: () => invalidateAlerts(qc),
  });
}

export function useDeleteFrontendAlert() {
  return useApiMutation(frontendErrorContract.removeAlert, { invalidate: invalidateAlerts });
}

export function useFrontendAlertLogs(params: FrontendAlertLogParams, enabled = true) {
  return useApiQuery(frontendErrorContract.alertLogs, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useTestFrontendAlert() {
  return useApiMutation(frontendErrorContract.testAlert);
}
