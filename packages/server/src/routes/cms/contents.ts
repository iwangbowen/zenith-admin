import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsContentContract } from '@zenith/shared/cms';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsContents,
  getCmsContent,
  createCmsContent,
  updateCmsContent,
  submitCmsContent,
  publishCmsContent,
  rejectCmsContent,
  offlineCmsContent,
  recycleCmsContents,
  restoreCmsContents,
  purgeCmsContents,
  restoreCmsContentToVersion,
  batchMoveCmsContents,
  batchSetCmsContentFlags,
  batchAddCmsContentTags,
  batchTransitionCmsContents,
  duplicateCmsContent,
  distributeCmsContents,
  archiveCmsContents,
  unarchiveCmsContents,
  checkCmsContentTitle,
} from '../../services/cms/cms-contents.service';
import { listContentVersions, diffContentVersion, getContentVersion } from '../../services/cms/cms-versions.service';
import { listContentOpLogs } from '../../services/cms/cms-content-op-logs.service';
import { checkCmsText } from '../../services/cms/cms-word-check.service';
import { acquireContentEditLock, releaseContentEditLock } from '../../services/cms/cms-edit-lock.service';
import { createContentPreviewLink, revokeCmsContentPreview } from '../../services/cms/cms-preview.service';
import { lockCmsContent, unlockCmsContent } from '../../services/cms/cms-content-lock.service';
import { describeCmsLink } from '../../services/cms/cms-link.service';
import { ensureCmsSiteExists, assertSiteAccess } from '../../services/cms/cms-sites.service';
import { mountCrud } from '../_crud';
import { previewCmsContentWorkflow, getCmsContentWorkflowContext } from '../../services/cms/cms-workflow.service';
import { getCmsContentForApproval } from '../../services/cms/cms-contents-query.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const workflowPreviewRoute = defineContractRoute(cmsContentContract.workflowPreview, {
  handler: async (c) => c.json(okBody(await previewCmsContentWorkflow(c.req.valid('json'))), 200),
});
const workflowContextRoute = defineContractRoute(cmsContentContract.workflowContext, {
  handler: async (c) => c.json(okBody(await getCmsContentWorkflowContext(c.req.valid('param').id, c.req.valid('query').instanceId)), 200),
});
const approvalDetailRoute = defineContractRoute(cmsContentContract.approvalDetail, {
  handler: async (c) => c.json(okBody(await getCmsContentForApproval(c.req.valid('param').id, c.req.valid('query').instanceId)), 200),
});
const checkTitleRoute = defineContractRoute(cmsContentContract.checkTitle, {
  handler: async (c) => {
    const { siteId, title, excludeId } = c.req.valid('query');
    return c.json(okBody(await checkCmsContentTitle(siteId, title, excludeId)), 200);
  },
});

const describeLinkRoute = defineContractRoute(cmsContentContract.linkTarget, {
  handler: async (c) => {
    const { siteId, link } = c.req.valid('query');
    await ensureCmsSiteExists(siteId);
    await assertSiteAccess(siteId);
    return c.json(okBody(await describeCmsLink(siteId, link)), 200);
  },
});

const updateRouteDef = defineContractRoute(cmsContentContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getCmsContent(id);
    setAuditBeforeData(c, { ...before, body: undefined });
    const row = await updateCmsContent(id, c.req.valid('json'));
    return c.json(okBody(row, '更新成功'), 200);
  },
});

// ─── 状态流转 ─────────────────────────────────────────────────────────────────
const submitRoute = defineContractRoute(cmsContentContract.submit, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, { ...await getCmsContent(id), body: undefined });
    return c.json(okBody(await submitCmsContent(id, { expectedVersion: c.req.valid('json').expectedVersion }), '已提交审核'), 200);
  },
});

const publishRoute = defineContractRoute(cmsContentContract.publish, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, { ...await getCmsContent(id), body: undefined });
    const row = await publishCmsContent(id, { expectedVersion: c.req.valid('json').expectedVersion });
    return c.json(okBody(row, '发布成功'), 200);
  },
});

