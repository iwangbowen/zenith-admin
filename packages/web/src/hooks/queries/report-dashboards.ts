import { useCallback } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type BodyOf, type QueryOf } from '@zenith/shared/core';
import {
  reportCategoryContract,
  reportDashboardContract,
  reportDashboardOpsContract,
  reportExecutionContract,
  reportPublicContract,
  type ReportDashboard,
  type ReportDashboardCategory,
  type ReportDatasetQueryOptions,
  type ReportWidget,
  type ReportWidgetDataResult,
} from '@zenith/shared/report';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { useReportLookup, type ReportLookupParams } from './report-lookups';

export type ReportDashboardListParams = NonNullable<QueryOf<typeof reportDashboardContract.list>>;
export type ReportDashboardCommentListParams = NonNullable<QueryOf<typeof reportDashboardOpsContract.comments>>;
export type ReportDashboardViewMode = NonNullable<NonNullable<QueryOf<typeof reportDashboardContract.detail>>['mode']>;

/** 仪表盘取数请求体（筛选值 / 行数上限 / 组件级查询选项） */
type DashboardDataBody = BodyOf<typeof reportDashboardContract.data>;

const sortIds = (ids: number[]) => [...ids].sort((a, b) => a - b);

export const reportDashboardKeys = {
  /** 仪表盘 CRUD 与运维操作共用资源根路径，该前缀覆盖两个契约组的全部查询 */
  all: [resourceKeyOf(reportDashboardContract.basePath)] as const,
  lists: contractKey(reportDashboardContract.list),
  list: (params: ReportDashboardListParams) => contractKey(reportDashboardContract.list, { query: params }),
  /** 某个看板的全部模式（auto / draft / published）详情 */
  detailOf: (id: number | undefined) => contractKey(reportDashboardContract.detail, { params: { id: id ?? 0 }, query: {} }),
  detail: (id: number | undefined, mode: ReportDashboardViewMode = 'auto') =>
    contractKey(reportDashboardContract.detail, { params: { id: id ?? 0 }, query: { mode } }),
  batch: (ids: number[], mode: ReportDashboardViewMode = 'auto') =>
    contractKey(reportDashboardContract.batch, { body: { ids: sortIds(ids), mode } }),
  categories: contractKey(reportCategoryContract.list),
  healthSummary: (dashboardId: number | undefined, params: { startAt?: string; endAt?: string }) =>
    contractKey(reportExecutionContract.stats, { query: { dashboardId, ...params } }),
  commentsOf: (id: number | undefined) => contractKey(reportDashboardOpsContract.comments, { params: { id: id ?? 0 }, query: {} }),
  comments: (id: number | undefined, params: ReportDashboardCommentListParams) =>
    contractKey(reportDashboardOpsContract.comments, { params: { id: id ?? 0 }, query: params }),
  shares: (id: number | undefined) => contractKey(reportDashboardOpsContract.shares, { params: { id: id ?? 0 } }),
  embedTokens: (id: number | undefined) => contractKey(reportDashboardOpsContract.embedTokens, { params: { id: id ?? 0 } }),
  versions: (id: number | undefined) => contractKey(reportDashboardOpsContract.versions, { params: { id: id ?? 0 } }),
  versionDiff: (dashboardId: number | undefined, left: number, right: number) =>
    contractKey(reportDashboardOpsContract.versionDiff, { params: { id: dashboardId ?? 0 }, query: { left, right } }),
  /**
   * 某个看板的全部组件取数。一屏可能扇出数十个数据集查询，
   * 是本域最贵的缓存，只有看板内容真正变化时才允许失效。
   */
  dataOf: (dashboardId: number | undefined) =>
    contractKey(reportDashboardContract.data, { params: { id: dashboardId ?? 0 }, query: {}, body: {} }),
  dashboardData: (dashboardId: number | undefined, mode: ReportDashboardViewMode, body: DashboardDataBody) =>
    contractKey(reportDashboardContract.data, { params: { id: dashboardId ?? 0 }, query: { mode }, body }),
  publicDashboard: (token: string | undefined, session: string | undefined) =>
    [...contractKey(reportPublicContract.dashboard, { params: { token: token ?? '' } }), session ?? ''] as const,
  publicData: (token: string | undefined, session: string | undefined, body: DashboardDataBody) =>
    [...contractKey(reportPublicContract.dashboardData, { params: { token: token ?? '' }, body }), session ?? ''] as const,
};

