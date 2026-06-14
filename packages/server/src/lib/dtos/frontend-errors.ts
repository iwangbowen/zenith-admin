/**
 * 前端错误上报 DTO
 */
import { z } from '@hono/zod-openapi';

const frontendErrorTypeEnum = z.enum(['js_error', 'promise_rejection', 'resource_error', 'console_error']);

export const ErrorReportInputDTO = z
  .object({
    fingerprint: z.string().max(64),
    errorType: frontendErrorTypeEnum,
    message: z.string().max(2000),
    stack: z.string().max(8000).optional(),
    sourceUrl: z.string().max(512).optional(),
    lineNo: z.number().int().optional(),
    colNo: z.number().int().optional(),
    pageUrl: z.string().max(512).optional(),
    userAgent: z.string().max(512).optional(),
    sessionId: z.string().max(36).optional(),
  })
  .openapi('ErrorReportInput');

export const FrontendErrorDTO = z
  .object({
    id: z.number().int(),
    fingerprint: z.string(),
    errorType: frontendErrorTypeEnum,
    message: z.string(),
    stack: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    lineNo: z.number().int().nullable(),
    colNo: z.number().int().nullable(),
    pageUrl: z.string().nullable(),
    userAgent: z.string().nullable(),
    userId: z.number().int().nullable(),
    username: z.string().nullable(),
    sessionId: z.string().nullable(),
    count: z.number().int(),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
  })
  .openapi('FrontendError');

export const ErrorStatsDTO = z
  .object({
    totalDistinct: z.number().int(),
    totalOccurrences: z.number().int(),
    byType: z.array(
      z.object({
        errorType: frontendErrorTypeEnum,
        count: z.number().int(),
        occurrences: z.number().int(),
      }),
    ),
  })
  .openapi('ErrorStats');