const rejectRoute = defineContractRoute(cmsContentContract.reject, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    setAuditBeforeData(c, { ...await getCmsContent(id), body: undefined });
    return c.json(okBody(await rejectCmsContent(id, reason, { expectedVersion: c.req.valid('json').expectedVersion }), '已驳回'), 200);
  },
});

const offlineRoute = defineContractRoute(cmsContentContract.offline, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, { ...await getCmsContent(id), body: undefined });
    const row = await offlineCmsContent(id, { expectedVersion: c.req.valid('json').expectedVersion });
    return c.json(okBody(row, '已下线'), 200);
  },
});

// ─── 回收站 ───────────────────────────────────────────────────────────────────
const recycleRoute = defineContractRoute(cmsContentContract.recycle, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await recycleCmsContents(ids, c.req.valid('json').expectedVersions);
    return c.json(okBody(null, `已移入回收站 ${count} 条`), 200);
  },
});

const restoreRoute = defineContractRoute(cmsContentContract.restore, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await restoreCmsContents(ids, c.req.valid('json').expectedVersions);
    return c.json(okBody(null, `已恢复 ${count} 条`), 200);
  },
});

const purgeRoute = defineContractRoute(cmsContentContract.purge, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await purgeCmsContents(ids, { expectedVersions: c.req.valid('json').expectedVersions });
    return c.json(okBody(null, `已彻底删除 ${count} 条`), 200);
  },
});

// ─── 版本历史 ─────────────────────────────────────────────────────────────────
const versionsRoute = defineContractRoute(cmsContentContract.versions, {
  handler: async (c) => c.json(okBody(await listContentVersions(c.req.valid('param').id, c.req.valid('query'))), 200),
});

const restoreVersionRoute = defineContractRoute(cmsContentContract.restoreVersion, {
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    const before = await getCmsContent(id);
    setAuditBeforeData(c, { ...before, body: undefined });
    const row = await restoreCmsContentToVersion(id, versionId, c.req.valid('json').expectedVersion);
    return c.json(okBody(row, '回滚成功'), 200);
  },
});

const versionDiffRoute = defineContractRoute(cmsContentContract.versionDiff, {
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    return c.json(okBody(await diffContentVersion(id, versionId)), 200);
  },
});

// ─── 编辑锁 / 草稿预览 ─────────────────────────────────────────────────────────
const editLockAcquireRoute = defineContractRoute(cmsContentContract.acquireEditLock, {
  handler: async (c) => c.json(okBody(await acquireContentEditLock(c.req.valid('param').id)), 200),
});

const editLockReleaseRoute = defineContractRoute(cmsContentContract.releaseEditLock, {
  handler: async (c) => {
    await releaseContentEditLock(c.req.valid('param').id);
    return c.json(okBody(null, '已释放'), 200);
  },
});

const previewLinkRoute = defineContractRoute(cmsContentContract.previewLink, {
  handler: async (c) => c.json(okBody(await createContentPreviewLink(c.req.valid('param').id)), 200),
});

const revokePreviewRoute = defineContractRoute(cmsContentContract.revokePreview, {
  handler: async (c) => {
    const { id, grantId } = c.req.valid('param');
    await revokeCmsContentPreview(id, grantId);
    return c.json(okBody(null, '预览链接已撤销'), 200);
  },
});

// ─── 批量操作 / 复制 / 站群分发 ───────────────────────────────────────────────
const batchMoveRoute = defineContractRoute(cmsContentContract.batchMove, {
  handler: async (c) => {
    const { ids, channelId } = c.req.valid('json');
    const count = await batchMoveCmsContents(ids, channelId, c.req.valid('json').expectedVersions);
    return c.json(okBody(null, `已移动 ${count} 条内容`), 200);
  },
});

const batchFlagsRoute = defineContractRoute(cmsContentContract.batchFlags, {
  handler: async (c) => {
    const { ids, expectedVersions, ...flags } = c.req.valid('json');
    const count = await batchSetCmsContentFlags(ids, flags, expectedVersions);
    return c.json(okBody(null, `已更新 ${count} 条内容`), 200);
  },
});

const batchTagRoute = defineContractRoute(cmsContentContract.batchTag, {
  handler: async (c) => {
    const { ids, tagIds } = c.req.valid('json');
    const count = await batchAddCmsContentTags(ids, tagIds, c.req.valid('json').expectedVersions);
    return c.json(okBody(null, `已为 ${count} 条内容追加标签`), 200);
  },
});

