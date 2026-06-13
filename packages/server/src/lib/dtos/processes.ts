/**
 * 进程管理相关 DTO
 */
import { z } from '@hono/zod-openapi';

export const ProcessInfoDTO = z
  .object({
    pid: z.number().int(),
    ppid: z.number().int(),
    name: z.string(),
    status: z.string(),
    cpu: z.number(),
    memory: z.number().int(),
    memoryPercent: z.number(),
    startTime: z.string().nullable(),
    command: z.string(),
    user: z.string(),
    threads: z.number().int(),
    nice: z.number().int().nullable(),
    priorityClass: z.string().nullable(),
  })
  .openapi('ProcessInfo');

export const ProcessListResponseDTO = z
  .object({
    platform: z.string(),
    processes: z.array(ProcessInfoDTO),
    total: z.number().int(),
    timestamp: z.string(),
  })
  .openapi('ProcessListResponse');
