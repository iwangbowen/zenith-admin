import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { QueryOf } from '@zenith/shared/core';
import { cmsSiteContract, CMS_TEMPLATE_RESOLUTION_SOURCE_LABELS, type CmsThemeTemplateManifest } from '@zenith/shared/cms';
import { api, apiQueryOptions, contractKey, createResourceQueries, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { cmsAdKeys } from './cms-ads';
import { cmsChannelKeys } from './cms-channels';
import { cmsContentKeys } from './cms-contents';
import { cmsFormKeys } from './cms-forms';
import { cmsFriendLinkKeys } from './cms-friend-links';
import { cmsPageKeys } from './cms-pages';
import { cmsResourceKeys } from './cms-resources';
import { cmsLinkWordKeys, cmsRedirectKeys } from './cms-seo';
import { cmsPublishingKeys } from './cms-stage3';
import { cmsTagKeys } from './cms-tags';

export type CmsSiteListParams = QueryOf<typeof cmsSiteContract.list>;

export type CmsSiteTreeParams = NonNullable<QueryOf<typeof cmsSiteContract.tree>>;

const resource = createResourceQueries(cmsSiteContract);

/**
 * 站点域 query keys。主题元数据（themes / themeTemplates / themeSettingsSchema，均为 LOOKUP_STALE_TIME）
 * 与站点增删改无因果关系，站点级动作只失效 lists / detail / lookup，不广播 `all`。
 */
export const cmsSiteKeys = {
  ...resource.keys,
  allSites: resource.keys.lookup,
  themes: (siteId?: number) => contractKey(cmsSiteContract.themes, { query: { siteId } }),
  themeTemplates: (code: string | undefined, siteId?: number) =>
    contractKey(cmsSiteContract.themeTemplates, { params: { code: code ?? '' }, query: { siteId } }),
  themeSettingsSchema: (code: string | undefined) => contractKey(cmsSiteContract.themeSettingsSchema, { params: { code: code ?? '' } }),
  templateHealth: (id: number | undefined, theme: string | undefined) =>
    contractKey(cmsSiteContract.templateHealth, { params: { id: id ?? 0 }, query: { theme } }),
  users: (siteId: number | undefined) => contractKey(cmsSiteContract.users, { params: { id: siteId ?? 0 } }),
  /** 站群层级视图：受权站点树 / 继承链 / 有效配置 */
  tree: (params: CmsSiteTreeParams) => contractKey(cmsSiteContract.tree, { query: params }),
  chain: (siteId: number | undefined) => contractKey(cmsSiteContract.inheritanceChain, { params: { id: siteId ?? 0 } }),
  effective: (siteId: number | undefined) => contractKey(cmsSiteContract.effectiveConfig, { params: { id: siteId ?? 0 } }),
  /** 全部层级视图的公共前缀（tree / chain / effective 都以各自操作名为第二段，故逐个列出） */
  hierarchy: [
    contractKey(cmsSiteContract.tree),
    contractKey(cmsSiteContract.inheritanceChain),
    contractKey(cmsSiteContract.effectiveConfig),
  ] as const,
  openGrants: (siteId: number | undefined) => contractKey(cmsSiteContract.openGrants, { params: { id: siteId ?? 0 } }),
};

export const useCmsSiteList = resource.useList;
export const useCmsSiteDetail = resource.useDetail;
export const useSaveCmsSite = resource.useSave;
/** 单个删除；成功后移除详情缓存并失效列表与站点下拉源 */
export const useDeleteCmsSites = resource.useDelete;

/** 全部启用站点（各 CMS 页面顶部站点切换器共用） */
export function useAllCmsSites() {
  return resource.useLookup();
}

export function useCmsThemes(siteId?: number) {
  return useApiQuery(cmsSiteContract.themes, { query: { siteId } }, { staleTime: LOOKUP_STALE_TIME });
}

/** 主题可选模板清单（站点默认模板 / 栏目 / 内容模板下拉） */
export function useCmsThemeTemplates(themeCode: string | undefined, siteId?: number) {
  return useQuery({
    queryKey: cmsSiteKeys.themeTemplates(themeCode, siteId),
    queryFn: () => api(cmsSiteContract.themeTemplates, { params: { code: themeCode ?? '' }, query: { siteId } })
      .then((catalog) => {
        const annotate = (items: CmsThemeTemplateManifest['list']) => items.map((item) => ({
          ...item,
          label: item.source
            ? `${item.label} · ${CMS_TEMPLATE_RESOLUTION_SOURCE_LABELS[item.source]}`
            : item.label,
        }));
        return { list: annotate(catalog.list), detail: annotate(catalog.detail) };
      }),
    enabled: !!themeCode,
    staleTime: LOOKUP_STALE_TIME,
  });
}

/** 主题参数声明（后台主题参数面板动态表单） */
export function useCmsThemeSettingsSchema(themeCode: string | undefined) {
  return useQuery({
    ...apiQueryOptions(cmsSiteContract.themeSettingsSchema, { params: { code: themeCode ?? '' } }),
    enabled: !!themeCode,
    staleTime: LOOKUP_STALE_TIME,
  });
}

/** 站点模板健康检查（失效模板引用扫描；theme 传目标主题可做切换前预检） */
export function useCmsSiteTemplateHealth(siteId: number | undefined, theme: string | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsSiteContract.templateHealth, { params: { id: siteId ?? 0 }, query: { theme } }),
    enabled: enabled && siteId !== undefined,
  });
}