export function useReportDashboardList(params: ReportDashboardListParams) {
  return useApiQuery(reportDashboardContract.list, { query: params }, { placeholderData: keepPreviousData });
}

export function useReportDashboardCategories() {
  return useApiQuery(reportCategoryContract.list);
}

export function useReportDashboardCategoryLookup(params: Pick<ReportLookupParams, 'keyword' | 'limit'> = {}, enabled = true) {
  return useReportLookup('categories', params, enabled);
}

export function useReportDashboardLookup(params: ReportLookupParams = {}, enabled = true) {
  return useReportLookup('dashboards', params, enabled);
}

export function useReportDashboardDetail(id: number | undefined, enabled = true, mode: ReportDashboardViewMode = 'auto') {
  return useApiQuery(reportDashboardContract.detail, { params: { id: id ?? 0 }, query: { mode } }, { enabled: enabled && !!id });
}

export function useReportDashboardBatch(ids: number[], enabled = true, mode: ReportDashboardViewMode = 'auto') {
  return useQuery({
    queryKey: reportDashboardKeys.batch(ids, mode),
    queryFn: () => api(reportDashboardContract.batch, { body: { ids, mode } }),
    enabled: enabled && ids.length > 0,
  });
}

/** 保存会改写看板内容：详情（各模式）、列表与该看板的取数结果都要回源 */
function invalidateDashboardContent(qc: ReturnType<typeof useQueryClient>, id: number) {
  void qc.invalidateQueries({ queryKey: reportDashboardKeys.lists });
  void qc.invalidateQueries({ queryKey: reportDashboardKeys.detailOf(id) });
  void qc.invalidateQueries({ queryKey: reportDashboardKeys.dataOf(id) });
}

export type SaveReportDashboardValues = Partial<BodyOf<typeof reportDashboardContract.create>> & { expectedRevision?: number };

/** 无 id 走 create，有 id 走 update（供 useEditModal 使用；编辑时必须携带 expectedRevision） */
export function useSaveReportDashboard() {
  const qc = useQueryClient();
  return useMutation<ReportDashboard, Error, { id?: number; values: SaveReportDashboardValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(reportDashboardContract.create, { body: values as BodyOf<typeof reportDashboardContract.create> })
      : api(reportDashboardContract.update, { params: { id }, body: values as BodyOf<typeof reportDashboardContract.update> })),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.lists });
      if (vars.id) invalidateDashboardContent(qc, vars.id);
    },
  });
}

/** 发布会改变 published 模式下的取数结果，版本与分享随之刷新 */
export function usePublishReportDashboard() {
  return useApiMutation(reportDashboardContract.publish, {
    invalidate: (qc, _output, { params }) => {
      invalidateDashboardContent(qc, params.id);
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.versions(params.id) });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.shares(params.id) });
    },
  });
}

export function useOfflineReportDashboard() {
  return useApiMutation(reportDashboardContract.offline, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.lists });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.detailOf(params.id) });
    },
  });
}

/** 看板已删除：详情、取数、版本、分享都不再有对应资源 */
export function useDeleteReportDashboard() {
  return useApiMutation(reportDashboardContract.remove, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: reportDashboardKeys.detailOf(params.id) });
      qc.removeQueries({ queryKey: reportDashboardKeys.dataOf(params.id) });
      qc.removeQueries({ queryKey: reportDashboardKeys.versions(params.id) });
      qc.removeQueries({ queryKey: reportDashboardKeys.shares(params.id) });
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.lists });
    },
  });
}

export function useBatchReportDashboardStatus() {
  return useApiMutation(reportDashboardContract.batchStatus, {
    invalidate: (qc, _output, { body }) => {
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.lists });
      for (const id of body.ids) void qc.invalidateQueries({ queryKey: reportDashboardKeys.detailOf(id) });
    },
  });
}

/** 克隆只新增一条记录，源看板与其取数结果都不受影响 */
export function useCloneReportDashboard() {
  return useApiMutation(reportDashboardContract.clone, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.lists }),
  });
}

export type SaveReportDashboardCategoryValues = Partial<BodyOf<typeof reportCategoryContract.create>>;

/** 无 id 走 create，有 id 走 update（供 useEditModal 使用） */
export function useSaveReportDashboardCategory() {
  const qc = useQueryClient();
  return useMutation<ReportDashboardCategory, Error, { id?: number; values: SaveReportDashboardCategoryValues }>({
    mutationFn: ({ id, values }) => (id === undefined
      ? api(reportCategoryContract.create, { body: values as BodyOf<typeof reportCategoryContract.create> })
      : api(reportCategoryContract.update, { params: { id }, body: values })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: reportDashboardKeys.categories }),
  });
}

