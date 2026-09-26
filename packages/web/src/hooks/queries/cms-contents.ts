// eslint-disable-next-line no-restricted-imports -- H5 保留：手写 useQuery / useMutation 的理由见本文件对应 hook 的注释；queryKey 仍由 contractKey 生成
import { keepPreviousData, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { BodyOf, QueryOf } from '@zenith/shared/core';
import { cmsContentContract, cmsEditorialContract, cmsReleaseContract, isCmsEntityLink, type CmsEditLock } from '@zenith/shared/cms';
import { api, contractKey, createResourceQueries, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateCmsPublishingViews } from './cms-stage3';
import { invalidateCmsDashboardStats } from './cms-stats';
import { invalidateEntityRelations } from '@/lib/entity-relation-cache';
import { invalidateCmsOperationsContentViews } from './cms-operations';

export type CmsContentListParams = NonNullable<QueryOf<typeof cmsContentContract.list>>;

const resource = createResourceQueries(cmsContentContract, {
  // 保存会留档一个新版本并追加操作日志；新建草稿改变看板 totals.draft。列表 / 详情由工厂失效
  onSaved: (qc, saved) => {
    invalidateCmsOperationsContentViews(qc);
    void invalidateEntityRelations(qc);
    void qc.invalidateQueries({ queryKey: cmsContentKeys.versionList(saved.id) });
    void qc.invalidateQueries({ queryKey: cmsContentKeys.opLogs(saved.id) });
    void qc.invalidateQueries({ queryKey: cmsContentKeys.workflowContext(saved.id) });
    void qc.invalidateQueries({ queryKey: cmsContentKeys.approvalDetail(saved.id) });
    invalidateCmsDashboardStats(qc);
    void qc.invalidateQueries({ queryKey: contractKey(cmsEditorialContract.metrics) });
    void qc.invalidateQueries({ queryKey: contractKey(cmsEditorialContract.quality, { params: { id: saved.id } }) });
  },
});

export const cmsContentKeys = {
  ...resource.keys,
  /** 全部内容详情的公共前缀（批量操作不知道哪些详情正被查看时使用） */
  details: contractKey(cmsContentContract.detail),
  opLogsAll: contractKey(cmsContentContract.opLogs),
  opLogs: (contentId: number | undefined) => contractKey(cmsContentContract.opLogs, { params: { id: contentId ?? 0 } }),
  versions: contractKey(cmsContentContract.versions),
  versionList: (contentId: number | undefined) => contractKey(cmsContentContract.versions, { params: { id: contentId ?? 0 }, query: {} }),
  versionPage: (contentId: number, page = 1) => contractKey(cmsContentContract.versions, { params: { id: contentId }, query: { page, pageSize: 30 } }),
  versionDiffs: contractKey(cmsContentContract.versionDiff),
  linkTargets: contractKey(cmsContentContract.linkTarget),
  /** 内容日历（按月聚合）的公共前缀 */
  calendar: contractKey(cmsContentContract.calendar),
  workflowContexts: contractKey(cmsContentContract.workflowContext),
  workflowContext: (contentId: number) => contractKey(cmsContentContract.workflowContext, { params: { id: contentId }, query: {} }),
  approvalDetails: contractKey(cmsContentContract.approvalDetail),
  approvalDetail: (contentId: number) => [...contractKey(cmsContentContract.approvalDetail), { params: { id: contentId } }],
  linkTarget: (siteId: number | undefined, link: string) =>
    contractKey(cmsContentContract.linkTarget, { query: { siteId: siteId ?? 0, link } }),
};

/** 内容状态由审批订阅者异步回写；仅当前页仍有待审核内容时轮询。 */
export function useCmsContentList(query: CmsContentListParams, enabled = true) {
  return useApiQuery(cmsContentContract.list, { query }, {
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: (state) => state.state.data?.list.some((content) => ['pending', 'approved'].includes(content.editorialStatus)) ? 10_000 : false,
  });
}
export const useCmsContentDetail = resource.useDetail;

/** 内容日历按天聚合（站点 + 月份）；发布 / 状态流转后由 invalidateAfterCmsContentChange 失效。 */
export function useCmsContentCalendar(siteId: number | undefined, month: string, enabled = true) {
  return useApiQuery(cmsContentContract.calendar, { query: { siteId: siteId ?? 0, month } }, {
    enabled: enabled && !!siteId,
    placeholderData: keepPreviousData,
  });
}
export const useSaveCmsContent = resource.useSave;

/** 审批中的业务记录持续回源，直到工作流订阅者完成 CMS 状态回写。与普通详情共用契约缓存。 */
export function useCmsContentWorkflowRecord(contentId: number | undefined, enabled = true) {
  return useApiQuery(cmsContentContract.detail, { params: { id: contentId ?? 0 } }, {
    enabled: enabled && contentId !== undefined,
    refetchInterval: (query) => query.state.data && ['pending', 'approved'].includes(query.state.data.editorialStatus) ? 10_000 : false,
  });
}

/** 通过 CMS 业务权限解析实际站点审核配置，预览参数参与缓存身份。 */
export function useCmsContentWorkflowPreview(body: BodyOf<typeof cmsContentContract.workflowPreview>, enabled = true) {
  return useApiQuery(cmsContentContract.workflowPreview, { body }, {
    enabled: enabled && body.siteId > 0 && body.channelId > 0,
  });
}

export function useCmsContentWorkflowContext(contentId: number | undefined, instanceId?: number, enabled = true) {
  return useApiQuery(cmsContentContract.workflowContext, { params: { id: contentId ?? 0 }, query: { instanceId } }, {
    enabled: enabled && contentId !== undefined,
    refetchInterval: (query) => {
      const status = query.state.data?.instance?.status;
      return status === 'running' || status === 'suspended' ? 10_000 : false;
    },
  });
}

/** 工作流查看组件走参与者授权，业务列表/编辑器仍用业务详情接口。 */
export function useCmsContentApprovalDetail(contentId: number | undefined, instanceId: number | null | undefined) {
  return useApiQuery(cmsContentContract.approvalDetail, {
    params: { id: contentId ?? 0 }, query: { instanceId: instanceId ?? 0 },
  }, { enabled: contentId !== undefined && !!instanceId });
}

/**
 * 内容状态 / 归属 / 存在性变化（提审、发布、下线、驳回、回收、恢复、彻删、归档、批量移动 / 属性 / 打标、
 * 站群分发、合规锁、版本回滚）后的失效面：
 * - `lists`：内容列表各 Tab、链接选择器与部件数据源选择器都读列表，状态 / 栏目 / 标签 / 锁定标记是列表列
 * - `detail(id)` / `opLogs(id)`：编辑页读详情（状态、栏目、锁），每次流转都会追加一条操作日志；
 *   给出 ids 时逐条精确失效，批量接口拿不到 ids（或跨站分发）时按操作前缀失效
 * - 看板统计：totals / todayPublished / publishTrend / channelDistribution 随状态与栏目归属变化
 * - 发布中心：服务端会为这些变更排队增量发布任务，任务列表 / 产物随之变化
 * 不失效：`versions`（只有保存 / 回滚才产生新版本，由对应 hook 单独处理）、`linkTarget`（标题未变）、
 * 栏目树（树不含内容计数）、站点 / 主题元数据与标签下拉源。
 */
export function invalidateAfterCmsContentChange(qc: QueryClient, ids?: readonly number[]) {
  invalidateCmsOperationsContentViews(qc);
  void invalidateEntityRelations(qc);
  void qc.invalidateQueries({ queryKey: contractKey(cmsEditorialContract.metrics) });
  void qc.invalidateQueries({ queryKey: contractKey(cmsEditorialContract.quality) });
  void qc.invalidateQueries({ queryKey: contractKey(cmsEditorialContract.translations) });
  void qc.invalidateQueries({ queryKey: contractKey(cmsReleaseContract.list) });
  void qc.invalidateQueries({ queryKey: cmsContentKeys.lists });
  // 发布 / 下线 / 改计划发布时间都会改变日历格子：内容列表的失效点一并覆盖日历
  void qc.invalidateQueries({ queryKey: cmsContentKeys.calendar });
  if (ids) {
    for (const id of ids) {
      void qc.invalidateQueries({ queryKey: cmsContentKeys.detail(id) });
      void qc.invalidateQueries({ queryKey: cmsContentKeys.opLogs(id) });
      void qc.invalidateQueries({ queryKey: cmsContentKeys.workflowContext(id) });
      void qc.invalidateQueries({ queryKey: cmsContentKeys.approvalDetail(id) });
    }
  } else {
    void qc.invalidateQueries({ queryKey: cmsContentKeys.details });
    void qc.invalidateQueries({ queryKey: cmsContentKeys.opLogsAll });
    void qc.invalidateQueries({ queryKey: cmsContentKeys.workflowContexts });
    void qc.invalidateQueries({ queryKey: cmsContentKeys.approvalDetails });
  }
  invalidateCmsDashboardStats(qc);
  invalidateCmsPublishingViews(qc);
}

/** 内部链接目标描述（编辑页把 entity:content/123 回显成可读标题） */
export function useCmsLinkTarget(siteId: number | undefined, link: string | null | undefined) {
  const value = link?.trim() ?? '';
  return useApiQuery(cmsContentContract.linkTarget, { query: { siteId: siteId ?? 0, link: value } }, {
    // 仅实体链接需要回源解析；外链/站内路径前端自己就能显示
    enabled: siteId !== undefined && isCmsEntityLink(value),
    staleTime: 30_000,
  });
}

export type CmsContentAction = 'submit' | 'publish' | 'offline' | 'reject' | 'preparePublication';

/**
 * 状态流转：submit / publish / offline / reject（驳回必须携带原因）。
 * H5：mutationFn 按 action 在多个契约操作间分派，不是单一契约操作，故保留手写 useMutation。
 */
export function useCmsContentAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, expectedVersion, reason }: { id: number; action: CmsContentAction; expectedVersion: number; reason?: string }) =>
      action === 'reject'
        ? api(cmsContentContract.reject, { params: { id }, body: { reason: reason ?? '', expectedVersion } })
        : api(cmsContentContract[action], { params: { id }, body: { expectedVersion } }),
    onSuccess: (_output, { id, action }) => {
      invalidateAfterCmsContentChange(qc, [id]);
      if (action === 'submit' || action === 'publish' || action === 'preparePublication') {
        void qc.invalidateQueries({ queryKey: cmsContentKeys.versionList(id) });
        void qc.invalidateQueries({ queryKey: cmsContentKeys.versionDiffs });
      }
    },
  });
}

