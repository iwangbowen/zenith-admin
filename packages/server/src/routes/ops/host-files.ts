import { OpenAPIHono } from '@hono/zod-openapi';
import { Readable } from 'node:stream';
import { HTTPException } from 'hono/http-exception';
import { hostFileContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { assertRemoteHostAccess } from '../../lib/host-access';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  hostFileChmod,
  hostFileCreate,
  hostFileDelete,
  hostFileDownload,
  hostFileHome,
  hostFileList,
  hostFileReadText,
  hostFileRename,
  hostFileUpload,
  hostFileWriteText,
} from '../../services/ops/host-files.service';
import { assertContentLengthWithinLimit } from '../../services/ops/terminal-files.service';

const router = new OpenAPIHono({ defaultHook: validationHook });
const FILE_PERM = 'system:file:use';

const read = [authMiddleware, guard({ permission: FILE_PERM })] as const;
const write = (description: string, recordBody = true) =>
  [authMiddleware, guard({ permission: FILE_PERM, audit: { description, module: '文件管理器', recordBody } })] as const;

const homeRoute = defineContractRoute(hostFileContract.home, {
  middleware: read,
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    return c.json(okBody(await hostFileHome(hostId)), 200);
  },
});

const listRoute = defineContractRoute(hostFileContract.list, {
  middleware: read,
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    return c.json(okBody(await hostFileList(hostId, c.req.valid('query').path)), 200);
  },
});

const readRoute = defineContractRoute(hostFileContract.content, {
  middleware: read,
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    return c.json(okBody(await hostFileReadText(hostId, c.req.valid('query').path)), 200);
  },
});

const writeRoute = defineContractRoute(hostFileContract.saveContent, {
  middleware: write('保存远程主机文件', false),
  responses: { 409: { content: jsonContent(ErrorResponse), description: '文件已被修改' } },
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    const body = c.req.valid('json');
    return c.json(okBody(await hostFileWriteText(hostId, body.path, body.content, body.baseEtag), '保存成功'), 200);
  },
});

const createEntryRoute = defineContractRoute(hostFileContract.create, {
  middleware: write('新建远程主机文件/目录'),
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    const body = c.req.valid('json');
    return c.json(okBody(await hostFileCreate(hostId, body.path, body.type), '创建成功'), 200);
  },
});

const renameRoute = defineContractRoute(hostFileContract.rename, {
  middleware: write('重命名/移动远程主机文件'),
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    const body = c.req.valid('json');
    return c.json(okBody(await hostFileRename(hostId, body.from, body.to), '操作成功'), 200);
  },
});

const deleteRoute = defineContractRoute(hostFileContract.remove, {
  middleware: write('删除远程主机文件/目录'),
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    await hostFileDelete(hostId, c.req.valid('query').path);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const chmodRoute = defineContractRoute(hostFileContract.chmod, {
  middleware: write('修改远程主机文件权限'),
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    const body = c.req.valid('json');
    await hostFileChmod(hostId, body.path, body.mode);
    return c.json(okBody(null, '权限已修改'), 200);
  },
});

const downloadRoute = defineContractRoute(hostFileContract.download, {
  middleware: read,
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    const file = await hostFileDownload(hostId, c.req.valid('query').path);
    return new Response(Readable.toWeb(file.stream) as ReadableStream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(file.size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
});

const uploadRoute = defineContractRoute(hostFileContract.upload, {
  middleware: write('上传远程主机文件', false),
  handler: async (c) => {
    const { hostId } = c.req.valid('param');
    await assertRemoteHostAccess(c, hostId);
    await assertContentLengthWithinLimit(c.req.header('content-length'));
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new HTTPException(400, { message: '未选择文件' });
    return c.json(okBody(await hostFileUpload(hostId, typeof body.path === 'string' ? body.path : '/', file), '上传成功'), 200);
  },
});

router.openapiRoutes([
  homeRoute, listRoute, readRoute, writeRoute, createEntryRoute,
  renameRoute, deleteRoute, chmodRoute, downloadRoute, uploadRoute,
] as const);

export default router;
