import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { logLinesSchema, logTailQuery } from './log-lines';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const logFileSchema = z.object({
  name: z.string(),
  size: z.number(),
  modifiedAt: z.string(),
  isGzip: z.boolean(),
}).meta({ id: 'LogFile' });

export type LogFile = z.infer<typeof logFileSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const logFileNameParam = z.object({
  filename: z.string().meta({ description: '应用日志目录下的文件名', example: 'app.log' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const logFileContract = defineContract('/api/log-files', {
  list: op.get('/', { response: z.array(logFileSchema), summary: '日志文件列表' }),
  content: op.get('/{filename}/content', { params: logFileNameParam, query: logTailQuery, response: logLinesSchema, summary: '读取日志文件内容（最后 N 行）' }),
  remove: op.delete('/{filename}', { params: logFileNameParam, summary: '删除日志文件' }),
  download: op.get('/{filename}/download', { params: logFileNameParam, kind: 'file', summary: '下载日志文件' }),
  tail: op.get('/{filename}/tail', { params: logFileNameParam, kind: 'sse', response: z.string(), summary: '日志实时跟踪（SSE，event: log）' }),
}, { tags: ['LogFiles'] });
