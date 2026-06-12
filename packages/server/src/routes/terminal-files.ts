import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { Readable } from 'node:stream';
import { HTTPException } from 'hono/http-exception';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validationHook, commonErrorResponses, ok, okMsg, okBody, jsonContent, ErrorResponse } from '../lib/openapi-schemas';
import { TerminalDirListingDTO, TerminalFileEntryDTO, TerminalShellsDTO, TerminalFileContentDTO, TerminalRootInfoDTO } from '../lib/openapi-dtos';
import {
  listDirectory,
  openDownloadStream,
  saveUploadedFile,
  listShells,
  readTextFile,
  writeTextFile,
  createEntry,
  deleteEntry,
  renameEntry,
  getRootInfo,
} from '../services/terminal-files.service';

/**
 * Web 终端文件浏览/传输路由
 *
 * 权限：`system:terminal:execute`（与 Web 终端一致；终端本身即可访问整个文件系统）。
 */
const terminalFilesRouter = new OpenAPIHono({ defaultHook: validationHook });

const TERMINAL_PERM = 'system:terminal:execute';

const rootInfoRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/root-info', tags: ['TerminalFiles'], summary: '获取文件系统根信息（盘符、home 目录等）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: TERMINAL_PERM })] as const,
    responses: { ...commonErrorResponses, ...ok(TerminalRootInfoDTO, '根信息') },
  }),
  handler: async (c) => c.json(okBody(await getRootInfo()), 200),
});

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/list', tags: ['TerminalFiles'], summary: '列出目录内容',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: TERMINAL_PERM })] as const,
    request: { query: z.object({ path: z.string().optional() }) },
    responses: { ...commonErrorResponses, ...ok(TerminalDirListingDTO, '目录列表') },
  }),
  handler: async (c) => c.json(okBody(await listDirectory(c.req.valid('query').path)), 200),
});

const downloadRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/download', tags: ['TerminalFiles'], summary: '下载文件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: TERMINAL_PERM })] as const,
    request: { query: z.object({ path: z.string().min(1) }) },
    responses: {
      ...commonErrorResponses,
      200: { content: { 'application/octet-stream': { schema: z.string() } }, description: '文件内容' },
      404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
    },
  }),
  handler: async (c) => {
    const { path: filePath } = c.req.valid('query');
    const { stream, fileName } = await openDownloadStream(filePath);
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
    method: 'post', path: '/upload', tags: ['TerminalFiles'], summary: '上传文件到目录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: TERMINAL_PERM, audit: { description: '终端上传文件', module: 'Web 终端', recordBody: false } })] as const,
    request: {
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
      ...ok(TerminalFileEntryDTO, '上传成功'),
      400: { content: jsonContent(ErrorResponse), description: '未选择文件或目标无效' },
    },
  }),
  handler: async (c) => {
    const body = await c.req.parseBody();
    const dirPath = typeof body.path === 'string' ? body.path : '';
    const file = body.file;
    if (!(file instanceof File)) {
      throw new HTTPException(400, { message: '未选择文件' });
    }
    const entry = await saveUploadedFile(dirPath, file);
    return c.json(okBody(entry, '上传成功'), 200);
  },
});

const shellsRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/shells', tags: ['TerminalFiles'], summary: '获取可用 shell 列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: TERMINAL_PERM })] as const,
    responses: { ...commonErrorResponses, ...ok(TerminalShellsDTO, '可用 shell 列表') },
  }),
  handler: (c) => c.json(okBody(listShells()), 200),
});

const readContentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/content', tags: ['TerminalFiles'], summary: '读取文本文件内容',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: TERMINAL_PERM })] as const,
    request: { query: z.object({ path: z.string().min(1) }) },
    responses: { ...commonErrorResponses, ...ok(TerminalFileContentDTO, '文件内容') },
  }),
  handler: async (c) => c.json(okBody(await readTextFile(c.req.valid('query').path)), 200),
});

const writeContentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'put', path: '/content', tags: ['TerminalFiles'], summary: '保存文本文件内容',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: TERMINAL_PERM, audit: { description: '终端保存文件', module: 'Web 终端', recordBody: false } })] as const,
    request: { body: { content: jsonContent(z.object({ path: z.string().min(1), content: z.string() })), required: true } },
    responses: { ...commonErrorResponses, ...ok(TerminalFileEntryDTO, '保存成功') },
  }),
  handler: async (c) => {
    const { path: filePath, content } = c.req.valid('json');
    return c.json(okBody(await writeTextFile(filePath, content), '保存成功'), 200);
  },
});

const createEntryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/create', tags: ['TerminalFiles'], summary: '新建文件或目录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: TERMINAL_PERM, audit: { description: '终端新建文件/目录', module: 'Web 终端' } })] as const,
    request: { body: { content: jsonContent(z.object({ path: z.string().min(1), type: z.enum(['file', 'dir']) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(TerminalFileEntryDTO, '创建成功') },
  }),
  handler: async (c) => {
    const { path: targetPath, type } = c.req.valid('json');
    return c.json(okBody(await createEntry(targetPath, type), '创建成功'), 200);
  },
});

const renameEntryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'post', path: '/rename', tags: ['TerminalFiles'], summary: '重命名 / 移动文件或目录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: TERMINAL_PERM, audit: { description: '终端重命名/移动', module: 'Web 终端' } })] as const,
    request: { body: { content: jsonContent(z.object({ from: z.string().min(1), to: z.string().min(1) })), required: true } },
    responses: { ...commonErrorResponses, ...ok(TerminalFileEntryDTO, '操作成功') },
  }),
  handler: async (c) => {
    const { from, to } = c.req.valid('json');
    return c.json(okBody(await renameEntry(from, to), '操作成功'), 200);
  },
});

const deleteEntryRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/entry', tags: ['TerminalFiles'], summary: '删除文件或目录',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: TERMINAL_PERM, audit: { description: '终端删除文件/目录', module: 'Web 终端' } })] as const,
    request: { query: z.object({ path: z.string().min(1) }) },
    responses: { ...commonErrorResponses, ...okMsg('删除成功') },
  }),
  handler: async (c) => {
    await deleteEntry(c.req.valid('query').path);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

terminalFilesRouter.openapiRoutes([
  rootInfoRoute,
  listRoute,
  downloadRoute,
  uploadRoute,
  shellsRoute,
  readContentRoute,
  writeContentRoute,
  createEntryRoute,
  renameEntryRoute,
  deleteEntryRoute,
] as const);

export default terminalFilesRouter;
