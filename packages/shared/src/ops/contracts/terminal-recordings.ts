import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createTerminalRecordingSchema, terminalRecordingEventSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

export const terminalRecordingSchema = z.object({
  id: z.int(),
  title: z.string(),
  userId: z.int(),
  username: z.string(),
  shell: z.string().nullable(),
  cols: z.int(),
  rows: z.int(),
  duration: z.number().meta({ description: '录屏时长（秒）' }),
  sizeBytes: z.int().meta({ description: 'events JSON 字节数' }),
  commandCount: z.int().meta({ description: '近似命令数（含回车的输入事件条数）' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'TerminalRecording' });

export type TerminalRecording = z.infer<typeof terminalRecordingSchema>;

export const terminalRecordingDetailSchema = terminalRecordingSchema.extend({
  events: z.array(terminalRecordingEventSchema),
}).meta({ id: 'TerminalRecordingDetail' });

export type TerminalRecordingDetail = z.infer<typeof terminalRecordingDetailSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const terminalRecordingListQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  operatorUserId: z.coerce.number().int().positive().optional(),
  startTime: dateRangeBound('起始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const terminalRecordingCleanQuery = z.object({
  days: z.coerce.number().int().min(1).max(3650).default(180).meta({ description: '清除多少天之前的录屏' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const terminalRecordingContract = defineContract('/api/terminal-recordings', {
  list: op.get('/', { query: terminalRecordingListQuery, response: paginated(terminalRecordingSchema), summary: '我的录屏列表' }),
  create: op.post('/', { body: createTerminalRecordingSchema, response: terminalRecordingSchema, summary: '保存录屏' }),
  clean: op.delete('/clean', { query: terminalRecordingCleanQuery, summary: '清除录屏记录' }),
  asciinema: op.get('/{id}/asciinema', { params: idParam, kind: 'file', summary: '导出 asciinema 录屏' }),
  detail: op.get('/{id}', { params: idParam, response: terminalRecordingDetailSchema, summary: '获取录屏详情（含 events）' }),
  remove: op.delete('/{id}', { params: idParam, summary: '删除录屏' }),
}, { tags: ['TerminalRecordings'] });