const batchStatusRoute = defineContractRoute(cmsContentContract.batchStatus, {
  handler: async (c) => {
    const { ids, action, reason } = c.req.valid('json');
    const result = await batchTransitionCmsContents(ids, action, reason, c.req.valid('json').expectedVersions);
    const message = result.failed.length === 0
      ? `已处理 ${result.okIds.length} 条内容`
      : `成功 ${result.okIds.length} 条，失败 ${result.failed.length} 条`;
    return c.json(okBody(result, message), 200);
  },
});

const duplicateRoute = defineContractRoute(cmsContentContract.duplicate, {
  handler: async (c) => {
    const { targetChannelId } = c.req.valid('json') ?? {};
    return c.json(okBody(await duplicateCmsContent(c.req.valid('param').id, targetChannelId), '复制成功'), 200);
  },
});

const distributeRoute = defineContractRoute(cmsContentContract.distribute, {
  handler: async (c) => {
    const { ids, targetSiteId, targetChannelId } = c.req.valid('json');
    const count = await distributeCmsContents(ids, targetSiteId, targetChannelId);
    return c.json(okBody(null, `已分发 ${count} 条内容（同站内容自动跳过）`), 200);
  },
});

// ─── 归档 ─────────────────────────────────────────────────────────────────────
const archiveRoute = defineContractRoute(cmsContentContract.archive, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await archiveCmsContents(ids, c.req.valid('json').expectedVersions);
    return c.json(okBody(null, `已归档 ${count} 条（仅已发布/已下线内容可归档）`), 200);
  },
});

const unarchiveRoute = defineContractRoute(cmsContentContract.unarchive, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await unarchiveCmsContents(ids, c.req.valid('json').expectedVersions);
    return c.json(okBody(null, `已取消归档 ${count} 条`), 200);
  },
});

// ─── 操作日志 / 词库检查 ──────────────────────────────────────────────────────
const opLogsRoute = defineContractRoute(cmsContentContract.opLogs, {
  handler: async (c) => c.json(okBody(await listContentOpLogs(c.req.valid('param').id)), 200),
});

const checkTextRoute = defineContractRoute(cmsContentContract.checkText, {
  handler: async (c) => c.json(okBody(await checkCmsText(c.req.valid('json').text)), 200),
});

const persistentLockRoute = defineContractRoute(cmsContentContract.lock, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsContent(id));
    return c.json(okBody(await lockCmsContent(id, c.req.valid('json').reason, c.req.valid('json').expectedVersion), '锁定成功'), 200);
  },
});

const persistentUnlockRoute = defineContractRoute(cmsContentContract.unlock, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsContent(id));
    await unlockCmsContent(id, c.req.valid('json').expectedVersion);
    return c.json(okBody(null, '解锁成功'), 200);
  },
});

// 分两批注册：单批过长会触发 TS2589（类型实例化过深）
mountCrud(router, cmsContentContract,
  { list: listCmsContents, get: getCmsContent, create: createCmsContent },
  {
    exclude: ['update'],
  },
  [
    checkTitleRoute,
    describeLinkRoute,
    updateRouteDef,
    submitRoute,
    publishRoute,
    rejectRoute,
    offlineRoute,
    recycleRoute,
    restoreRoute,
    purgeRoute,
    versionsRoute,
    defineContractRoute(cmsContentContract.version, { handler: async (c) => c.json(okBody(await getContentVersion(c.req.valid('param').id, c.req.valid('param').versionId)), 200) }),
    restoreVersionRoute,
    versionDiffRoute,
  ],
);
router.openapiRoutes([
  workflowPreviewRoute, workflowContextRoute, approvalDetailRoute,
  editLockAcquireRoute, editLockReleaseRoute, previewLinkRoute, revokePreviewRoute,
  batchMoveRoute, batchFlagsRoute, batchTagRoute, batchStatusRoute, duplicateRoute, distributeRoute,
  archiveRoute, unarchiveRoute, opLogsRoute, checkTextRoute,
  persistentLockRoute, persistentUnlockRoute,
] as const);

export default router;
