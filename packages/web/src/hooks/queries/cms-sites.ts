import type { QueryClient } from '@tanstack/react-query';
import { resourceKeyOf, type QueryOf } from '@zenith/shared/core';
import {
  cmsAdContract,
  cmsChannelContract,
  cmsContentContract,
  cmsFormContract,
  cmsFriendLinkContract,
  cmsInteractionContract,
  cmsModelContract,
  cmsPageContract,
  cmsResourceContract,
  cmsSiteContract,
  cmsTagContract,
  cmsWidgetContract,
  CMS_TEMPLATE_RESOLUTION_SOURCE_LABELS,
  type CmsThemeTemplateManifest,
} from '@zenith/shared/cms';
import { contractKey, createResourceQueries, urlOf, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { LOOKUP_STALE_TIME } from '@/lib/query';
import { cmsLinkWordKeys, cmsRedirectKeys } from './cms-seo';
import { invalidateCmsPublishingViews } from './cms-stage3';

export type CmsSiteListParams = QueryOf<typeof cmsSiteContract.list>;

export type CmsSiteTreeParams = NonNullable<QueryOf<typeof cmsSiteContract.tree>>;

const resource = createResourceQueries(cmsSiteContract);

/**
 * 站点域 query keys。主题元数据（themes / themeTemplates / themeSettingsSchema，均为 LOOKUP_STALE_TIME）
 * 与站点增删改无因果关系，站点级动作只失效 lists / detail / lookup，不广播 `all`。
 */
export const cmsSiteKeys = {
  ...resource.keys,
  /** 全部站点详情的公共前缀（子树移动改变多个站点的层级字段） */
  details: contractKey(cmsSiteContract.detail),
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

/** 模板清单的下拉标签带上解析来源（主题内置 / 站点覆盖 / 父站继承）——纯展示派生，用 select 完成 */
function annotateTemplateSources(catalog: CmsThemeTemplateManifest): CmsThemeTemplateManifest {
  const annotate = (items: CmsThemeTemplateManifest['list']) => items.map((item) => ({
    ...item,
    label: item.source
      ? `${item.label} · ${CMS_TEMPLATE_RESOLUTION_SOURCE_LABELS[item.source]}`
      : item.label,
  }));
  return { list: annotate(catalog.list), detail: annotate(catalog.detail) };
}

/** 主题可选模板清单（站点默认模板 / 栏目 / 内容模板下拉） */
export function useCmsThemeTemplates(themeCode: string | undefined, siteId?: number) {
  return useApiQuery(cmsSiteContract.themeTemplates, { params: { code: themeCode ?? '' }, query: { siteId } }, {
    enabled: !!themeCode,
    staleTime: LOOKUP_STALE_TIME,
    select: annotateTemplateSources,
  });
}

/** 主题参数声明（后台主题参数面板动态表单） */
export function useCmsThemeSettingsSchema(themeCode: string | undefined) {
  return useApiQuery(cmsSiteContract.themeSettingsSchema, { params: { code: themeCode ?? '' } }, {
    enabled: !!themeCode,
    staleTime: LOOKUP_STALE_TIME,
  });
}

/** 站点模板健康检查（失效模板引用扫描；theme 传目标主题可做切换前预检） */
export function useCmsSiteTemplateHealth(siteId: number | undefined, theme: string | undefined, enabled = true) {
  return useApiQuery(cmsSiteContract.templateHealth, { params: { id: siteId ?? 0 }, query: { theme } }, {
    enabled: enabled && siteId !== undefined,
  });
}

// ─── 站点授权用户 ─────────────────────────────────────────────────────────────
export function useCmsSiteUsers(siteId: number | undefined, enabled = true) {
  return useApiQuery(cmsSiteContract.users, { params: { id: siteId ?? 0 } }, {
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
  return useApiQuery(cmsSiteContract.openGrants, { params: { id: siteId ?? 0 } }, {
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
function invalidateHierarchy(qc: QueryClient) {
  for (const key of cmsSiteKeys.hierarchy) void qc.invalidateQueries({ queryKey: key });
}

export function useCmsSiteTree(params: CmsSiteTreeParams, enabled = true) {
  return useApiQuery(cmsSiteContract.tree, { query: params }, { enabled });
}

export function useCmsSiteInheritanceChain(siteId: number | undefined, enabled = true) {
  return useApiQuery(cmsSiteContract.inheritanceChain, { params: { id: siteId ?? 0 } }, {
    enabled: enabled && siteId !== undefined,
  });
}

export function useCmsSiteEffectiveConfig(siteId: number | undefined, enabled = true) {
  return useApiQuery(cmsSiteContract.effectiveConfig, { params: { id: siteId ?? 0 } }, {
    enabled: enabled && siteId !== undefined,
  });
}

/**
 * 移动子树改变父子关系与深度：站点列表（parentId / depth 列）、被移动子树内每个站点的详情、
 * 站点下拉源（层级排序）与全部层级视图都要回源；服务端还会为受影响站点排队重建任务。
 * 主题元数据与授权名单不含层级信息，不动。
 */
export function useMoveCmsSite() {
  return useApiMutation(cmsSiteContract.move, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.lists });
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.details });
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.allSites });
      invalidateHierarchy(qc);
      invalidateCmsPublishingViews(qc);
    },
  });
}

