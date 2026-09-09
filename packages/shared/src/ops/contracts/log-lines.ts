import * as z from 'zod';

/**
 * 日志行读取的公共契约积木：「日志文件」（应用日志目录）与「日志查看器」（白名单目录 / 远端主机）
 * 两套接口共用同一份入参与响应形状，前端才能用同一个查看器组件消费。
 */

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const logLinesSchema = z.object({
  lines: z.array(z.string()),
}).meta({ id: 'LogLines' });

export type LogLines = z.infer<typeof logLinesSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

/** 读取末尾 N 行：可选服务端关键词过滤（大小写不敏感的子串匹配）与命中行上下文 */
export const logTailQuery = z.object({
  lines: z.coerce.number().min(1).max(5000).default(500).optional().meta({ description: '读取末尾行数，缺省 500，上限 5000' }),
  keyword: z.string().max(200).optional().meta({ description: '全文过滤关键词（整个文件范围内匹配，再取末尾 N 行）' }),
  context: z.coerce.number().min(0).max(10).default(0).optional().meta({ description: '全文过滤命中行前后保留的上下文行数' }),
});

export type LogTailQuery = z.infer<typeof logTailQuery>;