/**
 * 持久化管理员合规锁（非 Redis 编辑软锁）：lock 携带原因，unlock 无入参。
 * H5：mutationFn 按 action 在 lock / unlock 两个契约操作间分派，故保留手写 useMutation。
 */
export function useCmsContentPersistentLock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action, expectedVersion, reason }: { id: number; action: 'lock' | 'unlock'; expectedVersion: number; reason?: string }) =>
      action === 'lock'
        ? api(cmsContentContract.lock, { params: { id }, body: { reason: reason ?? '', expectedVersion } })
        : api(cmsContentContract.unlock, { params: { id }, body: { expectedVersion } }),
    onSuccess: (_output, { id }) => invalidateAfterCmsContentChange(qc, [id]),
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

/**
 * 回收站 / 归档批量操作：recycle / restore / purge / archive / unarchive。
 * H5：mutationFn 按 action 在多个契约操作间分派，故保留手写 useMutation。
 */
export function useCmsContentBatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids, expectedVersions }: { action: CmsContentBatchAction; ids: number[]; expectedVersions: Record<string, number> }) =>
      api(BATCH_OPERATIONS[action], { body: { ids, expectedVersions } }),
    onSuccess: (_output, { action, ids }) => {
      // 彻底删除后详情 / 日志 / 版本都不再有对应资源，移除而非失效（失效会去请求一个必然 404 的资源）
      if (action === 'purge') {
        for (const id of ids) {
          qc.removeQueries({ queryKey: cmsContentKeys.detail(id) });
          qc.removeQueries({ queryKey: cmsContentKeys.opLogs(id) });
          qc.removeQueries({ queryKey: cmsContentKeys.versionList(id) });
          qc.removeQueries({ queryKey: cmsContentKeys.workflowContext(id) });
          qc.removeQueries({ queryKey: cmsContentKeys.approvalDetail(id) });
        }
      }
      invalidateAfterCmsContentChange(qc, ids);
    },
  });
}

