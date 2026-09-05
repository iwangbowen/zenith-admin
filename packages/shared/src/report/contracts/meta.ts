import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

// ─── 可视化建模元数据（内置只读主库的表 / 列清单，敏感表 / 列已过滤） ─────────────

export const reportMetaColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
}).meta({ id: 'ReportMetaColumn' });

export type ReportMetaColumn = z.infer<typeof reportMetaColumnSchema>;

export const reportMetaTableParam = z.object({
  table: z.string().min(1).max(128).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, '非法表名').meta({ description: '表名', example: 'menus' }),
});

export const reportMetaContract = defineContract('/api/report/meta', {
  tables: op.get('/tables', { response: z.array(z.string()), summary: '可视化建模可用表清单（内置库）' }),
  columns: op.get('/tables/{table}/columns', { params: reportMetaTableParam, response: z.array(reportMetaColumnSchema), summary: '某表列清单（内置库）' }),
}, { tags: ['报表元数据'] });
