import { OpenAPIHono } from '@hono/zod-openapi';
import { cmsContentContract } from '@zenith/shared/cms';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listCmsContents, getCmsContent, createCmsContent, updateCmsContent,
  submitCmsContent, publishCmsContent, rejectCmsContent, offlineCmsContent,
  recycleCmsContents, restoreCmsContents, purgeCmsContents, restoreCmsContentToVersion,
  batchMoveCmsContents, batchSetCmsContentFlags, batchAddCmsContentTags, batchTransitionCmsContents,
  duplicateCmsContent, distributeCmsContents, archiveCmsContents, unarchiveCmsContents,
  checkCmsContentTitle,
} from '../../services/cms/cms-contents.service';
import { listContentVersions, diffContentVersion } from '../../services/cms/cms-versions.service';
import { listContentOpLogs } from '../../services/cms/cms-content-op-logs.service';
import { checkCmsText } from '../../services/cms/cms-word-check.service';
import { acquireContentEditLock, releaseContentEditLock } from '../../services/cms/cms-edit-lock.service';
import { createContentPreviewLink } from '../../services/cms/cms-preview.service';
import { lockCmsContent, unlockCmsContent } from '../../services/cms/cms-content-lock.service';
import { describeCmsLink } from '../../services/cms/cms-link.service';
import { ensureCmsSiteExists, assertSiteAccess } from '../../services/cms/cms-sites.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const read = [authMiddleware, guard({ permission: 'cms:content:list' })] as const;

const listRoute = defineContractRoute(cmsContentContract.list, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listCmsContents(c.req.valid('query'))), 200),
});

const checkTitleRoute = defineContractRoute(cmsContentContract.checkTitle, {
  middleware: read,
  handler: async (c) => {
    const { siteId, title, excludeId } = c.req.valid('query');
    return c.json(okBody(await checkCmsContentTitle(siteId, title, excludeId)), 200);
  },
});

const describeLinkRoute = defineContractRoute(cmsContentContract.linkTarget, {
  middleware: read,
  handler: async (c) => {
    const { siteId, link } = c.req.valid('query');
    await ensureCmsSiteExists(siteId);
    await assertSiteAccess(siteId);
    return c.json(okBody(await describeCmsLink(siteId, link)), 200);
  },
});

const getOneRoute = defineContractRoute(cmsContentContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getCmsContent(c.req.valid('param').id)), 200),
});

const createRouteDef = defineContractRoute(cmsContentContract.create, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:create', audit: { description: '创建 CMS 内容', module: 'CMS内容管理' } })],
  handler: async (c) => c.json(okBody(await createCmsContent(c.req.valid('json')), '创建成功'), 200),
});

const updateRouteDef = defineContractRoute(cmsContentContract.update, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: '更新 CMS 内容', module: 'CMS内容管理' } })],
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
  middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: '提交 CMS 内容审核', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, { ...await getCmsContent(id), body: undefined });
    return c.json(okBody(await submitCmsContent(id), '已提交审核'), 200);
  },
});

const publishRoute = defineContractRoute(cmsContentContract.publish, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:publish', audit: { description: '发布 CMS 内容', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, { ...await getCmsContent(id), body: undefined });
    const row = await publishCmsContent(id);
    return c.json(okBody(row, '发布成功'), 200);
  },
});

const rejectRoute = defineContractRoute(cmsContentContract.reject, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:audit', audit: { description: '驳回 CMS 内容', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { reason } = c.req.valid('json');
    setAuditBeforeData(c, { ...await getCmsContent(id), body: undefined });
    return c.json(okBody(await rejectCmsContent(id, reason), '已驳回'), 200);
  },
});

const offlineRoute = defineContractRoute(cmsContentContract.offline, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:publish', audit: { description: '下线 CMS 内容', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, { ...await getCmsContent(id), body: undefined });
    const row = await offlineCmsContent(id);
    return c.json(okBody(row, '已下线'), 200);
  },
});

// ─── 回收站 ───────────────────────────────────────────────────────────────────
const recycleRoute = defineContractRoute(cmsContentContract.recycle, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:delete', audit: { description: 'CMS 内容移入回收站', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await recycleCmsContents(ids);
    return c.json(okBody(null, `已移入回收站 ${count} 条`), 200);
  },
});

const restoreRoute = defineContractRoute(cmsContentContract.restore, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:delete', audit: { description: 'CMS 内容从回收站恢复', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await restoreCmsContents(ids);
    return c.json(okBody(null, `已恢复 ${count} 条`), 200);
  },
});

const purgeRoute = defineContractRoute(cmsContentContract.purge, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:delete', audit: { description: 'CMS 内容彻底删除', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await purgeCmsContents(ids);
    return c.json(okBody(null, `已彻底删除 ${count} 条`), 200);
  },
});

// ─── 版本历史 ─────────────────────────────────────────────────────────────────
const versionsRoute = defineContractRoute(cmsContentContract.versions, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listContentVersions(c.req.valid('param').id)), 200),
});

const restoreVersionRoute = defineContractRoute(cmsContentContract.restoreVersion, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容版本回滚', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    const before = await getCmsContent(id);
    setAuditBeforeData(c, { ...before, body: undefined });
    const row = await restoreCmsContentToVersion(id, versionId);
    return c.json(okBody(row, '回滚成功'), 200);
  },
});

const versionDiffRoute = defineContractRoute(cmsContentContract.versionDiff, {
  middleware: read,
  handler: async (c) => {
    const { id, versionId } = c.req.valid('param');
    return c.json(okBody(await diffContentVersion(id, versionId)), 200);
  },
});

// ─── 编辑锁 / 草稿预览 ─────────────────────────────────────────────────────────
const editLockAcquireRoute = defineContractRoute(cmsContentContract.acquireEditLock, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:update' })],
  handler: async (c) => c.json(okBody(await acquireContentEditLock(c.req.valid('param').id)), 200),
});

