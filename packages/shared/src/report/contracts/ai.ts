import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { reportNl2SqlSchema } from '../validation';

// ─── AI 自然语言取数 ─────────────────────────────────────────────────────────

export const reportNl2SqlResultSchema = z.object({ sql: z.string() }).meta({ id: 'ReportNl2SqlResult' });

export type ReportNl2SqlResult = z.infer<typeof reportNl2SqlResultSchema>;

export const reportAiContract = defineContract('/api/report/ai', {
  nl2sql: op.post('/nl2sql', { body: reportNl2SqlSchema, response: reportNl2SqlResultSchema, summary: 'AI 自然语言取数（生成只读 SQL）' }),
}, { tags: ['报表 AI'] });
