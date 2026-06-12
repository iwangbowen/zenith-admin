/**
 * 终端录屏 DTO
 */
import { z } from '@hono/zod-openapi';

/** 录屏事件：[timeOffset(秒), type, data] */
const RecordingEventItem = z.tuple([z.number(), z.enum(['o', 'i']), z.string()]);

export const TerminalRecordingDTO = z
  .object({
    id: z.number().int(),
    title: z.string(),
    userId: z.number().int(),
    username: z.string(),
    shell: z.string().nullable(),
    cols: z.number().int(),
    rows: z.number().int(),
    duration: z.number(),
    sizeBytes: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('TerminalRecording');

export const TerminalRecordingDetailDTO = TerminalRecordingDTO.extend({
  events: z.array(RecordingEventItem),
}).openapi('TerminalRecordingDetail');

/** 终端录屏统计（全局审计） */
export const TerminalRecordingStatsDTO = z
  .object({
    totalCount: z.number().int(),
    totalSizeBytes: z.number(),
    totalDuration: z.number(),
    avgDuration: z.number(),
    earliestAt: z.string().nullable(),
    latestAt: z.string().nullable(),
    byOperator: z.array(
      z.object({
        userId: z.number().int(),
        username: z.string(),
        count: z.number().int(),
        sizeBytes: z.number(),
      }),
    ),
    byShell: z.array(
      z.object({
        shell: z.string().nullable(),
        count: z.number().int(),
        sizeBytes: z.number(),
      }),
    ),
    trend: z.array(
      z.object({
        date: z.string(),
        count: z.number().int(),
        sizeBytes: z.number(),
      }),
    ),
    retainDays: z.number().int(),
    maxSizeMb: z.number().int(),
    remainingBytes: z.number(),
  })
  .openapi('TerminalRecordingStats');

/** 录屏清理结果 */
export const TerminalRecordingCleanupDTO = z
  .object({
    deletedByAge: z.number().int(),
    deletedBySize: z.number().int(),
    freedBytes: z.number(),
    remainingBytes: z.number(),
  })
  .openapi('TerminalRecordingCleanupResult');
