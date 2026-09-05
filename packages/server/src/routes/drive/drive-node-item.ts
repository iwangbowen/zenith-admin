import { OpenAPIHono } from '@hono/zod-openapi';
import { driveNodeContract } from '@zenith/shared/drive';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { parseRangeHeader, rangeNotSatisfiable, supportsRange } from '../../lib/http-range';
import { ensureNodeRole } from '../../services/drive/drive-access.service';
import { getDriveNodeAccessUrl, openDriveNodeContent, prepareDriveNodeContent, readDriveNodeThumbnail } from '../../services/drive/drive-content.service';
import { listNodeActivities } from '../../services/drive/drive-activity.service';
import { ensureDriveNodeExists, getDriveNodeDetail, renameDriveNode } from '../../services/drive/drive-nodes.service';
import { getDriveNodePermissions, getDriveNodePermissionsBeforeAudit, saveDriveNodePermissions, setDriveNodeInherit } from '../../services/drive/drive-permissions.service';
import { deleteDriveNodeVersion, listDriveNodeVersions, restoreDriveNodeVersion, uploadDriveNodeVersion } from '../../services/drive/drive-upload.service';
import { setDriveNodeStar } from '../../services/drive/drive-views.service';
import { createDriveNodeComment, deleteDriveNodeComment, listDriveNodeComments, lockDriveNode, setDriveNodeTags, unlockDriveNode } from '../../services/drive/drive-extras.service';
import { createDriveShareLink, listNodeShareLinks } from '../../services/drive/drive-share.service';
import { binaryResponses, streamStoredContent } from './drive-nodes';

/**
 * /api/drive/nodes/{id}/... 单节点路由。
 * 与 drive-nodes.ts（静态路径）拆成两个路由器顺序挂载在同一路径：静态路径先于 /{id}，
 * 同时避免单个 openapiRoutes 元组过大触发 TS2589。
 */
const router = new OpenAPIHono({ defaultHook: validationHook });
const AUDIT = { module: '企业网盘' } as const;

const read = [authMiddleware, guard({ permission: 'drive:node:list' })] as const;
const download = [authMiddleware, guard({ permission: 'drive:node:download' })] as const;
const edit = [authMiddleware, guard({ permission: 'drive:node:edit' })] as const;

// ─── 单节点 ───────────────────────────────────────────────────────────────────

const detailRoute = defineContractRoute(driveNodeContract.detail, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getDriveNodeDetail(c.req.valid('param').id)), 200),
});

const renameRoute = defineContractRoute(driveNodeContract.rename, {
  middleware: [authMiddleware, guard({ permission: 'drive:node:edit', audit: { description: '重命名网盘文件', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await ensureDriveNodeExists(id);
    setAuditBeforeData(c, { id, name: before.name });
    return c.json(okBody(await renameDriveNode(id, c.req.valid('json').name), '已重命名'), 200);
  },
});

const contentRoute = defineContractRoute(driveNodeContract.content, {
  middleware: read,
  responses: binaryResponses,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { download, version } = c.req.valid('query');
    const prepared = await prepareDriveNodeContent(id, !!download, version);
    const { file, node } = prepared;
    const range = supportsRange(file.provider) ? parseRangeHeader(c.req.header('range'), file.size) : null;
    if (range === 'invalid') return rangeNotSatisfiable(file.size, { 'Cache-Control': 'private, no-store' });
    const stored = await openDriveNodeContent(prepared, range);
    return streamStoredContent({
      stream: stored.stream, contentType: stored.contentType, fileName: node.name, size: file.size,
      provider: file.provider, range, download: !!download, etag: `"d${file.id}-${file.size}"`,
    });
  },
});

const thumbnailRoute = defineContractRoute(driveNodeContract.thumbnail, {
  middleware: read,
  responses: binaryResponses,
  handler: async (c) => {
    const { stored, file } = await readDriveNodeThumbnail(c.req.valid('param').id);
    return new Response(stored.stream, {
      status: 200,
      headers: {
        'Content-Type': stored.contentType,
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=86400',
        ETag: `"t${file.id}"`,
      },
    });
  },
});

const accessUrlRoute = defineContractRoute(driveNodeContract.accessUrl, {
  middleware: download,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { purpose } = c.req.valid('query');
    return c.json(okBody(await getDriveNodeAccessUrl(id, purpose)), 200, { 'Cache-Control': 'private, no-store' });
  },
});

// ─── 版本 ─────────────────────────────────────────────────────────────────────

const versionsRoute = defineContractRoute(driveNodeContract.versions, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listDriveNodeVersions(c.req.valid('param').id)), 200),
});

