import { OpenAPIHono, z } from '@hono/zod-openapi';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { logFileContract, logLocatorContract } from '@zenith/shared/ops';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, apiResponse, errBody, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import { streamLogTail } from '../../lib/http-stream';
import {
  listLogFiles, readLogFileLines, deleteLogFile, resolveLogFile, getLogFileBeforeAudit,
  batchDeleteLogFiles, getLogFilesBeforeAudit,
} from '../../services/ops/log-files.service';
import { locateCorrelationLogs } from '../../services/ops/log-locator.service';
import { batchDownloadLogFiles } from '../../services/ops/log-files-download.service';
import { TAIL_REPLAY_LINES, readTailLinesStream, watchTail } from '../../services/ops/log-reader';
import { attachmentDisposition } from '../../lib/content-disposition';
import { orderRoutes } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const fileErrorResponses = {
  400: { content: jsonContent(ErrorResponse), description: '无效的文件名' },
  404: { content: jsonContent(ErrorResponse), description: '文件不存在' },
} as const;

const listRoute = defineContractRoute(logFileContract.list, {
  handler: async (c) => c.json(okBody(await listLogFiles(), 'success'), 200),
});

const locateRoute = defineContractRoute(logLocatorContract.locate, {
  handler: async (c) => c.json(okBody(await locateCorrelationLogs(c.req.valid('query')), 'success'), 200),
});

const contentRoute = defineContractRoute(logFileContract.content, {
  responses: fileErrorResponses,
  handler: async (c) => {
    const { lines, keyword, correlationId, locateCorrelationId, context } = c.req.valid('query');
    const result = await readLogFileLines(c.req.valid('param').filename, lines ?? 500, { keyword, correlationId, locateCorrelationId, context });
    return c.json(okBody({ lines: result }, 'success'), 200);
  },
});

const deleteApiRoute = defineContractRoute(logFileContract.remove, {
  responses: fileErrorResponses,
  handler: async (c) => {
    const { filename } = c.req.valid('param');
    setAuditBeforeData(c, await getLogFileBeforeAudit(filename));
    await deleteLogFile(filename);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// 批量删除：一次请求删掉面板里勾选的多个文件，日志轮转导致的「文件已不在」按跳过处理
const batchDeleteRoute = defineContractRoute(logFileContract.removeBatch, {
  responses: fileErrorResponses,
  handler: async (c) => {
    const { filenames } = c.req.valid('json');
    const before = await getLogFilesBeforeAudit(filenames);
    if (before.length > 0) setAuditBeforeData(c, before);
    const deleted = await batchDeleteLogFiles(filenames);
    return c.json(okBody({ deleted }, `已删除 ${deleted} 个日志文件`), 200);
  },
});

// 批量下载：小批量直接返回 zip 流（点完即下）；超过阈值以 JSON 信封返回任务信息，完成后通知下载
const batchDownloadRoute = defineContractRoute(logFileContract.batchDownload, {
  responses: {
    200: {
      content: {
        'application/json': { schema: apiResponse(logFileContract.batchDownload.response) },
        'application/zip': { schema: z.string().openapi({ format: 'binary' }) },
      },
      description: '同步打包返回 zip 流；超过阈值返回任务信息',
    },
  },
  handler: async (c) => {
    const result = await batchDownloadLogFiles(c.req.valid('json').filenames);
    if (result.mode === 'task') return c.json(okBody(result.result, '文件较多，已转为后台打包，完成后通知'), 200);
    return new Response(result.stream, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': attachmentDisposition(result.filename),
        'Cache-Control': 'private, no-store',
      },
    });
  },
});

const downloadRoute = defineContractRoute(logFileContract.download, {
  handler: async (c) => {
    const { name, filepath } = await resolveLogFile(c.req.valid('param').filename);
    const stat = await fsp.stat(filepath);
    const stream = fs.createReadStream(filepath);
    const { Readable } = await import('node:stream');
    const webStream = Readable.toWeb(stream) as ReadableStream;
    return new Response(webStream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': attachmentDisposition(name),
        'Content-Length': String(stat.size),
      },
    });
  },
});

// SSE 实时跟踪：先回放末尾 100 行，再按文件增长推送新增行
const tailRoute = defineContractRoute(logFileContract.tail, {
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

// orderRoutes：静态段先于参数段注册，`DELETE /batch` 不会被 `DELETE /{filename}` 抢先匹配
router.openapiRoutes(orderRoutes([listRoute, locateRoute, contentRoute, deleteApiRoute, batchDeleteRoute, batchDownloadRoute, downloadRoute, tailRoute]));

export default router;
