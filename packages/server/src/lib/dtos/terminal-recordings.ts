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
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('TerminalRecording');

export const TerminalRecordingDetailDTO = TerminalRecordingDTO.extend({
  events: z.array(RecordingEventItem),
}).openapi('TerminalRecordingDetail');
