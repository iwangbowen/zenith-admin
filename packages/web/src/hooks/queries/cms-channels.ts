import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { BodyOf } from '@zenith/shared/core';
import { cmsChannelContract } from '@zenith/shared/cms';
import { useSaveMutation, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { cmsContentKeys, invalidateAfterCmsContentChange } from './cms-contents';
import { invalidateCmsPublishingViews } from './cms-stage3';
import { invalidateCmsDashboardStats } from './cms-stats';

/** 栏目没有分页列表，树即列表 */
export const cmsChannelKeys = {
  /** 全部站点栏目树的公共前缀 */
  trees: contractKey(cmsChannelContract.tree),
  tree: (siteId: number | undefined) => contractKey(cmsChannelContract.tree, { query: { siteId: siteId ?? 0 } }),
  details: contractKey(cmsChannelContract.detail),
  detail: (id: number | undefined) => contractKey(cmsChannelContract.detail, { params: { id: id ?? 0 } }),
  users: (channelId: number | undefined) => contractKey(cmsChannelContract.users, { params: { id: channelId ?? 0 } }),
};

export type CmsChannelSaveValues = Partial<BodyOf<typeof cmsChannelContract.create>>;

/**
 * 栏目结构 / 属性变化（新增、编辑、删除、批量新增、合并）后的失效面：
 * - 栏目树与详情：树即列表，任何写操作都改变树结构或节点字段；页面同时可能挂着多个站点的树
 *   （分发规则的源 / 目标站点），故按操作前缀失效
 * - 内容列表：列表项带 `channelName`，改名 / 合并后必须回源；内容详情不含栏目名，不动
 * - 链接目标回显：`entity:channel/{id}` 解析为栏目名称
 * - 看板统计：channelDistribution 带栏目名与计数
 * - 发布中心：服务端为栏目变更排队发布任务
 * 不失效：站点 / 主题元数据、模型下拉源、标签下拉源——它们不引用栏目。
 */
export function invalidateAfterCmsChannelChange(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: cmsChannelKeys.trees });
  void qc.invalidateQueries({ queryKey: cmsChannelKeys.details });
  void qc.invalidateQueries({ queryKey: cmsContentKeys.lists });
  void qc.invalidateQueries({ queryKey: cmsContentKeys.linkTargets });
  invalidateCmsDashboardStats(qc);
  invalidateCmsPublishingViews(qc);
}

export function useCmsChannelTree(siteId: number | undefined) {
  return useApiQuery(cmsChannelContract.tree, { query: { siteId: siteId ?? 0 } }, {
    enabled: siteId !== undefined,
    placeholderData: keepPreviousData,
  });
}

export function useCmsChannelDetail(id: number | undefined, enabled = true) {
  return useApiQuery(cmsChannelContract.detail, { params: { id: id ?? 0 } }, {
    enabled: enabled && id !== undefined,
  });
}

export function useSaveCmsChannel() {
  return useSaveMutation(cmsChannelContract.create, cmsChannelContract.update, {
    invalidate: invalidateAfterCmsChannelChange,
  });
}

/** 删除后该栏目的详情 / 授权名单不再有对应资源，移除而非失效 */
export function useDeleteCmsChannel() {
  return useApiMutation(cmsChannelContract.remove, {
    invalidate: (qc, _output, { params }) => {
      qc.removeQueries({ queryKey: cmsChannelKeys.detail(params.id) });
      qc.removeQueries({ queryKey: cmsChannelKeys.users(params.id) });
      invalidateAfterCmsChannelChange(qc);
    },
  });
}

/** 栏目合并：来源栏目内容并入目标栏目后删除来源栏目——内容的栏目归属整体改变，按内容前缀失效 */
export function useMergeCmsChannels() {
  return useApiMutation(cmsChannelContract.merge, {
    invalidate: (qc) => {
      invalidateAfterCmsChannelChange(qc);
      invalidateAfterCmsContentChange(qc);
    },
  });
}

/** 清空栏目：栏目下内容全部移入回收站——树结构不变，只影响内容侧 */
export function useClearCmsChannel() {
  return useApiMutation(cmsChannelContract.clear, {
    invalidate: (qc) => invalidateAfterCmsContentChange(qc),
  });
}

export function useBatchCreateCmsChannels() {
  return useApiMutation(cmsChannelContract.batchCreate, {
    invalidate: invalidateAfterCmsChannelChange,
  });
}

// ─── 栏目授权用户（栏目级数据权限）─────────────────────────────────────────────
export function useCmsChannelUsers(channelId: number | undefined, enabled = true) {
  return useApiQuery(cmsChannelContract.users, { params: { id: channelId ?? 0 } }, {
    enabled: enabled && channelId !== undefined,
  });
}

/** 栏目树按当前用户的栏目授权过滤（服务端 getAccessibleChannelIds），改授权名单可能改变树的可见节点 */
export function useSetCmsChannelUsers() {
  return useApiMutation(cmsChannelContract.setUsers, {
    invalidate: (qc, _output, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsChannelKeys.users(params.id) });
      void qc.invalidateQueries({ queryKey: cmsChannelKeys.trees });
    },
  });
}