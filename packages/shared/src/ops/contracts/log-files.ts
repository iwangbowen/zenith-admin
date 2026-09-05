import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const logFileSchema = z.object({
  name: z.string(),
  size: z.number(),
  modifiedAt: z.string(),
  isGzip: z.boolean(),
}).meta({ id: 'LogFile' });

export type LogFile = z.infer<typeof logFileSchema>;

export const logFileContentSchema = z.object({
  lines: z.array(z.string()),
}).meta({ id: 'LogFileContent' });

export type LogFileContent = z.infer<typeof logFileContentSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const logFileNameParam = z.object({
  filename: z.string().meta({ description: '应用日志目录下的文件名', example: 'app.log' }),
});

export const logFileContentQuery = z.object({
  lines: z.coerce.number().min(1).max(5000).default(500).optional(),
  keyword: z.string().max(200).optional(),
  context: z.coerce.number().min(0).max(10).default(0).optional().meta({ description: '全文过滤命中行前后保留的上下文行数' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const logFileContract = defineContract('/api/log-files', {
  list: op.get('/', { response: z.array(logFileSchema), summary: '日志文件列表' }),
  content: op.get('/{filename}/content', { params: logFileNameParam, query: logFileContentQuery, response: logFileContentSchema, summary: '读取日志文件内容（最后 N 行）' }),
  remove: op.delete('/{filename}', { params: logFileNameParam, summary: '删除日志文件' }),
  download: op.get('/{filename}/download', { params: logFileNameParam, kind: 'file', summary: '下载日志文件' }),
  tail: op.get('/{filename}/tail', { params: logFileNameParam, kind: 'sse', response: z.string(), summary: '日志实时跟踪（SSE，event: log）' }),
}, { tags: ['LogFiles'] });
