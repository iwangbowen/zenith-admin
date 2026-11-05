import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import {
  CONSOLE_LOG_ROLES,
  LOG_CORRELATION_LOCATOR_MAX_CONTEXT_LINES,
  LOG_CORRELATION_LOCATOR_MAX_MATCHES,
} from '../constants';

export const logLocatorStatusSchema = z.enum(['matched', 'not_found', 'source_unavailable', 'source_error']);
export type LogLocatorStatus = z.infer<typeof logLocatorStatusSchema>;

export const logLocatorMatchSchema = z.object({
  role: z.enum(CONSOLE_LOG_ROLES),
  hostname: z.string(),
  pid: z.number().int().nullable(),
  filename: z.string(),
  date: z.string(),
  sequence: z.number().int().positive(),
  isGzip: z.boolean(),
  matchedField: z.literal('correlationId'),
  matchCount: z.number().int().positive(),
  context: z.array(z.string()).max(LOG_CORRELATION_LOCATOR_MAX_CONTEXT_LINES * 2 + 1),
}).meta({ id: 'LogLocatorMatch' });

export type LogLocatorMatch = z.infer<typeof logLocatorMatchSchema>;

export const logLocatorSourceSchema = z.object({
  role: z.enum(CONSOLE_LOG_ROLES),
  hostname: z.string().nullable(),
  status: z.enum(['scanned', 'unavailable', 'error']),
  scannedFiles: z.number().int().nonnegative(),
  scannedBytes: z.number().int().nonnegative(),
  error: z.string().nullable(),
}).meta({ id: 'LogLocatorSource' });

export type LogLocatorSource = z.infer<typeof logLocatorSourceSchema>;

export const logLocatorResultSchema = z.object({
  correlationId: z.string().min(8).max(64),
  status: logLocatorStatusSchema,
  matches: z.array(logLocatorMatchSchema).max(LOG_CORRELATION_LOCATOR_MAX_MATCHES),
  sources: z.array(logLocatorSourceSchema),
  scannedFiles: z.number().int().nonnegative(),
  scannedBytes: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).meta({ id: 'LogLocatorResult' });

export type LogLocatorResult = z.infer<typeof logLocatorResultSchema>;

export const logLocatorQuery = z.object({
  correlationId: z.string().min(8).max(64),
  context: z.coerce.number().int().min(0).max(LOG_CORRELATION_LOCATOR_MAX_CONTEXT_LINES).default(2).optional(),
});

export const logLocatorContract = defineContract('/api/log-files', {
  locate: op.get('/locate', {
    access: { permission: 'system:log:files' },
    query: logLocatorQuery,
    response: logLocatorResultSchema,
    summary: '跨日志轮转文件定位业务关联 ID',
    description: '扫描当前进程可见的 API、Worker 与全量角色日志文件；日期仅用于扫描排序，不作为唯一文件选择条件。',
  }),
}, { tags: ['LogFiles'] });
