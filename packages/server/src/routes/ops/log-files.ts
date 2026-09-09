import { OpenAPIHono } from '@hono/zod-openapi';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { logFileContract } from '@zenith/shared/ops';
import { authMiddleware } from '../../middleware/auth';
import { guard, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { streamLogTail } from '../../lib/http-stream';
import {
  listLogFiles, readLogFileLines, deleteLogFile, resolveLogFile, getLogFileBeforeAudit,
} from '../../services/ops/log-files.service';
import { TAIL_REPLAY_LINES, readTailLinesStream, watchTail } from '../../services/ops/log-reader';

const router = new OpenAPIHono({ defaultHook: validationHook });

const view = [authMiddleware, guard({ permission: 'system:log:files' })] as const;

const fileErrorResponses = {
  400: { content: jsonContent(ErrorResponse), description: '无效的文件名' },
  404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
} as const;

const listRoute = defineContractRoute(logFileContract.list, {
  middleware: view,
  handler: async (c) => c.json(okBody(await listLogFiles(), 'success'), 200),
});

const contentRoute = defineContractRoute(logFileContract.content, {
  middleware: view,
  responses: fileErrorResponses,
  handler: async (c) => {
    const { lines, keyword, context } = c.req.valid('query');
    const result = await readLogFileLines(c.req.valid('param').filename, lines ?? 500, { keyword, context });
    return c.json(okBody({ lines: result }, 'success'), 200);
  },
});

const deleteApiRoute = defineContractRoute(logFileContract.remove, {
  middleware: [authMiddleware, guard({
    permission: 'system:log:files:delete',
    audit: { description: '删除日志文件', module: '日志文件' },
  })],
  responses: fileErrorResponses,
  handler: async (c) => {
    const { filename } = c.req.valid('param');
    setAuditBeforeData(c, await getLogFileBeforeAudit(filename));
    await deleteLogFile(filename);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const downloadRoute = defineContractRoute(logFileContract.download, {
  middleware: [authMiddleware, guard({ permission: 'system:log:files:download' })],
  handler: async (c) => {
    const { name, filepath } = await resolveLogFile(c.req.valid('param').filename);
    const stat = await fsp.stat(filepath);
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
  },
});

// SSE 实时跟踪：先回放末尾 100 行，再按文件增长推送新增行
const tailRoute = defineContractRoute(logFileContract.tail, {
  middleware: view,
  handler: async (c) => {
    const rawName = c.req.valid('param').filename;
    if (rawName.endsWith('.gz')) return c.json(errBody('压缩文件不支持实时追踪'), 400);
    const { filepath } = await resolveLogFile(rawName);
    return streamLogTail(c, {
      replay: () => readTailLinesStream(filepath, TAIL_REPLAY_LINES),
      follow: async (signal, emit) => {
        const position = (await fsp.stat(filepath)).size;
        await watchTail(filepath, signal, position, (lines) => emit(lines));
      },
    });
  },
});

router.openapiRoutes([listRoute, contentRoute, deleteApiRoute, downloadRoute, tailRoute] as const);

export default router;
