import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import fs from 'node:fs';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validationHook, commonErrorResponses, ok, okMsg, ErrorResponse, jsonContent, okBody, errBody } from '../lib/openapi-schemas';
import { LogFileDTO, LogFileContentDTO } from '../lib/openapi-dtos';
import {
  readLastLines, watchTail,
  listLogFiles, readLogFileLines, deleteLogFile, resolveLogFile,
} from '../services/log-files.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/', tags: ['LogFiles'], summary: '日志文件列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:files' })] as const,
    responses: { ...ok(z.array(LogFileDTO), '日志文件列表'), ...commonErrorResponses },
  }),
  handler: async (c) => c.json(okBody(listLogFiles(), 'success'), 200),
});

const contentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get', path: '/:filename/content', tags: ['LogFiles'], summary: '读取日志文件内容（最后 N 行）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:files' })] as const,
    request: {
      params: z.object({ filename: z.string().openapi({ param: { name: 'filename', in: 'path' }, example: 'app.log' }) }),
      query: z.object({
        lines: z.coerce.number().min(1).max(5000).default(500).optional(),
        keyword: z.string().max(200).optional(),
      }),
    },
    responses: {
      ...ok(LogFileContentDTO, '文件内容'),
      ...commonErrorResponses,
      400: { content: jsonContent(ErrorResponse), description: '无效的文件名' },
      404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
    },
  }),
  handler: async (c) => {
    const q = c.req.valid('query');
    const lines = readLogFileLines(c.req.param('filename'), q.lines ?? 500, q.keyword);
    return c.json(okBody({ lines }, 'success'), 200);
  },
});

const deleteApiRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete', path: '/:filename', tags: ['LogFiles'], summary: '删除日志文件',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:files:delete' })] as const,
    request: {
      params: z.object({ filename: z.string().openapi({ param: { name: 'filename', in: 'path' }, example: 'app.log' }) }),
    },
    responses: {
      ...okMsg('删除成功'),
      ...commonErrorResponses,
      400: { content: jsonContent(ErrorResponse), description: '无效的文件名' },
      404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
    },
  }),
  handler: async (c) => {
    deleteLogFile(c.req.param('filename'));
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, contentRoute, deleteApiRoute] as const);

// 非 OpenAPI 路由：下载 & SSE
router.get('/:filename/download', authMiddleware, guard({ permission: 'system:log:files:download' }), async (c) => {
  const { name, filepath } = resolveLogFile(c.req.param('filename'));
  const stat = fs.statSync(filepath);
  const stream = fs.createReadStream(filepath);
  const { Readable } = await import('node:stream');
  const webStream = Readable.toWeb(stream) as ReadableStream;
  return new Response(webStream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
      'Content-Length': String(stat.size),
    },
  });
});

router.get('/:filename/tail', authMiddleware, guard({ permission: 'system:log:files' }), async (c) => {
  const rawName = c.req.param('filename');
  if (rawName.endsWith('.gz')) return c.json(errBody('压缩文件不支持实时追踪'), 400);
  const { filepath } = resolveLogFile(rawName);
  return streamSSE(c, async (stream) => {
    const initialLines = readLastLines(filepath, 100);
    for (const line of initialLines) {
      await stream.writeSSE({ data: line, event: 'log' });
    }
    let position = fs.statSync(filepath).size;
    const signal = c.req.raw.signal;
    await watchTail(filepath, signal, position, async (newLines, newPos) => {
      position = newPos;
      for (const line of newLines) {
        await stream.writeSSE({ data: line, event: 'log' });
      }
    });
  });
});

export default router;