export function useDeleteReportDashboardCategory() {
  return useApiMutation(reportCategoryContract.remove, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.categories }),
  });
}

export function useReportDashboardHealthSummary(
  dashboardId: number | undefined,
  params: { startAt?: string; endAt?: string } = {},
  enabled = true,
) {
  return useApiQuery(reportExecutionContract.stats, { query: { dashboardId, ...params } }, { enabled: enabled && !!dashboardId });
}

/** 收藏只是列表上的一个标记，不影响详情与取数 */
export function useToggleReportDashboardFavorite() {
  return useApiMutation(reportDashboardOpsContract.favorite, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.lists }),
  });
}

// ─── 评论 ───────────────────────────────────────────────────────────────────

export function useReportDashboardComments(id: number | undefined, params: ReportDashboardCommentListParams, enabled = true) {
  return useApiQuery(reportDashboardOpsContract.comments, { params: { id: id ?? 0 }, query: params }, {
    enabled: enabled && !!id,
    placeholderData: keepPreviousData,
    requestOptions: { silent: true },
  });
}

const commentMutation = { requestOptions: { silent: true } } as const;

export function useCreateReportDashboardComment() {
  return useApiMutation(reportDashboardOpsContract.createComment, {
    ...commentMutation,
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.commentsOf(params.id) }),
  });
}

export function useUpdateReportDashboardComment() {
  return useApiMutation(reportDashboardOpsContract.updateComment, {
    ...commentMutation,
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.commentsOf(params.id) }),
  });
}

export function useResolveReportDashboardComment() {
  return useApiMutation(reportDashboardOpsContract.resolveComment, {
    ...commentMutation,
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.commentsOf(params.id) }),
  });
}

export function useDeleteReportDashboardComment() {
  return useApiMutation(reportDashboardOpsContract.removeComment, {
    ...commentMutation,
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.commentsOf(params.id) }),
  });
}

// ─── 分享 / 嵌入令牌 ───────────────────────────────────────────────────────

export function useReportDashboardShares(id: number | undefined, enabled = true) {
  return useApiQuery(reportDashboardOpsContract.shares, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

export function useCreateReportDashboardShare() {
  return useApiMutation(reportDashboardOpsContract.createShare, {
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.shares(params.id) }),
  });
}

export function useUpdateReportDashboardShare() {
  return useApiMutation(reportDashboardOpsContract.updateShare, {
    invalidate: (qc, share) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.shares(share.dashboardId) }),
  });
}

/** 删除接口不返回实体，调用方随变量携带 dashboardId 以定位失效范围 */
export function useDeleteReportDashboardShare() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId }: { shareId: number; dashboardId: number }) =>
      api(reportDashboardOpsContract.removeShare, { params: { shareId } }),
    onSuccess: (_data, vars) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.shares(vars.dashboardId) }),
  });
}

export function useReportDashboardEmbedTokens(id: number | undefined, enabled = true) {
  return useApiQuery(reportDashboardOpsContract.embedTokens, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

export function useCreateReportDashboardEmbedToken() {
  return useApiMutation(reportDashboardOpsContract.createEmbedToken, {
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.embedTokens(params.id) }),
  });
}

/** 撤销接口不返回实体，调用方随变量携带 dashboardId 以定位失效范围 */
export function useRevokeReportDashboardEmbedToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ embedTokenId }: { embedTokenId: number; dashboardId: number }) =>
      api(reportDashboardOpsContract.revokeEmbedToken, { params: { embedTokenId } }),
    onSuccess: (_data, vars) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.embedTokens(vars.dashboardId) }),
  });
}

// ─── 版本 ───────────────────────────────────────────────────────────────────

export function useReportDashboardVersions(id: number | undefined, enabled = true) {
  return useApiQuery(reportDashboardOpsContract.versions, { params: { id: id ?? 0 } }, { enabled: enabled && !!id });
}

export function useReportDashboardVersionDiff(dashboardId: number | undefined, left: number, right: number, enabled = true) {
  return useApiQuery(reportDashboardOpsContract.versionDiff, { params: { id: dashboardId ?? 0 }, query: { left, right } }, {
    enabled: enabled && !!dashboardId,
  });
}

export function useSaveReportDashboardVersion() {
  return useApiMutation(reportDashboardOpsContract.createVersion, {
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: reportDashboardKeys.versions(params.id) }),
  });
}