const editLockReleaseRoute = defineContractRoute(cmsContentContract.releaseEditLock, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:update' })],
  handler: async (c) => {
    await releaseContentEditLock(c.req.valid('param').id);
    return c.json(okBody(null, '已释放'), 200);
  },
});

const previewLinkRoute = defineContractRoute(cmsContentContract.previewLink, {
  middleware: read,
  handler: async (c) => c.json(okBody(await createContentPreviewLink(c.req.valid('param').id)), 200),
});

// ─── 批量操作 / 复制 / 站群分发 ───────────────────────────────────────────────
const batchMoveRoute = defineContractRoute(cmsContentContract.batchMove, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容批量移动', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids, channelId } = c.req.valid('json');
    const count = await batchMoveCmsContents(ids, channelId);
    return c.json(okBody(null, `已移动 ${count} 条内容`), 200);
  },
});

const batchFlagsRoute = defineContractRoute(cmsContentContract.batchFlags, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容批量设置属性', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids, ...flags } = c.req.valid('json');
    const count = await batchSetCmsContentFlags(ids, flags);
    return c.json(okBody(null, `已更新 ${count} 条内容`), 200);
  },
});

const batchTagRoute = defineContractRoute(cmsContentContract.batchTag, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容批量打标', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids, tagIds } = c.req.valid('json');
    const count = await batchAddCmsContentTags(ids, tagIds);
    return c.json(okBody(null, `已为 ${count} 条内容追加标签`), 200);
  },
});

const batchStatusRoute = defineContractRoute(cmsContentContract.batchStatus, {
  middleware: [authMiddleware, guard({
    // 三种动作权限不同：路由层放行任一权限持有者，动作级权限在 service 内按映射精确校验
    permission: ['cms:content:update', 'cms:content:publish', 'cms:content:audit'],
    audit: { description: 'CMS 内容批量状态流转', module: 'CMS内容管理' },
  })],
  handler: async (c) => {
    const { ids, action, reason } = c.req.valid('json');
    const result = await batchTransitionCmsContents(ids, action, reason);
    const message = result.failed.length === 0
      ? `已处理 ${result.okIds.length} 条内容`
      : `成功 ${result.okIds.length} 条，失败 ${result.failed.length} 条`;
    return c.json(okBody(result, message), 200);
  },
});

const duplicateRoute = defineContractRoute(cmsContentContract.duplicate, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:create', audit: { description: 'CMS 内容复制', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { targetChannelId } = c.req.valid('json') ?? {};
    return c.json(okBody(await duplicateCmsContent(c.req.valid('param').id, targetChannelId), '复制成功'), 200);
  },
});

const distributeRoute = defineContractRoute(cmsContentContract.distribute, {
  middleware: [authMiddleware, guard({ permission: 'cms:distribution:run', audit: { description: 'CMS 内容站群分发', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids, targetSiteId, targetChannelId } = c.req.valid('json');
    const count = await distributeCmsContents(ids, targetSiteId, targetChannelId);
    return c.json(okBody(null, `已分发 ${count} 条内容（同站内容自动跳过）`), 200);
  },
});

// ─── 归档 ─────────────────────────────────────────────────────────────────────
const archiveRoute = defineContractRoute(cmsContentContract.archive, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容归档', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await archiveCmsContents(ids);
    return c.json(okBody(null, `已归档 ${count} 条（仅已发布/已下线内容可归档）`), 200);
  },
});

const unarchiveRoute = defineContractRoute(cmsContentContract.unarchive, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:update', audit: { description: 'CMS 内容取消归档', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const count = await unarchiveCmsContents(ids);
    return c.json(okBody(null, `已取消归档 ${count} 条`), 200);
  },
});

// ─── 操作日志 / 词库检查 ──────────────────────────────────────────────────────
const opLogsRoute = defineContractRoute(cmsContentContract.opLogs, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listContentOpLogs(c.req.valid('param').id)), 200),
});

const checkTextRoute = defineContractRoute(cmsContentContract.checkText, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:update' })],
  handler: async (c) => c.json(okBody(await checkCmsText(c.req.valid('json').text)), 200),
});

const persistentLockRoute = defineContractRoute(cmsContentContract.lock, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:lock', audit: { description: '持久锁定 CMS 内容', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsContent(id));
    return c.json(okBody(await lockCmsContent(id, c.req.valid('json').reason), '锁定成功'), 200);
  },
});

const persistentUnlockRoute = defineContractRoute(cmsContentContract.unlock, {
  middleware: [authMiddleware, guard({ permission: 'cms:content:lock', audit: { description: '解除 CMS 内容持久锁', module: 'CMS内容管理' } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getCmsContent(id));
    await unlockCmsContent(id);
    return c.json(okBody(null, '解锁成功'), 200);
  },
});

// 分两批注册：单批过长会触发 TS2589（类型实例化过深）
router.openapiRoutes([
  listRoute, checkTitleRoute, describeLinkRoute, getOneRoute, createRouteDef, updateRouteDef,
  submitRoute, publishRoute, rejectRoute, offlineRoute,
  recycleRoute, restoreRoute, purgeRoute,
  versionsRoute, restoreVersionRoute, versionDiffRoute,
] as const);
router.openapiRoutes([
  editLockAcquireRoute, editLockReleaseRoute, previewLinkRoute,
  batchMoveRoute, batchFlagsRoute, batchTagRoute, batchStatusRoute, duplicateRoute, distributeRoute,
  archiveRoute, unarchiveRoute, opLogsRoute, checkTextRoute,
  persistentLockRoute, persistentUnlockRoute,
] as const);

export default router;