/** 继承开关影响站点自身与其后代的生效配置，并会触发受影响站点的重建任务 */
export function useUpdateCmsSiteInheritance() {
  return useApiMutation(cmsSiteContract.updateInheritance, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsSiteKeys.detail(params.id) });
      invalidateHierarchy(qc);
      invalidateCmsPublishingViews(qc);
    },
  });
}

// ─── 站点导入 / 导出（整站备份迁移；导出为 JSON 附件下载）────────────────────
/** 站点导出下载地址（供 request.download 直接下载） */
export function cmsSiteExportUrl(siteId: number): string {
  return urlOf(cmsSiteContract.export, { params: { id: siteId } });
}

/** 导入包一次事务写入的契约域（对应 CmsSiteImportResult.counts） */
const IMPORT_AFFECTED_CONTRACTS = [
  cmsSiteContract,
  cmsChannelContract,
  cmsContentContract,
  cmsTagContract,
  cmsResourceContract,
  cmsFriendLinkContract,
  cmsAdContract,
  cmsFormContract,
  cmsInteractionContract,
  cmsModelContract,
  cmsWidgetContract,
  cmsPageContract,
] as const;

/**
 * 全量导入：一次事务写入站点、栏目、内容、标签、资源、友链（含分组）、重定向、内链词、广告（含广告位）、
 * 表单、互动问卷、内容模型、页面部件、单页等 19 张表，无法逐条定位，故按受影响契约的资源根整体失效
 * （query-cache.md：批量覆盖 / 全量导入是允许域根失效的两种情形之一）。
 * 站点契约根会连带主题元数据一起打掉：导入包可能带站点级模板覆盖，模板清单确实会变。
 * SEO 域只失效重定向与内链词两张列表，推送日志不受导入影响。
 */
export function invalidateAfterCmsSiteImport(qc: QueryClient) {
  for (const contract of IMPORT_AFFECTED_CONTRACTS) {
    void qc.invalidateQueries({ queryKey: [resourceKeyOf(contract.basePath)] });
  }
  void qc.invalidateQueries({ queryKey: cmsRedirectKeys.lists });
  void qc.invalidateQueries({ queryKey: cmsLinkWordKeys.lists });
  invalidateCmsPublishingViews(qc);
}

/** 导入站点：`mutate({ body: 导出包 JSON })` */
export function useImportCmsSite() {
  return useApiMutation(cmsSiteContract.import, { invalidate: invalidateAfterCmsSiteImport });
}