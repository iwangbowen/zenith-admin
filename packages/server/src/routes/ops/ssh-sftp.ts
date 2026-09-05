import { OpenAPIHono } from '@hono/zod-openapi';
import { Readable } from 'node:stream';
import { HTTPException } from 'hono/http-exception';
import { sshSftpContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard } from '../../middleware/guard';
import { currentUser } from '../../lib/context';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  sftpHome,
  sftpList,
  sftpReadText,
  sftpWriteText,
  sftpCreate,
  sftpDelete,
  sftpRename,
  sftpChmod,
  sftpDownload,
  sftpUpload,
} from '../../services/ops/ssh-sftp.service';
import { assertContentLengthWithinLimit } from '../../services/ops/terminal-files.service';

/**
 * SSH 远程文件（SFTP）路由
 *
 * 端点前缀：/api/ssh-sftp/:profileId/...
 * 权限：system:terminal:execute（与 Web 终端一致）。所有操作针对 SSH 配置对应的远程主机，
 * 配置归属校验在 service 层（getSshConnectParams 按 userId 过滤）完成，杜绝越权访问他人主机。
 */
const router = new OpenAPIHono({ defaultHook: validationHook });
const PERM = 'system:terminal:execute';

const read = [authMiddleware, guard({ permission: PERM })] as const;
const write = (description: string, recordBody = true) =>
  [authMiddleware, guard({ permission: PERM, audit: { description, module: 'Web 终端', recordBody } })] as const;

const homeRoute = defineContractRoute(sshSftpContract.home, {
  middleware: read,
  handler: async (c) => {
    const user = currentUser();
    return c.json(okBody(await sftpHome(user.userId, Number(c.req.valid('param').profileId))), 200);
  },
});

const listRoute = defineContractRoute(sshSftpContract.list, {
  middleware: read,
  handler: async (c) => {
    const user = currentUser();
    return c.json(okBody(await sftpList(user.userId, Number(c.req.valid('param').profileId), c.req.valid('query').path)), 200);
  },
});

const readContentRoute = defineContractRoute(sshSftpContract.content, {
  middleware: read,
  handler: async (c) => {
    const user = currentUser();
    return c.json(okBody(await sftpReadText(user.userId, Number(c.req.valid('param').profileId), c.req.valid('query').path)), 200);
  },
});

const writeContentRoute = defineContractRoute(sshSftpContract.saveContent, {
  middleware: write('SFTP 保存文件', false),
  responses: { 409: { content: jsonContent(ErrorResponse), description: '文件已被他人修改' } },
  handler: async (c) => {
    const user = currentUser();
    const { path: filePath, content, baseEtag } = c.req.valid('json');
    return c.json(okBody(await sftpWriteText(user.userId, Number(c.req.valid('param').profileId), filePath, content, baseEtag), '保存成功'), 200);
  },
});

const createEntryRoute = defineContractRoute(sshSftpContract.create, {
  middleware: write('SFTP 新建文件/目录'),
  handler: async (c) => {
    const user = currentUser();
    const { path: targetPath, type } = c.req.valid('json');
    return c.json(okBody(await sftpCreate(user.userId, Number(c.req.valid('param').profileId), targetPath, type), '创建成功'), 200);
  },
});

const renameEntryRoute = defineContractRoute(sshSftpContract.rename, {
  middleware: write('SFTP 重命名/移动'),
  handler: async (c) => {
    const user = currentUser();
    const { from, to } = c.req.valid('json');
    return c.json(okBody(await sftpRename(user.userId, Number(c.req.valid('param').profileId), from, to), '操作成功'), 200);
  },
});

const deleteEntryRoute = defineContractRoute(sshSftpContract.remove, {
  middleware: write('SFTP 删除文件/目录'),
  handler: async (c) => {
    const user = currentUser();
    await sftpDelete(user.userId, Number(c.req.valid('param').profileId), c.req.valid('query').path);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const chmodEntryRoute = defineContractRoute(sshSftpContract.chmod, {
  middleware: write('SFTP 修改权限'),
  handler: async (c) => {
    const user = currentUser();
    const { path: targetPath, mode } = c.req.valid('json');
    await sftpChmod(user.userId, Number(c.req.valid('param').profileId), targetPath, mode);
    return c.json(okBody(null, '权限已修改'), 200);
  },
});

const downloadRoute = defineContractRoute(sshSftpContract.download, {
  middleware: read,
  responses: { 404: { content: jsonContent(ErrorResponse), description: '文件不存在' } },
  handler: async (c) => {
    const user = currentUser();
    const { stream, fileName } = await sftpDownload(user.userId, Number(c.req.valid('param').profileId), c.req.valid('query').path);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  },
});

const uploadRoute = defineContractRoute(sshSftpContract.upload, {
  middleware: write('SFTP 上传文件', false),
  responses: { 400: { content: jsonContent(ErrorResponse), description: '未选择文件或目标无效' } },
  handler: async (c) => {
    const user = currentUser();
    const profileId = Number(c.req.valid('param').profileId);
    await assertContentLengthWithinLimit(c.req.header('content-length'));
    const body = await c.req.parseBody();
    const dirPath = typeof body.path === 'string' ? body.path : '/';
    const file = body.file;
    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: '未选择文件' });
    }
    return c.json(okBody(await sftpUpload(user.userId, profileId, dirPath, file), '上传成功'), 200);
  },
});

router.openapiRoutes([
  homeRoute,
  listRoute,
  readContentRoute,
  writeContentRoute,
  createEntryRoute,
  renameEntryRoute,
  deleteEntryRoute,
  chmodEntryRoute,
  downloadRoute,
  uploadRoute,
] as const);

export default router;
