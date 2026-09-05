import * as z from 'zod';
import { USER_STATUSES } from './constants';

/**
 * 契约层通用 schema 积木：路径 / 分页 / 状态 / 审计列 / 响应信封。
 *
 * OpenAPI 元数据一律用 zod 原生 `.meta()`：`id` 为组件名（`#/components/schemas/{id}`），
 * `description` / `example` 直接进入文档；server 端不对 shared schema 施加任何补丁。
 */

// ─── 通用状态 ────────────────────────────────────────────────────────────────

/** 通用启用 / 禁用状态 */
export const entityStatusSchema = z.enum(USER_STATUSES);

// ─── 路径 / 查询参数 ─────────────────────────────────────────────────────────

/** `{id}` 路径参数：正整数主键 */
export const idParam = z.object({
  id: z.coerce.number().int().positive().meta({ description: '主键 ID', example: 1 }),
});

/** 分页查询参数；列表接口用 `paginationQuery.extend({ ... })` 追加筛选字段 */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1).meta({ description: '页码（从 1 开始）', example: 1 }),
  pageSize: z.coerce.number().int().min(1).max(200).default(10).meta({ description: '每页数量，最大 200', example: 10 }),
});

/**
 * 时间范围端点参数（`startTime` / `endTime` 等）。
 * 同时接受 `YYYY-MM-DD` 与 `YYYY-MM-DD HH:mm:ss`，非法输入直接 400 而不是被当成「无筛选」。
 * 服务端配合 `dateRangeConditions()` 解析：纯日期起点取 00:00:00、终点取 23:59:59.999。
 */
export function dateRangeBound(description: string) {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/, '时间格式必须为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss')
    .optional()
    .meta({ description, example: '2026-08-01 00:00:00' });
}

/**
 * 查询串布尔参数（`?enabled=true` / `?enabled=false`）。
 * 禁止 `z.coerce.boolean()`——它把字符串 `'false'` 转成 `true`。
 * `'true' | '1' | 'yes' | 'on'` → true；`'false' | '0' | 'no' | 'off'` → false；空串视为未传；其余 400。
 */
export function queryBool(description?: string) {
  return z
    .union([z.literal('').transform(() => undefined), z.stringbool()])
    .optional()
    .meta({ type: 'boolean', ...(description ? { description } : {}) });
}

/**
 * 查询串枚举筛选参数（`?status=enabled`）。
 * 空串（筛选控件的「全部」项）视为未传，解析后的值不含空串，handler 无需再 `|| undefined`；
 * 不在取值集合内的输入 400。
 */
export function queryEnum<const T extends readonly string[]>(values: T, description?: string) {
  return z
    .union([z.literal('').transform(() => undefined), z.enum(values)])
    .optional()
    .meta({ type: 'string', enum: [...values], ...(description ? { description } : {}) });
}

// ─── 请求体积木 ──────────────────────────────────────────────────────────────

/** 批量 ID 操作请求体（批量删除 / 批量更新） */
export const batchIdsBody = z.object({ ids: z.array(z.int()) }).meta({ id: 'BatchIdsBody' });

// ─── 响应积木 ────────────────────────────────────────────────────────────────

/** 审计列：`createdBy` / `updatedBy` 由服务端 Proxy 自动写入，展开进实体 schema */
export const auditFieldsSchema = {
  createdBy: z.int().nullable().optional(),
  updatedBy: z.int().nullable().optional(),
};

/** 分页载荷 `{ list, total, page, pageSize }` */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    list: z.array(item),
    total: z.int(),
    page: z.int(),
    pageSize: z.int(),
  });
}

/** 统一响应信封 `{ code: 0, message, data }` */
export function apiEnvelope<T extends z.ZodType>(data: T) {
  return z.object({
    code: z.literal(0),
    message: z.string(),
    data,
  });
}

/** 统一错误信封 */
export const apiErrorEnvelope = z.object({
  code: z.number(),
  message: z.string(),
  data: z.null().optional().nullable(),
});
