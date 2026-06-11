import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { Readable } from 'node:stream';
import { HTTPException } from 'hono/http-exception';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validationHook, commonErrorResponses, ok, okBody, jsonContent, ErrorResponse } from '../lib/openapi-schemas';
import { TerminalDirListingDTO, TerminalFileEntryDTO } from '../lib/openapi-dtos';
import { listDirectory, openDownloadStream, saveUploadedFile } from '../services/terminal-files.service';

/**
 * Web 终端文件浏览/传输路由
 *
 * 权限：`system:terminal:execute`（与 Web 终端一致；终端本身即可访问整个文件系统）。
 */
const terminalFilesRouter = new OpenAPIHono({ defaultHook: validationHook });

const TERMINAL_PERM = 'system:terminal:execute';

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

terminalFilesRouter.openapiRoutes([listRoute, downloadRoute, uploadRoute] as const);

export default terminalFilesRouter;
