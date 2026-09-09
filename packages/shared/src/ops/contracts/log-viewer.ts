import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { logLinesSchema, logTailQuery } from './log-lines';
import { hostQuery } from './ops-hosts';

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const logViewerPathQuery = hostQuery.extend({
  path: z.string().min(1).meta({ description: '日志文件绝对路径（须位于允许目录内）' }),
});

export const logViewerContentQuery = logViewerPathQuery.extend(logTailQuery.shape);

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const logViewerContract = defineContract('/api/log-viewer', {
  tail: op.get('/tail', { query: logViewerPathQuery, kind: 'sse', response: z.string(), summary: '日志实时跟踪（SSE，event: log）' }),
  download: op.get('/download', { query: logViewerPathQuery, kind: 'file', summary: '下载日志文件' }),
  content: op.get('/content', { query: logViewerContentQuery, response: logLinesSchema, summary: '读取日志文件末尾内容（最后 N 行）' }),
  roots: op.get('/roots', { query: hostQuery, response: z.object({ roots: z.array(z.string()) }), summary: '日志查看器允许读取的目录' }),
}, { tags: ['LogViewer'] });
