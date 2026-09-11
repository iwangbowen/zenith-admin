import * as z from 'zod';

/**
 * 工作流域各契约共用的积木。
 */

/**
 * 外呼 HTTP 执行留痕（请求 / 响应 / 错误 / 耗时），作业执行记录与触发器节点执行记录共用；
 * 展开到实体 schema 中：`{ ...workflowOutboundTraceFields }`。
 */
export const workflowOutboundTraceFields = {
  requestUrl: z.string().nullable(),
  requestMethod: z.string().nullable(),
  requestBody: z.string().nullable(),
  responseStatus: z.int().nullable(),
  responseBody: z.string().nullable(),
  errorMessage: z.string().nullable(),
  durationMs: z.int().nullable(),
};
