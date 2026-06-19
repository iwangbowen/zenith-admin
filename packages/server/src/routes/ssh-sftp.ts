import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { Readable } from 'node:stream';
import { HTTPException } from 'hono/http-exception';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { currentUser } from '../lib/context';
import {
  validationHook,
  commonErrorResponses,
  ok,
  okMsg,
  okBody,
  jsonContent,
  ErrorResponse,
} from '../lib/openapi-schemas';
import { SftpDirListingDTO, SftpFileEntryDTO, SftpFileContentDTO, SftpHomeDTO } from '../lib/openapi-dtos';
import {
  sftpHome,
  sftpList,
  sftpReadText,
  sftpWriteText,
  sftpCreate,
  sftpDelete,
  sftpRename,
  sftpDownload,
  sftpUpload,
} from '../services/ssh-sftp.service';

/**
 * SSH 远程文件（SFTP）路由
 *
 * 端点前缀：/api/ssh-sftp/:profileId/...
 * 权限：system:terminal:execute（与 Web 终端一致）。所有操作针对 SSH 配置对应的远程主机，
 * 配置归属校验在 service 层（getSshConnectParams 按 userId 过滤）完成，杜绝越权访问他人主机。
 */
const router = new OpenAPIHono({ defaultHook: validationHook });
const PERM = 'system:terminal:execute';

const ProfileIdParam = z.object({
  profileId: z.coerce.number().int().openapi({ param: { name: 'profileId', in: 'path' }, example: 1 }),
});

const homeRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:profileId/home', tags: ['SshSftp'], summary: '获取远程 home 目录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: { params: ProfileIdParam },
    responses: { ...commonErrorResponses, ...ok(SftpHomeDTO, '远程 home 目录') },
  }),
  handler: async (c) => {
    const user = currentUser();
    return c.json(okBody(await sftpHome(user.userId, Number(c.req.valid('param').profileId))), 200);
  },
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:profileId/list', tags: ['SshSftp'], summary: '列出远程目录内容',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: { params: ProfileIdParam, query: z.object({ path: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...ok(SftpDirListingDTO, '远程目录列表') },
  }),
  handler: async (c) => {
    const user = currentUser();
    return c.json(okBody(await sftpList(user.userId, Number(c.req.valid('param').profileId), c.req.valid('query').path)), 200);
  },
});

const readContentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:profileId/content', tags: ['SshSftp'], summary: '读取远程文本文件内容',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: { params: ProfileIdParam, query: z.object({ path: z.string().min(1) }) },
    responses: { ...commonErrorResponses, ...ok(SftpFileContentDTO, '文件内容') },
  }),
  handler: async (c) => {
    const user = currentUser();
    return c.json(okBody(await sftpReadText(user.userId, Number(c.req.valid('param').profileId), c.req.valid('query').path)), 200);
  },
});

const writeContentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/:profileId/content', tags: ['SshSftp'], summary: '保存远程文本文件内容',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: 'SFTP 保存文件', module: 'Web 终端', recordBody: false } })] as const,
    request: { params: ProfileIdParam, body: { content: jsonContent(z.object({ path: z.string().min(1), content: z.string() })), required: true } },
    responses: { ...commonErrorResponses, ...ok(SftpFileEntryDTO, '保存成功') },
  }),
  handler: async (c) => {
    const user = currentUser();
    const { path: filePath, content } = c.req.valid('json');
    return c.json(okBody(await sftpWriteText(user.userId, Number(c.req.valid('param').profileId), filePath, content), '保存成功'), 200);
  },
});

const createEntryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/:profileId/create', tags: ['SshSftp'], summary: '新建远程文件或目录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: 'SFTP 新建文件/目录', module: 'Web 终端' } })] as const,
    request: { params: ProfileIdParam, body: { content: jsonContent(z.object({ path: z.string().min(1), type: z.enum(['file', 'dir']) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(SftpFileEntryDTO, '创建成功') },
  }),
  handler: async (c) => {
    const user = currentUser();
    const { path: targetPath, type } = c.req.valid('json');
    return c.json(okBody(await sftpCreate(user.userId, Number(c.req.valid('param').profileId), targetPath, type), '创建成功'), 200);
  },
});

const renameEntryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/:profileId/rename', tags: ['SshSftp'], summary: '重命名 / 移动远程文件或目录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: 'SFTP 重命名/移动', module: 'Web 终端' } })] as const,
    request: { params: ProfileIdParam, body: { content: jsonContent(z.object({ from: z.string().min(1), to: z.string().min(1) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(SftpFileEntryDTO, '操作成功') },
  }),
  handler: async (c) => {
    const user = currentUser();
    const { from, to } = c.req.valid('json');
    return c.json(okBody(await sftpRename(user.userId, Number(c.req.valid('param').profileId), from, to), '操作成功'), 200);
  },
});

const deleteEntryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/:profileId/entry', tags: ['SshSftp'], summary: '删除远程文件或目录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: 'SFTP 删除文件/目录', module: 'Web 终端' } })] as const,
    request: { params: ProfileIdParam, query: z.object({ path: z.string().min(1) }) },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    const user = currentUser();
    await sftpDelete(user.userId, Number(c.req.valid('param').profileId), c.req.valid('query').path);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const downloadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:profileId/download', tags: ['SshSftp'], summary: '下载远程文件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM })] as const,
    request: { params: ProfileIdParam, query: z.object({ path: z.string().min(1) }) },
    responses: {
      ...commonErrorResponses,
      200: { content: { 'application/octet-stream': { schema: z.string() } }, description: '文件内容' },
      404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
    },
  }),
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

const uploadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/:profileId/upload', tags: ['SshSftp'], summary: '上传文件到远程目录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: PERM, audit: { description: 'SFTP 上传文件', module: 'Web 终端', recordBody: false } })] as const,
    request: {
      params: ProfileIdParam,
      body: {
        content: {
          'multipart/form-data': {
            schema: z.object({
              path: z.string(),
              file: z.any().openapi({ type: 'string', format: 'binary' }),
            }),
          },
        },
        required: true,
      },
    },
    responses: {
      ...commonErrorResponses,
      ...ok(SftpFileEntryDTO, '上传成功'),
      400: { content: jsonContent(ErrorResponse), description: '未选择文件或目标无效' },
    },
  }),
  handler: async (c) => {
    const user = currentUser();
    const profileId = Number(c.req.valid('param').profileId);
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
  downloadRoute,
  uploadRoute,
] as const);

export default router;
