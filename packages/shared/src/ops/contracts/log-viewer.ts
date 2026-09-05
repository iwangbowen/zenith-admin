import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { hostQuery } from './ops-hosts';

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const logViewerPathQuery = hostQuery.extend({
  path: z.string().min(1).meta({ description: '日志文件绝对路径（须位于允许目录内）' }),
});

export const logViewerContentQuery = logViewerPathQuery.extend({
  lines: z.string().optional().meta({ description: '读取末尾行数，缺省 500，上限 5000' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const logViewerContract = defineContract('/api/log-viewer', {
  stream: op.get('/stream', { query: logViewerPathQuery, kind: 'file', summary: '日志实时跟踪（tail -f 逐行流式输出）' }),
  download: op.get('/download', { query: logViewerPathQuery, kind: 'file', summary: '下载日志文件' }),
  content: op.get('/content', { query: logViewerContentQuery, response: z.object({ content: z.string() }), summary: '读取日志文件末尾内容' }),
  roots: op.get('/roots', { query: hostQuery, response: z.object({ roots: z.array(z.string()) }), summary: '日志查看器允许读取的目录' }),
}, { tags: ['LogViewer'] });