const uploadVersionRoute = defineContractRoute(driveNodeContract.uploadVersion, {
  middleware: [authMiddleware, guard({ permission: 'drive:node:upload', audit: { description: '上传网盘文件新版本', recordBody: false, ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = await c.req.parseBody();
    const file = body.file;
    if (typeof (file as File)?.arrayBuffer !== 'function') return c.json(errBody('请选择要上传的文件', 400), 400);
    const comment = typeof body.comment === 'string' ? body.comment.slice(0, 500) : undefined;
    return c.json(okBody(await uploadDriveNodeVersion(id, file as File, comment), '已上传新版本'), 200);
  },
});

const versionContentRoute = defineContractRoute(driveNodeContract.versionContent, {
  middleware: download,
  responses: binaryResponses,
  handler: async (c) => {
    const { id, version } = c.req.valid('param');
    const prepared = await prepareDriveNodeContent(id, true, version);
    const stored = await openDriveNodeContent(prepared, null);
    return streamStoredContent({
      stream: stored.stream, contentType: stored.contentType, fileName: `v${version}-${prepared.node.name}`, size: prepared.file.size,
      provider: prepared.file.provider, range: null, download: true, etag: `"d${prepared.file.id}-${prepared.file.size}"`,
    });
  },
});

const versionRestoreRoute = defineContractRoute(driveNodeContract.restoreVersion, {
  middleware: [authMiddleware, guard({ permission: 'drive:node:edit', audit: { description: '回滚网盘文件版本', ...AUDIT } })],
  handler: async (c) => {
    const { id, version } = c.req.valid('param');
    return c.json(okBody(await restoreDriveNodeVersion(id, version), '已回滚'), 200);
  },
});

const versionDeleteRoute = defineContractRoute(driveNodeContract.removeVersion, {
  middleware: [authMiddleware, guard({ permission: 'drive:node:delete', audit: { description: '删除网盘文件历史版本', ...AUDIT } })],
  handler: async (c) => {
    const { id, version } = c.req.valid('param');
    await deleteDriveNodeVersion(id, version);
    return c.json(okBody(null, '已删除'), 200);
  },
});

// ─── 授权 ─────────────────────────────────────────────────────────────────────

const permissionsRoute = defineContractRoute(driveNodeContract.permissions, {
  middleware: read,
  handler: async (c) => c.json(okBody(await getDriveNodePermissions(c.req.valid('param').id)), 200),
});

const savePermissionsRoute = defineContractRoute(driveNodeContract.savePermissions, {
  middleware: [authMiddleware, guard({ permission: 'drive:node:grant', audit: { description: '保存网盘节点授权', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getDriveNodePermissionsBeforeAudit(id));
    const result = await saveDriveNodePermissions(id, c.req.valid('json'));
    setAuditAfterData(c, await getDriveNodePermissionsBeforeAudit(id));
    return c.json(okBody(result, '保存成功'), 200);
  },
});

const inheritRoute = defineContractRoute(driveNodeContract.setInherit, {
  middleware: [authMiddleware, guard({ permission: 'drive:node:grant', audit: { description: '变更网盘节点继承', ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await setDriveNodeInherit(id, c.req.valid('json')), '已更新'), 200);
  },
});

// ─── 动态 / 评论 / 收藏 / 标签 / 锁 / 外链 ─────────────────────────────────────

const activitiesRoute = defineContractRoute(driveNodeContract.activities, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const node = await ensureDriveNodeExists(id, { allowDeleted: true });
    await ensureNodeRole(node, 'viewer', '没有该文件的访问权限');
    return c.json(okBody(await listNodeActivities(id, c.req.valid('query'))), 200);
  },
});

const commentsRoute = defineContractRoute(driveNodeContract.comments, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listDriveNodeComments(c.req.valid('param').id)), 200),
});

const createCommentRoute = defineContractRoute(driveNodeContract.createComment, {
  middleware: read,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await createDriveNodeComment(id, c.req.valid('json')), '已评论'), 200);
  },
});

const deleteCommentRoute = defineContractRoute(driveNodeContract.removeComment, {
  middleware: read,
  handler: async (c) => {
    const { id, commentId } = c.req.valid('param');
    await deleteDriveNodeComment(id, commentId);
    return c.json(okBody(null, '已删除'), 200);
  },
});

const starRoute = defineContractRoute(driveNodeContract.star, {
  middleware: read,
  handler: async (c) => {
    await setDriveNodeStar(c.req.valid('param').id, true);
    return c.json(okBody(null, '已收藏'), 200);
  },
});

const unstarRoute = defineContractRoute(driveNodeContract.unstar, {
  middleware: read,
  handler: async (c) => {
    await setDriveNodeStar(c.req.valid('param').id, false);
    return c.json(okBody(null, '已取消收藏'), 200);
  },
});

const tagsRoute = defineContractRoute(driveNodeContract.setTags, {
  middleware: edit,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await setDriveNodeTags(id, c.req.valid('json').tagIds), '已更新'), 200);
  },
});

const lockRoute = defineContractRoute(driveNodeContract.lock, {
  middleware: [authMiddleware, guard({ permission: 'drive:node:edit', audit: { description: '锁定网盘文件', ...AUDIT } })],
  responses: { 423: { content: jsonContent(ErrorResponse), description: '已被他人锁定' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await lockDriveNode(id, c.req.valid('json')), '已锁定'), 200);
  },
});

const unlockRoute = defineContractRoute(driveNodeContract.unlock, {
  middleware: [authMiddleware, guard({ permission: 'drive:node:edit', audit: { description: '解锁网盘文件', ...AUDIT } })],
  handler: async (c) => c.json(okBody(await unlockDriveNode(c.req.valid('param').id), '已解锁'), 200),
});

const nodeShareLinksRoute = defineContractRoute(driveNodeContract.shareLinks, {
  middleware: read,
  handler: async (c) => c.json(okBody(await listNodeShareLinks(c.req.valid('param').id)), 200),
});

const createShareLinkRoute = defineContractRoute(driveNodeContract.createShareLink, {
  middleware: [authMiddleware, guard({ permission: 'drive:link:create', audit: { description: '创建网盘外链', recordBody: false, ...AUDIT } })],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await createDriveShareLink(id, c.req.valid('json')), '已创建'), 200);
  },
});

router.openapiRoutes([
  detailRoute, renameRoute, contentRoute, thumbnailRoute, accessUrlRoute,
  versionsRoute, uploadVersionRoute, versionContentRoute, versionRestoreRoute, versionDeleteRoute,
  permissionsRoute, savePermissionsRoute, inheritRoute,
  activitiesRoute, commentsRoute, createCommentRoute, deleteCommentRoute,
  starRoute, unstarRoute, tagsRoute, lockRoute, unlockRoute,
  nodeShareLinksRoute, createShareLinkRoute,
] as const);

export default router;
