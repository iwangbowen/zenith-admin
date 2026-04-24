import { OpenAPIHono, createRoute, defineOpenAPIRoute, z } from '@hono/zod-openapi';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { streamSSE } from 'hono/streaming';
import { config } from '../config';
import { authMiddleware } from '../middleware/auth';
import { guard } from '../middleware/guard';
import { validationHook, commonErrorResponses, ok, okMsg, ErrorResponse, jsonContent, okBody, errBody } from '../lib/openapi-schemas';
import { LogFileDTO, LogFileContentDTO } from '../lib/openapi-dtos';

const LOG_DIR = path.resolve(config.log.dir);

/**
 * 安全校验文件名：防止路径穿越。
 * 返回 null 表示非法文件名。
 */
function safeFilename(filename: string): string | null {
  if (!filename || filename.includes('/') || filename.includes('\\') || filename.includes('..') || filename.startsWith('.')) {
    return null;
  }
  return filename;
}

/** 解析文件完整路径并验证在 LOG_DIR 内（双重保护） */
function resolveLogPath(filename: string): string | null {
  const resolved = path.resolve(LOG_DIR, filename);
  if (!resolved.startsWith(LOG_DIR + path.sep) && resolved !== LOG_DIR) {
    return null;
  }
  return resolved;
}

/** 读取普通文本文件最后 N 行 */
function readLastLines(filepath: string, n: number): string[] {
  const content = fs.readFileSync(filepath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim() !== '');
  return lines.slice(-n);
}

/** 读取 gzip 文件最后 N 行 */
function readGzipLastLines(filepath: string, n: number): string[] {
  const compressed = fs.readFileSync(filepath);
  const content = zlib.gunzipSync(compressed).toString('utf-8');
  const lines = content.split('\n').filter(l => l.trim() !== '');
  return lines.slice(-n);
}

/** 轮询文件新增内容并回调，直到 signal 中止 */
async function watchTail(
  filepath: string,
  signal: AbortSignal,
  initialPosition: number,
  onLines: (lines: string[], newPosition: number) => Promise<void>,
): Promise<void> {
  let position = initialPosition;
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return; }

    const interval = setInterval(() => {
      if (signal.aborted) { clearInterval(interval); resolve(); return; }
      if (!fs.existsSync(filepath)) { clearInterval(interval); resolve(); return; }
      const stat = fs.statSync(filepath);
      if (stat.size > position) {
        const fd = fs.openSync(filepath, 'r');
        const newBytes = stat.size - position;
        const buf = Buffer.alloc(newBytes);
        fs.readSync(fd, buf, 0, newBytes, position);
        fs.closeSync(fd);
        position = stat.size;
        const newLines = buf.toString('utf-8').split('\n').filter(l => l.trim() !== '');
        if (newLines.length > 0) {
          void onLines(newLines, position);
        }
      }
    }, 1000);

    signal.addEventListener('abort', () => { clearInterval(interval); resolve(); });
  });
}

const router = new OpenAPIHono({ defaultHook: validationHook });

// ─── Routes ────────────────────────────────────────────────────────────────

const listRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/',
    tags: ['LogFiles'],
    summary: '日志文件列表',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:files' })] as const,
    responses: {
      ...ok(z.array(LogFileDTO), '日志文件列表'),
      ...commonErrorResponses,
    },
  }),
  handler: async (c) => {
    if (!fs.existsSync(LOG_DIR)) {
      return c.json(okBody([], 'success'), 200);
    }

    const entries = fs.readdirSync(LOG_DIR, { withFileTypes: true });
    const files = entries
      .filter(e => e.isFile() && (e.name.endsWith('.log') || e.name.endsWith('.log.gz')))
      .map(e => {
        const stat = fs.statSync(path.join(LOG_DIR, e.name));
        return {
          name: e.name,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          isGzip: e.name.endsWith('.gz'),
        };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));

    return c.json(okBody(files, 'success'), 200);
  },
});

const contentRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'get',
    path: '/:filename/content',
    tags: ['LogFiles'],
    summary: '读取日志文件内容（最后 N 行）',
    security: [{ BearerAuth: [] }],
    middleware: [authMiddleware, guard({ permission: 'system:log:files' })] as const,
    request: {
      params: z.object({ filename: z.string().openapi({ param: { name: 'filename', in: 'path' }, example: 'app.log' }) }),
      query: z.object({ lines: z.coerce.number().min(1).max(5000).default(500).optional() }),
    },
    responses: {
      ...ok(LogFileContentDTO, '文件内容'),
      ...commonErrorResponses,
      400: { content: jsonContent(ErrorResponse), description: '无效的文件名' },
      404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
    },
  }),
  handler: async (c) => {
    const name = safeFilename(c.req.param('filename'));
    if (!name) return c.json(errBody('无效的文件名'), 400);

    const filepath = resolveLogPath(name);
    if (!filepath || !fs.existsSync(filepath)) {
      return c.json(errBody('文件不存在', 404), 404);
    }

    const q = c.req.valid('query');
    const n = q.lines ?? 500;

    const isGzip = name.endsWith('.gz');
    const lines = isGzip ? readGzipLastLines(filepath, n) : readLastLines(filepath, n);

    return c.json(okBody({ lines }, 'success'), 200);
  },
});

const deleteRoute = defineOpenAPIRoute({
  route: createRoute({
    method: 'delete',
    path: '/:filename',
    tags: ['LogFiles'],
    summary: '删除日志文件',
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
    const name = safeFilename(c.req.param('filename'));
    if (!name) return c.json(errBody('无效的文件名'), 400);

    const filepath = resolveLogPath(name);
    if (!filepath || !fs.existsSync(filepath)) {
      return c.json(errBody('文件不存在', 404), 404);
    }

    fs.unlinkSync(filepath);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

router.openapiRoutes([listRoute, contentRoute, deleteRoute] as const);

// ─── 非 OpenAPI 路由：文件下载 & SSE 实时追踪 ────────────────────────────

/** 文件下载（原始文件） */
router.get('/:filename/download', authMiddleware, guard({ permission: 'system:log:files:download' }), async (c) => {
  const name = safeFilename(c.req.param('filename'));
  if (!name) return c.json(errBody('无效的文件名'), 400);

  const filepath = resolveLogPath(name);
  if (!filepath || !fs.existsSync(filepath)) {
    return c.json(errBody('文件不存在', 404), 404);
  }

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

/** SSE 实时追踪（仅支持未压缩的 .log 文件） */
router.get('/:filename/tail', authMiddleware, guard({ permission: 'system:log:files' }), async (c) => {
  const name = safeFilename(c.req.param('filename'));
  if (!name || name.endsWith('.gz')) {
    return c.json(errBody('压缩文件不支持实时追踪'), 400);
  }

  const filepath = resolveLogPath(name);
  if (!filepath || !fs.existsSync(filepath)) {
    return c.json(errBody('文件不存在', 404), 404);
  }

  return streamSSE(c, async (stream) => {
    // 先发送最后 100 行作为初始内容
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