/** 回滚会改写草稿内容，取数结果随之失效 */
export function useRestoreReportDashboardVersion() {
  return useApiMutation(reportDashboardOpsContract.restoreVersion, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: reportDashboardKeys.versions(params.id) });
      invalidateDashboardContent(qc, params.id);
    },
  });
}

// ─── 组件取数 ───────────────────────────────────────────────────────────────

export interface DashboardWidgetDataState {
  data: ReportWidgetDataResult['data'] | null;
  loading: boolean;
  error: string | null;
}

const EMPTY_WIDGET_STATE: DashboardWidgetDataState = { data: null, loading: false, error: null };

function buildStableJitter(base: number | false | undefined, key: string): number | false | undefined {
  if (!base || base <= 0) return base;
  const hash = Array.from(key).reduce((acc, char) => ((acc * 31) + char.charCodeAt(0)) % 9973, 17);
  const delta = Math.max(250, Math.min(3000, Math.round(base * 0.08)));
  return base + (hash % (delta * 2 + 1)) - delta;
}

export function useReportDashboardWidgetData(
  dashboardId: number | undefined,
  widgets: ReportWidget[],
  filterValues: Record<string, unknown>,
  options?: {
    limit?: number;
    refetchInterval?: number | false;
    widgetQueries?: Record<string, ReportDatasetQueryOptions>;
    mode?: ReportDashboardViewMode;
  },
) {
  const queryClient = useQueryClient();
  const limit = options?.limit ?? 500;
  const mode = options?.mode ?? 'auto';
  const body: DashboardDataBody = { filters: filterValues, limit, widgetQueries: options?.widgetQueries };
  const queryKey = reportDashboardKeys.dashboardData(dashboardId, mode, body);
  const dataQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => api(reportDashboardContract.data, { params: { id: dashboardId ?? 0 }, query: { mode }, body }, { silent: true, signal }),
    enabled: !!dashboardId,
    refetchInterval: buildStableJitter(options?.refetchInterval, `dashboard:${dashboardId ?? 'none'}:${mode}`),
  });

  const get = useCallback((widget: ReportWidget): DashboardWidgetDataState => {
    if (!widget.datasetId) return EMPTY_WIDGET_STATE;
    const item = dataQuery.data?.[widget.i];
    return {
      data: item?.data ?? null,
      loading: dataQuery.isFetching,
      error: item?.error?.message ?? (dataQuery.error instanceof Error ? dataQuery.error.message : null),
    };
  }, [dataQuery.data, dataQuery.error, dataQuery.isFetching]);

  const widgetQueries = options?.widgetQueries;
  const refresh = useCallback(() => {
    void queryClient.refetchQueries({
      queryKey: reportDashboardKeys.dashboardData(dashboardId, mode, { filters: filterValues, limit, widgetQueries }),
      type: 'active',
    });
  }, [dashboardId, filterValues, limit, mode, widgetQueries, queryClient]);

  return { get, refresh, query: dataQuery };
}

// ─── 公开分享 ───────────────────────────────────────────────────────────────

const publicRequest = { skipAuth: true, silent: true } as const;

/** 密码验证并签发访问会话；code !== 0 时以 ApiError 抛出（401 = 密码错误） */
export function usePublicReportDashboardAccess() {
  return useApiMutation(reportPublicContract.access, { requestOptions: publicRequest });
}

export function usePublicReportDashboard(token: string | undefined, session: string | undefined, enabled = true) {
  return useQuery({
    queryKey: reportDashboardKeys.publicDashboard(token, session),
    queryFn: () => api(reportPublicContract.dashboard, { params: { token: token ?? '' } }, {
      ...publicRequest,
      headers: session ? { session } : undefined,
    }),
    enabled: enabled && !!token && !!session,
  });
}

export function usePublicReportDashboardData(
  token: string | undefined,
  session: string | undefined,
  filters: Record<string, unknown>,
  widgetQueries?: Record<string, ReportDatasetQueryOptions>,
  enabled = true,
) {
  const body: DashboardDataBody = { filters, widgetQueries };
  return useQuery({
    queryKey: reportDashboardKeys.publicData(token, session, body),
    queryFn: ({ signal }) => api(reportPublicContract.dashboardData, { params: { token: token ?? '' }, body }, {
      ...publicRequest,
      signal,
      headers: session ? { session } : undefined,
    }),
    enabled: enabled && !!token && !!session,
  });
}
