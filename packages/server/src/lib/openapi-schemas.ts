/**
 * 通用 OpenAPI / Zod schema 工具，供所有路由模块复用。
 *
 * 统一接口响应结构：{ code, message, data }
 *  - 成功：code = 0
 *  - 失败：code 为非零（400/401/403/404/500 等）
 *
 * 分页响应：{ list, total, page, pageSize }
 */
import { z, type Hook } from '@hono/zod-openapi';

/**
 * 统一验证失败 Hook：将 Zod 校验错误转为 { code: 400, message, data: null }
 * 在 new OpenAPIHono({ defaultHook: validationHook }) 中使用
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const validationHook: Hook<any, any, any, any> = (result, c) => {
  if (!result.success) {
    const first = result.error.issues?.[0];
    const field = first?.path?.join('.') ?? '';
    const msg = first?.message ?? '请求参数错误';
    const message = field ? `${field}: ${msg}` : msg;
    return c.json({ code: 400, message, data: null }, 400);
  }
};

/** 通用成功响应封装：code=0 + 任意 data */
export function apiResponse<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    code: z.literal(0),
    message: z.string(),
    data,
  });
}

/** 通用成功响应（data 为 null） */
export const MessageResponse = z.object({
  code: z.literal(0),
  message: z.string(),
  data: z.null().optional(),
});

/** 通用错误响应 */
export const ErrorResponse = z.object({
  code: z.number(),
  message: z.string(),
  data: z.null().optional().nullable(),
});

/** 分页响应 */
export function paginatedResponse<T extends z.ZodTypeAny>(item: T) {
  return apiResponse(
    z.object({
      list: z.array(item),
      total: z.number(),
      page: z.number(),
      pageSize: z.number(),
    }),
  );
}

/** 构造 application/json content */
export function jsonContent<T extends z.ZodTypeAny>(schema: T) {
  return { 'application/json': { schema } };
}

/** 常用分页入参 */
export const PaginationQuery = z.object({
  page: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .default(1)
    .openapi({
      param: { name: 'page', in: 'query' },
      example: 1,
      description: '页码（从 1 开始）',
    }),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(200)
    .optional()
    .default(10)
    .openapi({
      param: { name: 'pageSize', in: 'query' },
      example: 10,
      description: '每页数量，最大 200',
    }),
});

/** 常用错误响应集合（复制到 responses 里） */
export const commonErrorResponses = {
  400: { content: jsonContent(ErrorResponse), description: '请求参数错误' },
  401: { content: jsonContent(ErrorResponse), description: '未登录或 token 失效' },
  403: { content: jsonContent(ErrorResponse), description: '无权限' },
  404: { content: jsonContent(ErrorResponse), description: '资源不存在' },
  500: { content: jsonContent(ErrorResponse), description: '服务端错误' },
} as const;

/** id 参数 schema（path/query 通用） */
export const IdParam = z.object({
  id: z.coerce
    .number()
    .int()
    .positive()
    .openapi({
      param: { name: 'id', in: 'path' },
      example: 1,
      description: '主键 ID',
    }),
});

/** 成功响应常量：200 + ApiResponse<any> */
export function ok<T extends z.ZodTypeAny>(schema: T, description = '操作成功') {
  return {
    200: { content: jsonContent(apiResponse(schema)), description },
  };
}

/** 分页成功响应 */
export function okPaginated<T extends z.ZodTypeAny>(item: T, description = '列表数据') {
  return {
    200: { content: jsonContent(paginatedResponse(item)), description },
  };
}

/** 纯消息成功响应（data 为 null） */
export function okMsg(description = '操作成功') {
  return {
    200: { content: jsonContent(MessageResponse), description },
  };
}

/** 批量 ID 操作请求体（批量删除 / 批量更新等） */
export const BatchIdsBody = z.object({
  ids: z.array(z.number().int()),
}).openapi('BatchIdsBody');
