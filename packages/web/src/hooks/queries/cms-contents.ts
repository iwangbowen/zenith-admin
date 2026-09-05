import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { cmsContentContract, isCmsEntityLink, type CmsEditLock } from '@zenith/shared/cms';
import { api, apiQueryOptions, contractKey, createResourceQueries, useApiMutation } from '@/lib/contract-query';

export type CmsContentListParams = NonNullable<QueryOf<typeof cmsContentContract.list>>;

const resource = createResourceQueries(cmsContentContract);

export const cmsContentKeys = {
  ...resource.keys,
  opLogs: (contentId: number | undefined) => contractKey(cmsContentContract.opLogs, { params: { id: contentId ?? 0 } }),
  versions: contractKey(cmsContentContract.versions),
  versionList: (contentId: number | undefined) => contractKey(cmsContentContract.versions, { params: { id: contentId ?? 0 } }),
  versionDiffs: contractKey(cmsContentContract.versionDiff),
  linkTarget: (siteId: number | undefined, link: string) =>
    contractKey(cmsContentContract.linkTarget, { query: { siteId: siteId ?? 0, link } }),
};

export const useCmsContentList = resource.useList;
export const useCmsContentDetail = resource.useDetail;
export const useSaveCmsContent = resource.useSave;

/** 内容写操作波及列表 / 详情 / 操作日志 / 版本，统一按域根失效 */
function invalidateContents(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: cmsContentKeys.all });
}

/** 内部链接目标描述（编辑页把 entity:content/123 回显成可读标题） */
export function useCmsLinkTarget(siteId: number | undefined, link: string | null | undefined) {
  const value = link?.trim() ?? '';
  return useQuery({
    ...apiQueryOptions(cmsContentContract.linkTarget, { query: { siteId: siteId ?? 0, link: value } }),
    // 仅实体链接需要回源解析；外链/站内路径前端自己就能显示
    enabled: siteId !== undefined && isCmsEntityLink(value),
    staleTime: 30_000,
  });
}

export type CmsContentAction = 'submit' | 'publish' | 'offline' | 'reject';

/** 状态流转：submit / publish / offline / reject（驳回必须携带原因） */
export function useCmsContentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: number; action: CmsContentAction; reason?: string }) =>
      action === 'reject'
        ? api(cmsContentContract.reject, { params: { id }, body: { reason: reason ?? '' } })
        : api(cmsContentContract[action], { params: { id } }),
    onSuccess: () => invalidateContents(qc),
  });
}

/** 持久化管理员合规锁（非 Redis 编辑软锁）：lock 携带原因，unlock 无入参 */
export function useCmsContentPersistentLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, reason }: { id: number; action: 'lock' | 'unlock'; reason?: string }) =>
      action === 'lock'
        ? api(cmsContentContract.lock, { params: { id }, body: { reason: reason ?? '' } })
        : api(cmsContentContract.unlock, { params: { id } }),
    onSuccess: () => invalidateContents(qc),
  });
}

export type CmsContentBatchAction = 'recycle' | 'restore' | 'purge' | 'archive' | 'unarchive';

const BATCH_OPERATIONS = {
  recycle: cmsContentContract.recycle,
  restore: cmsContentContract.restore,
  purge: cmsContentContract.purge,
  archive: cmsContentContract.archive,
  unarchive: cmsContentContract.unarchive,
} as const;

/** 回收站 / 归档批量操作：recycle / restore / purge / archive / unarchive */
export function useCmsContentBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids }: { action: CmsContentBatchAction; ids: number[] }) =>
      api(BATCH_OPERATIONS[action], { body: { ids } }),
    onSuccess: () => invalidateContents(qc),
  });
}

/** 内容操作日志时间线（打开抽屉时启用） */
export function useCmsContentOpLogs(contentId: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsContentContract.opLogs, { params: { id: contentId ?? 0 } }),
    enabled: enabled && contentId !== undefined,
  });
}