/** 内容操作日志时间线（打开抽屉时启用） */
export function useCmsContentOpLogs(contentId: number | undefined, enabled = true) {
  return useApiQuery(cmsContentContract.opLogs, { params: { id: contentId ?? 0 } }, {
    enabled: enabled && contentId !== undefined,
  });
}

/** 内容词库检查（敏感词 + 易错词命中） */
export function useCmsCheckText() {
  return useApiMutation(cmsContentContract.checkText);
}

// ─── 内容版本 ─────────────────────────────────────────────────────────────────
export function useCmsContentVersions(contentId: number | undefined, enabled = true, page = 1) {
  return useApiQuery(cmsContentContract.versions, { params: { id: contentId ?? 0 }, query: { page, pageSize: 30 } }, {
    enabled: enabled && contentId !== undefined,
  });
}

export function useCmsContentVersion(contentId: number | undefined, versionId: number | undefined) {
  return useApiQuery(cmsContentContract.version, { params: { id: contentId ?? 0, versionId: versionId ?? 0 } }, { enabled: contentId !== undefined && versionId !== undefined });
}

/** 回滚会改写正文 / 标题并自动留档当前状态：详情、版本列表与差异都变，列表标题列随之变化 */
export function useRestoreCmsContentVersion() {
  return useApiMutation(cmsContentContract.restoreVersion, {
    invalidate: (qc, _output, { params }) => {
      invalidateAfterCmsContentChange(qc, [params.id]);
      void qc.invalidateQueries({ queryKey: cmsContentKeys.versionList(params.id) });
      void qc.invalidateQueries({ queryKey: cmsContentKeys.versionDiffs });
    },
  });
}

