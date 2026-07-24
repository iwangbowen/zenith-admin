import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AsyncTask,
  CmsDistributionMode,
  CmsDistributionRule,
  CmsDistributionRun,
  CmsDistributionRunDetail,
  CmsSite,
  CmsSiteEffectiveConfig,
  CmsSiteInheritanceFlags,
  PaginatedResponse,
} from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';
import { cmsSiteKeys } from './cms';
import { cmsPublishingKeys } from './cms-stage3';

export interface CmsSiteTreeParams {
  keyword?: string;
  status?: string;
}

export const cmsSiteHierarchyKeys = {
  all: ['cms-site-hierarchy'] as const,
  tree: (params: CmsSiteTreeParams) => ['cms-site-hierarchy', 'tree', params] as const,
  chain: (siteId: number | undefined) => ['cms-site-hierarchy', 'chain', siteId] as const,
  effective: (siteId: number | undefined) => ['cms-site-hierarchy', 'effective', siteId] as const,
};

export function useCmsSiteTree(params: CmsSiteTreeParams, enabled = true) {
  return useQuery({
    queryKey: cmsSiteHierarchyKeys.tree(params),
    queryFn: () => request.get<CmsSite[]>(`/api/cms/sites/tree${toQueryString(params)}`).then(unwrap),
    enabled,
  });
}

export function useCmsSiteInheritanceChain(siteId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsSiteHierarchyKeys.chain(siteId),
    queryFn: () => request.get<Array<{
      id: number;
      parentId: number | null;
      name: string;
      code: string;
      depth: number;
      status: 'enabled' | 'disabled';
    }>>(`/api/cms/sites/${siteId}/inheritance-chain`).then(unwrap),
    enabled: enabled && siteId !== undefined,
  });
}

export function useCmsSiteEffectiveConfig(siteId: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsSiteHierarchyKeys.effective(siteId),
    queryFn: () => request.get<CmsSiteEffectiveConfig>(`/api/cms/sites/${siteId}/effective-config`).then(unwrap),
    enabled: enabled && siteId !== undefined,
  });
}

export function useMoveCmsSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, parentId }: { siteId: number; parentId: number | null }) =>
      request.put<{ site: CmsSite; affectedSiteIds: number[]; maxDepth: number }>(
        `/api/cms/sites/${siteId}/parent`,
        { parentId },
      ).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.all });
      void qc.invalidateQueries({ queryKey: cmsSiteHierarchyKeys.all });
    },
  });
}

export function useUpdateCmsSiteInheritance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ siteId, inheritance }: { siteId: number; inheritance: Partial<CmsSiteInheritanceFlags> }) =>
      request.put<{
        inheritance: CmsSiteInheritanceFlags;
        effectiveConfig: CmsSiteEffectiveConfig;
        affectedSiteIds: number[];
      }>(`/api/cms/sites/${siteId}/inheritance`, inheritance).then(unwrap),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.all });
      void qc.invalidateQueries({ queryKey: cmsSiteHierarchyKeys.all });
      void qc.invalidateQueries({ queryKey: cmsSiteHierarchyKeys.effective(variables.siteId) });
      void qc.invalidateQueries({ queryKey: cmsPublishingKeys.all });
    },
  });
}

export function useSubmitCmsSiteGroupPublish() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rootSiteId, reason }: { rootSiteId: number; reason?: string }) =>
      request.post<{ rootSiteId: number; targetSiteIds: number[]; tasks: AsyncTask[] }>(
        '/api/cms/publishing/group-submit',
        { rootSiteId, reason: reason ?? null },
      ).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsPublishingKeys.all });
      void qc.invalidateQueries({ queryKey: ['async-tasks', 'mine'] });
    },
  });
}

export interface CmsDistributionRuleListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  sourceSiteId?: number;
  targetSiteId?: number;
  mode?: CmsDistributionMode;
  status?: string;
}

export interface CmsDistributionRunListParams {
  page: number;
  pageSize: number;
  ruleId?: number;
  siteId?: number;
  status?: string;
  startTime?: string;
  endTime?: string;
}

export const cmsDistributionKeys = {
  all: ['cms-distributions'] as const,
  lists: ['cms-distributions', 'list'] as const,
  list: (params: CmsDistributionRuleListParams) => ['cms-distributions', 'list', params] as const,
  detail: (id: number | undefined) => ['cms-distributions', 'detail', id] as const,
  runs: ['cms-distributions', 'runs'] as const,
  runList: (params: CmsDistributionRunListParams) => ['cms-distributions', 'runs', params] as const,
  runDetail: (id: number | undefined) => ['cms-distributions', 'runs', 'detail', id] as const,
};

export function useCmsDistributionRuleList(params: CmsDistributionRuleListParams, enabled = true) {
  return useQuery({
    queryKey: cmsDistributionKeys.list(params),
    queryFn: () => request
      .get<PaginatedResponse<CmsDistributionRule>>(`/api/cms/distributions${toQueryString(params)}`)
      .then(unwrap),
    enabled,
    placeholderData: keepPreviousData,
  });
}

export function useCmsDistributionRule(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsDistributionKeys.detail(id),
    queryFn: () => request.get<CmsDistributionRule>(`/api/cms/distributions/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useSaveCmsDistributionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined
        ? request.post<CmsDistributionRule>('/api/cms/distributions', values)
        : request.put<CmsDistributionRule>(`/api/cms/distributions/${id}`, values)
      ).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsDistributionKeys.all }),
  });
}

export function useDeleteCmsDistributionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/cms/distributions/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: cmsDistributionKeys.all }),
  });
}

export function useRunCmsDistributionRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.post<AsyncTask>(`/api/cms/distributions/${id}/run`).then(unwrap),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: cmsDistributionKeys.all });
      void qc.invalidateQueries({ queryKey: ['async-tasks', 'mine'] });
    },
  });
}

export function useCmsDistributionRunList(params: CmsDistributionRunListParams, enabled = true) {
  return useQuery({
    queryKey: cmsDistributionKeys.runList(params),
    queryFn: () => request
      .get<PaginatedResponse<CmsDistributionRun>>(`/api/cms/distributions/runs${toQueryString(params)}`)
      .then(unwrap),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.list.some((run) => ['pending', 'running'].includes(run.status)) ? 3000 : false,
  });
}

export function useCmsDistributionRunDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: cmsDistributionKeys.runDetail(id),
    queryFn: () => request.get<CmsDistributionRunDetail>(`/api/cms/distributions/runs/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
    refetchInterval: (query) =>
      query.state.data && ['pending', 'running'].includes(query.state.data.run.status) ? 3000 : false,
  });
}