/** 内容词库检查（敏感词 + 易错词命中） */
export function useCmsCheckText() {
  return useApiMutation(cmsContentContract.checkText);
}

// ─── 内容版本 ─────────────────────────────────────────────────────────────────
export function useCmsContentVersions(contentId: number | undefined, enabled = true) {
  return useQuery({
    ...apiQueryOptions(cmsContentContract.versions, { params: { id: contentId ?? 0 } }),
    enabled: enabled && contentId !== undefined,
  });
}

export function useRestoreCmsContentVersion() {
  return useApiMutation(cmsContentContract.restoreVersion, { invalidate: invalidateContents });
}

/** 版本差异对比（历史版本 vs 当前内容） */
export function useCmsVersionDiff(contentId: number | undefined, versionId: number | undefined) {
  return useQuery({
    ...apiQueryOptions(cmsContentContract.versionDiff, { params: { id: contentId ?? 0, versionId: versionId ?? 0 } }),
    enabled: contentId !== undefined && versionId !== undefined,
  });
}

// ─── 编辑锁 / 草稿预览 ─────────────────────────────────────────────────────────
/** 抢占/心跳续期编辑锁（打开编辑页调用，之后每 30s 心跳一次） */
export function acquireCmsEditLock(contentId: number): Promise<CmsEditLock> {
  return api(cmsContentContract.acquireEditLock, { params: { id: contentId } }, { silent: true });
}

/** 释放编辑锁（离开编辑页调用，仅持有人生效） */
export function releaseCmsEditLock(contentId: number): Promise<null> {
  return api(cmsContentContract.releaseEditLock, { params: { id: contentId } }, { silent: true });
}

/** 生成草稿预览链接 */
export function useCmsPreviewLink() {
  return useApiMutation(cmsContentContract.previewLink);
}

// ─── 批量操作 / 复制 / 站群分发 ───────────────────────────────────────────────
export type CmsContentBatchOpInput =
  | { action: 'batch-move'; body: BodyOf<typeof cmsContentContract.batchMove> }
  | { action: 'batch-flags'; body: BodyOf<typeof cmsContentContract.batchFlags> }
  | { action: 'batch-tag'; body: BodyOf<typeof cmsContentContract.batchTag> }
  | { action: 'distribute'; body: BodyOf<typeof cmsContentContract.distribute> };

/** 批量移动 / 设置属性 / 追加标签 / 站群分发：body 即对应契约操作的请求体 */
export function useCmsContentBatchOps() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CmsContentBatchOpInput) => {
      switch (input.action) {
        case 'batch-move': return api(cmsContentContract.batchMove, { body: input.body });
        case 'batch-flags': return api(cmsContentContract.batchFlags, { body: input.body });
        case 'batch-tag': return api(cmsContentContract.batchTag, { body: input.body });
        case 'distribute': return api(cmsContentContract.distribute, { body: input.body });
      }
    },
    onSuccess: () => invalidateContents(qc),
  });
}

/** 批量状态流转（提审/发布/驳回/下线）：返回部分成功明细 */
export function useCmsContentBatchStatus() {
  return useApiMutation(cmsContentContract.batchStatus, { invalidate: invalidateContents });
}

export function useDuplicateCmsContent() {
  return useApiMutation(cmsContentContract.duplicate, { invalidate: invalidateContents });
}

/** 内容标题查重探测（编辑辅助，失败静默）——一次性动作，故建模为 mutation */
export function useCheckCmsContentTitle() {
  return useApiMutation(cmsContentContract.checkTitle, { requestOptions: { silent: true } });
}

/**
 * 取栏目下第一条已发布内容——仅用于「预览详情模板」按钮，结果不入缓存，
 * 故建模为 mutation 而非 query。
 */
export function useCmsChannelSampleContent() {
  return useMutation({
    mutationFn: ({ siteId, channelId }: { siteId: number; channelId: number }) =>
      api(cmsContentContract.list, { query: { siteId, channelId, status: 'published', page: 1, pageSize: 1 } }),
  });
}