/** 版本差异对比（历史版本 vs 当前内容） */
export function useCmsVersionDiff(contentId: number | undefined, versionId: number | undefined) {
  return useApiQuery(cmsContentContract.versionDiff, { params: { id: contentId ?? 0, versionId: versionId ?? 0 } }, {
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
  return useApiMutation(cmsContentContract.previewLink, {
    invalidate: (qc, _link, { params }) => {
      void qc.invalidateQueries({ queryKey: cmsContentKeys.versionList(params.id) });
    },
  });
}

export function useRevokeCmsPreviewLink() {
  return useApiMutation(cmsContentContract.revokePreview);
}

// ─── 批量操作 / 复制 / 站群分发 ───────────────────────────────────────────────
export type CmsContentBatchOpInput =
  | { action: 'batch-move'; body: BodyOf<typeof cmsContentContract.batchMove> }
  | { action: 'batch-flags'; body: BodyOf<typeof cmsContentContract.batchFlags> }
  | { action: 'batch-tag'; body: BodyOf<typeof cmsContentContract.batchTag> }
  | { action: 'distribute'; body: BodyOf<typeof cmsContentContract.distribute> };

/**
 * 批量移动 / 设置属性 / 追加标签 / 站群分发：body 即对应契约操作的请求体。
 * H5：mutationFn 按 action 在多个契约操作间分派，故保留手写 useMutation。
 */
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
    // 分发会在目标站点新建内容，源内容不变，但新内容的 id 未知：按前缀失效
    onSuccess: (_output, input) => invalidateAfterCmsContentChange(qc, input.action === 'distribute' ? undefined : input.body.ids),
  });
}

/** 批量状态流转（提审/发布/驳回/下线）：返回部分成功明细 */
export function useCmsContentBatchStatus() {
  return useApiMutation(cmsContentContract.batchStatus, {
    invalidate: (qc, _output, { body }) => {
      invalidateAfterCmsContentChange(qc, body.ids);
      if (body.action === 'submit' || body.action === 'publish') void qc.invalidateQueries({ queryKey: cmsContentKeys.versions });
    },
  });
}

/** 复制只新增一份草稿：源内容的详情 / 日志不变，列表与看板草稿数变化 */
export function useDuplicateCmsContent() {
  return useApiMutation(cmsContentContract.duplicate, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: cmsContentKeys.lists });
      invalidateCmsDashboardStats(qc);
    },
  });
}

/** 内容标题查重探测（编辑辅助，失败静默）——一次性动作，故建模为 mutation */
export function useCheckCmsContentTitle() {
  return useApiMutation(cmsContentContract.checkTitle, { requestOptions: { silent: true } });
}

/** 「预览详情模板」取样：栏目下第一条已发布内容，与 `useCmsChannelSampleContent` 的 query 合并使用 */
export const CMS_CHANNEL_SAMPLE_CONTENT_QUERY = { status: 'published', page: 1, pageSize: 1 } as const;

/**
 * 取栏目下第一条已发布内容——仅用于「预览详情模板」按钮，结果不入缓存，
 * 故建模为 mutation 而非 query：`mutate({ query: { siteId, channelId, ...CMS_CHANNEL_SAMPLE_CONTENT_QUERY } })`。
 */
export function useCmsChannelSampleContent() {
  return useApiMutation(cmsContentContract.list);
}
