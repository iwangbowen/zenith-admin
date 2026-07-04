/**
 * 前端错误监控 DTO（Issue 模型）
 */
import { z } from '@hono/zod-openapi';

const errorTypeEnum = z.enum([
  'js_error', 'promise_rejection', 'resource_error', 'console_error', 'http_error', 'white_screen', 'crash',
]);
const levelEnum = z.enum(['fatal', 'error', 'warning', 'info']);
const statusEnum = z.enum(['unresolved', 'resolved', 'ignored', 'muted']);
const conditionEnum = z.enum(['new_error', 'threshold', 'spike']);
const deviceTypeEnum = z.enum(['desktop', 'mobile', 'tablet', 'bot', 'unknown']);

// ─── 上报 ─────────────────────────────────────────────────────────────────────
export const ErrorBreadcrumbDTO = z
  .object({
    type: z.enum(['navigation', 'click', 'http', 'console', 'custom']),
    message: z.string().max(512),
    level: levelEnum.optional(),
    data: z.record(z.string(), z.unknown()).optional(),
    timestamp: z.string().max(32),
  })
  .openapi('ErrorBreadcrumb');

export const ErrorReportInputDTO = z
  .object({
    errorType: errorTypeEnum,
    level: levelEnum.optional(),
    message: z.string().min(1).max(2000),
    stack: z.string().max(16_000).optional(),
    sourceUrl: z.string().max(512).optional(),
    lineNo: z.number().int().optional(),
    colNo: z.number().int().optional(),
    pageUrl: z.string().max(512).optional(),
    release: z.string().max(64).optional(),
    sessionId: z.string().max(36).optional(),
    breadcrumbs: z.array(ErrorBreadcrumbDTO).max(50).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
    httpStatus: z.number().int().optional(),
    httpMethod: z.string().max(16).optional(),
    httpUrl: z.string().max(512).optional(),
  })
  .openapi('ErrorReportInput');

// ─── 分组（Issue）────────────────────────────────────────────────────────────
export const ErrorGroupDTO = z
  .object({
    id: z.number().int(),
    fingerprint: z.string(),
    errorType: errorTypeEnum,
    level: levelEnum,
    message: z.string(),
    status: statusEnum,
    assigneeId: z.number().int().nullable(),
    assigneeName: z.string().nullable(),
    release: z.string().nullable(),
    note: z.string().nullable(),
    count: z.number().int(),
    affectedUsers: z.number().int(),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
    resolvedAt: z.string().nullable(),
    trend: z.array(z.number().int()).optional(),
  })
  .openapi('ErrorGroup');

// ─── 单次事件 ─────────────────────────────────────────────────────────────────
export const ErrorEventDTO = z
  .object({
    id: z.number().int(),
    groupId: z.number().int(),
    fingerprint: z.string(),
    errorType: errorTypeEnum,
    level: levelEnum,
    message: z.string(),
    stack: z.string().nullable(),
    sourceUrl: z.string().nullable(),
    lineNo: z.number().int().nullable(),
    colNo: z.number().int().nullable(),
    pageUrl: z.string().nullable(),
    release: z.string().nullable(),
    userAgent: z.string().nullable(),
    browser: z.string().nullable(),
    browserVersion: z.string().nullable(),
    os: z.string().nullable(),
    deviceType: deviceTypeEnum.nullable(),
    userId: z.number().int().nullable(),
    username: z.string().nullable(),
    sessionId: z.string().nullable(),
    breadcrumbs: z.array(z.record(z.string(), z.unknown())).nullable(),
    context: z.record(z.string(), z.unknown()).nullable(),
    httpStatus: z.number().int().nullable(),
    httpMethod: z.string().nullable(),
    httpUrl: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi('ErrorEvent');

export const ErrorGroupDetailDTO = z
  .object({
    group: ErrorGroupDTO,
    symbolicatedStack: z.string().nullable(),
    trend: z.array(z.object({ date: z.string(), count: z.number().int() })),
    browsers: z.array(z.object({ name: z.string(), value: z.number().int() })),
    os: z.array(z.object({ name: z.string(), value: z.number().int() })),
    recentEvents: z.array(ErrorEventDTO),
  })
  .openapi('ErrorGroupDetail');

// ─── 概览 ─────────────────────────────────────────────────────────────────────
export const ErrorOverviewDTO = z
  .object({
    totalGroups: z.number().int(),
    unresolved: z.number().int(),
    totalOccurrences: z.number().int(),
    affectedUsers: z.number().int(),
    newToday: z.number().int(),
    byType: z.array(z.object({ errorType: errorTypeEnum, groups: z.number().int(), occurrences: z.number().int() })),
    byLevel: z.array(z.object({ level: levelEnum, groups: z.number().int(), occurrences: z.number().int() })),
    trend: z.array(z.object({ date: z.string(), occurrences: z.number().int(), groups: z.number().int() })),
    topIssues: z.array(ErrorGroupDTO),
  })
  .openapi('ErrorOverview');

// ─── 处理（更新 Issue）────────────────────────────────────────────────────────
export const UpdateErrorGroupDTO = z
  .object({
    status: statusEnum.optional(),
    level: levelEnum.optional(),
    assigneeId: z.number().int().positive().nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .openapi('UpdateErrorGroup');

// ─── 告警规则 ─────────────────────────────────────────────────────────────────
export const ErrorAlertRuleDTO = z
  .object({
    id: z.number().int(),
    name: z.string(),
    errorType: errorTypeEnum.nullable(),
    level: levelEnum.nullable(),
    condition: conditionEnum,
    thresholdCount: z.number().int(),
    windowMinutes: z.number().int(),
    channels: z.array(z.string()),
    webhookUrl: z.string().nullable(),
    recipients: z.array(z.string()),
    enabled: z.boolean(),
    lastTriggeredAt: z.string().nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('ErrorAlertRule');

export const CreateErrorAlertRuleDTO = z
  .object({
    name: z.string().min(1).max(128),
    errorType: errorTypeEnum.nullable().optional(),
    level: levelEnum.nullable().optional(),
    condition: conditionEnum.default('threshold'),
    thresholdCount: z.number().int().min(1).max(100_000).default(10),
    windowMinutes: z.number().int().min(1).max(10_080).default(60),
    channels: z.array(z.enum(['email', 'webhook', 'inapp'])).default([]),
    webhookUrl: z.string().max(512).nullable().optional(),
    recipients: z.array(z.string().max(128)).default([]),
    enabled: z.boolean().default(true),
  })
  .openapi('CreateErrorAlertRule');
export const UpdateErrorAlertRuleDTO = CreateErrorAlertRuleDTO.partial().openapi('UpdateErrorAlertRule');

export const ErrorAlertLogDTO = z
  .object({
    id: z.number().int(),
    ruleId: z.number().int().nullable(),
    ruleName: z.string(),
    condition: conditionEnum,
    detail: z.string(),
    channels: z.array(z.string()),
    source: z.string(),
    createdAt: z.string(),
  })
  .openapi('ErrorAlertLog');

// ─── Source Map ──────────────────────────────────────────────────────────────
export const SourceMapItemDTO = z
  .object({
    id: z.number().int(),
    release: z.string(),
    fileName: z.string(),
    size: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi('SourceMapItem');

export const SourceMapUploadDTO = z
  .object({
    release: z.string().min(1).max(64),
    fileName: z.string().min(1).max(256),
    content: z.string().min(1).max(20_000_000, 'Source Map 超出 20MB 大小限制'),
  })
  .openapi('SourceMapUpload');