// ─── 站点授权用户 ─────────────────────────────────────────────────────────────
export function useCmsSiteUsers(siteId: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsSiteContract.users, { params: { id: siteId ?? 0 } }),
    enabled: enabled && siteId !== undefined,
  });
}

/** 只改该站点的授权用户名单；站点本身、站点下拉源与主题元数据均不受影响 */
export function useSetCmsSiteUsers() {
  return useApiMutation(cmsSiteContract.setUsers, {
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: cmsSiteKeys.users(params.id) }),
  });
}

// ─── 开通行为统计 ─────────────────────────────────────────────────────────────
/**
 * 只在该站点上写入 siteKey；主题元数据（themes / themeTemplates / themeSettingsSchema，
 * 均为 5 分钟长缓存）与本次改动无因果关系，不应被打回源
 */
export function useEnableSiteAnalytics() {
  return useApiMutation(cmsSiteContract.enableAnalytics, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.detail(params.id) });
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.allSites });
    },
  });
}

// ─── 开放应用授权（Headless 写入的 fail-closed 边界）───────────────────────────
export function useCmsOpenGrants(siteId: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsSiteContract.openGrants, { params: { id: siteId ?? 0 } }),
    enabled: enabled && siteId !== undefined,
  });
}

export function useSaveCmsOpenGrant() {
  return useApiMutation(cmsSiteContract.saveOpenGrant, {
    invalidate: (qc, _output, { params }) => void qc.invalidateQueries({ queryKey: cmsSiteKeys.openGrants(params.id) }),
  });
}

/** 授权记录按 grantId 删除，不携带站点：失效全部站点的授权列表 */
export function useDeleteCmsOpenGrant() {
  return useApiMutation(cmsSiteContract.removeOpenGrant, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: contractKey(cmsSiteContract.openGrants) }),
  });
}

// ─── 站群层级：受权站点树 / 继承链 / 有效配置 / 移动 / 继承策略 ────────────────
function invalidateHierarchy(qc: ReturnType<typeof useQueryClient>) {
  for (const key of cmsSiteKeys.hierarchy) void qc.invalidateQueries({ queryKey: key });
}

export function useCmsSiteTree(params: CmsSiteTreeParams, enabled = true) {
  return useApiQuery(cmsSiteContract.tree, { query: params }, { enabled });
}

export function useCmsSiteInheritanceChain(siteId: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsSiteContract.inheritanceChain, { params: { id: siteId ?? 0 } }),
    enabled: enabled && siteId !== undefined,
  });
}

export function useCmsSiteEffectiveConfig(siteId: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsSiteContract.effectiveConfig, { params: { id: siteId ?? 0 } }),
    enabled: enabled && siteId !== undefined,
  });
}

/** 移动子树改变父子关系与深度：站点列表 / 详情 / 下拉源与全部层级视图都要回源 */
export function useMoveCmsSite() {
  return useApiMutation(cmsSiteContract.move, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.all });
      invalidateHierarchy(qc);
    },
  });
}

/** 继承开关影响站点自身与其后代的生效配置，并会触发受影响站点的重建任务 */
export function useUpdateCmsSiteInheritance() {
  return useApiMutation(cmsSiteContract.updateInheritance, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.detail(params.id) });
      invalidateHierarchy(qc);
      void qc.invalidateQueries({ queryKey: cmsPublishingKeys.all });
    },
  });
}

// ─── 站点导入 / 导出（整站备份迁移；导出为 JSON 附件下载）────────────────────
/** 站点导出下载地址（供 request.download 直接下载） */
export function cmsSiteExportUrl(siteId: number): string {
  return urlOf(cmsSiteContract.export, { params: { id: siteId } });
}

/**
 * 全量导入：一次事务写入站点、栏目、内容、标签、资源、友链、重定向、内链词、
 * 广告、表单、单页等 19 张表，无法逐条定位，故按受影响的域根整体失效。
 * 仅失效站点域会让其余列表停留在导入前的旧数据。
 */
export function useImportCmsSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pkg: Record<string, unknown>) => api(cmsSiteContract.import, { body: pkg }),
    onSuccess: () => {
      for (const key of [
        cmsSiteKeys.all,
        cmsChannelKeys.all,
        cmsContentKeys.all,
        cmsTagKeys.all,
        cmsResourceKeys.all,
        cmsFriendLinkKeys.all,
        cmsRedirectKeys.lists,
        cmsLinkWordKeys.lists,
        cmsAdKeys.all,
        cmsFormKeys.all,
        cmsPageKeys.all,
      ]) {
        void qc.invalidateQueries({ queryKey: key });
      }
    },
  });
}
