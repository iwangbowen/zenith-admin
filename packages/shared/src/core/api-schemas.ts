import * as z from 'zod';
import { USER_STATUSES } from './constants';
import { filterMeta, type FilterMetaOption } from './filter-meta';

/**
 * 契约层通用 schema 积木：路径 / 分页 / 状态 / 审计列 / 响应信封。
 *
 * OpenAPI 元数据一律用 zod 原生 `.meta()`：`id` 为组件名（`#/components/schemas/{id}`），
 * `description` / `example` 直接进入文档；server 端不对 shared schema 施加任何补丁。
 * 列表查询积木同时写入 `x-filter` 语义（见 `filter-meta.ts`），前端筛选控件由此派生。
 */

// ─── 通用状态 ────────────────────────────────────────────────────────────────

/** 通用启用 / 禁用状态（请求体 / 实体字段）；列表 query 的状态筛选用下方 `entityStatusQuery` */
export const entityStatusSchema = z.enum(USER_STATUSES);

// ─── 路径 / 查询参数 ─────────────────────────────────────────────────────────

/** `{id}` 路径参数：正整数主键 */
export const idParam = z.object({
  id: z.coerce.number().int().positive().meta({ description: '主键 ID', example: 1 }),
});

/**
 * 查询串里的可选关联 ID 筛选（`?channelId=3`）：正整数，缺省不过滤。
 * 与路径参数 `idParam` 对称；列表查询里的 `xxxId` 一律用它，不再逐个写 `z.coerce.number().int().positive().optional()`。
 */
/**
 * 查询串里的可选关联 ID 筛选（`?channelId=3`）：正整数，缺省不过滤。
 * 与路径参数 `idParam` 对称；列表查询里的 `xxxId` 一律用它，不再逐个写 `z.coerce.number().int().positive().optional()`。
 */
export function idQuery(description?: string) {
  return z.coerce.number().int().positive().optional().meta({ ...(description ? { description } : {}), ...filterMeta({ kind: 'id' }) });
}

/** 必填的关联 ID 切分维度（CMS 各资源按 `siteId` 切分、预授权按 `applicationId`）：不带 `.optional()`，前端以选择器 override 呈现 */
export function requiredIdQuery(description?: string) {
  return z.coerce.number().int().positive().meta({ ...(description ? { description } : {}), ...filterMeta({ kind: 'id' }) });
}

export interface KeywordQueryOptions {
  /** 覆盖自动生成的 OpenAPI 描述（匹配规则有额外说明时，如「纯数字额外按 ID 精确匹配」） */
  readonly description?: string;
  /** 长度上限（日志 / 检索类接口防超长串） */
  readonly max?: number;
}

/**
 * 列表查询的关键字模糊匹配参数（`?keyword=…`）：可选字符串，缺省不过滤。
 * `fields` 写人可读的匹配字段（「名称 / 编码」）：OpenAPI 描述生成「按名称 / 编码模糊匹配」，
 * 前端筛选控件的占位生成「搜索名称 / 编码」——匹配哪些字段只在契约里说一次。
 * 服务端配合 `keywordCondition(q.keyword, [cols])`（trim / 判空 / 转义都在那里）；长度上限用 `{ max }`。
 */
export function keywordQuery(fields?: string, options: KeywordQueryOptions = {}) {
  const description = options.description ?? (fields ? `按${fields}模糊匹配` : '关键字模糊匹配');
  const base = options.max ? z.string().max(options.max) : z.string();
  return base.optional().meta({ description, ...filterMeta({ kind: 'keyword', ...(fields ? { fields } : {}) }) });
}

/**
 * 取值来自运行时字典的筛选参数（`?type=notice`，字典 `announcement_type`）：开放字符串，
 * 标签与可选项由前端 `useDictItems(dict)` 提供，OpenAPI 只标注字典编码。
 */
export function dictQuery(dict: string, description?: string) {
  return z.string().optional().meta({
    description: description ?? `按字典 ${dict} 取值筛选`,
    ...filterMeta({ kind: 'enum', values: [], dict }),
  });
}

/** 分页查询参数；列表接口用 `paginationQuery.extend({ ... })` 追加筛选字段 */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1).meta({ description: '页码（从 1 开始）', example: 1 }),
  pageSize: z.coerce.number().int().min(1).max(200).default(10).meta({ description: '每页数量，最大 200', example: 10 }),
});

/** 契约解析后的分页参数（page / pageSize 已补默认值并限界），作为服务层列表函数的入参类型 */
export type PaginationQuery = z.infer<typeof paginationQuery>;

/**
 * 时间范围端点参数（`startTime` / `endTime` 等）。
 * 同时接受 `YYYY-MM-DD` 与 `YYYY-MM-DD HH:mm:ss`，非法输入直接 400 而不是被当成「无筛选」。
 * 服务端配合 `dateRangeConditions()` 解析：纯日期起点取 00:00:00、终点取 23:59:59.999。
 */
export function dateRangeBound(description: string, bound: 'start' | 'end' = 'start') {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/, '时间格式必须为 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss')
    .optional()
    .meta({ description, example: '2026-08-01 00:00:00', ...filterMeta({ kind: 'date-bound', bound }) });
}

/**
 * 列表查询的标准时间范围端点 `startTime` / `endTime`，展开进 `paginationQuery.extend({ ..., ...dateRangeQuery('创建时间') })`。
 * `subject` 写明作用的时间字段（描述生成「创建时间起 / 创建时间止」），缺省为通用「起始时间 / 结束时间」；
 * 非标准键名（`startAt` / `dateStart` / `publishedFrom`…）仍逐个写 `dateRangeBound(desc, 'start' | 'end')`。
 * 服务端配合 `dateRangeConditions(column, q.startTime, q.endTime)`，前端配合 `formatDateTimeRangeForApi(range)`。
 */
export function dateRangeQuery(subject?: string) {
  return {
    startTime: dateRangeBound(subject ? `${subject}起` : '起始时间', 'start'),
    endTime: dateRangeBound(subject ? `${subject}止` : '结束时间', 'end'),
  };
}

export interface QueryBoolOptions {
  /** 自定义是 / 否文案，依次对应 true / false：`['已启用', '已禁用']`、`['已注册', '待注册']` */
  readonly labels?: readonly [trueLabel: string, falseLabel: string];
}

/**
 * 查询串布尔参数（`?enabled=true` / `?enabled=false`）。
 * 禁止 `z.coerce.boolean()`——它把字符串 `'false'` 转成 `true`。
 * `'true' | '1' | 'yes' | 'on'` → true；`'false' | '0' | 'no' | 'off'` → false；空串视为未传；其余 400。
 * 前端筛选控件缺省「是 / 否」，业务文案（启用 / 禁用、已注册 / 待注册）用 `{ labels }` 声明在契约里。
 */
export function queryBool(description?: string, options: QueryBoolOptions = {}) {
  return z
    .union([z.literal('').transform(() => undefined), z.stringbool()])
    .optional()
    .meta({ type: 'boolean', ...(description ? { description } : {}), ...filterMeta({ kind: 'bool', ...(options.labels ? { labels: options.labels } : {}) }) });
}

export interface QueryEnumOptions {
  readonly description?: string;
  /** 标签来自运行时字典（`useDictItems(dict)`），如 `common_status` */
  readonly dict?: string;
  /** 静态标签（shared 常量导出的 `XXX_OPTIONS`）；与 `dict` 二选一 */
  readonly options?: readonly FilterMetaOption[];
}

/**
 * 查询串枚举筛选参数（`?status=enabled`）。
 * 空串（筛选控件的「全部」项）视为未传，解析后的值不含空串，handler 无需再 `|| undefined`；
 * 不在取值集合内的输入 400。
 * 第二个参数传描述字符串，或 `{ description, dict | options }` 同时声明标签来源（前端筛选下拉据此取标签）。
 */
export function queryEnum<const T extends readonly string[]>(values: T, options?: string | QueryEnumOptions) {
  const opts: QueryEnumOptions = typeof options === 'string' ? { description: options } : (options ?? {});
  return z
    .union([z.literal('').transform(() => undefined), z.enum(values)])
    .optional()
    .meta({
      type: 'string',
      enum: [...values],
      ...(opts.description ? { description: opts.description } : {}),
      ...filterMeta({ kind: 'enum', values: [...values], ...(opts.dict ? { dict: opts.dict } : {}), ...(opts.options ? { options: opts.options } : {}) }),
    });
}

/**
 * 通用启用 / 禁用状态的查询串筛选（`?status=enabled`）；空串 = 全部，标签取 `common_status` 字典。
 * 与请求体里的 `entityStatusSchema` 对应：列表 query 一律用本积木，**不要**写 `entityStatusSchema.optional()`
 * （后者对筛选控件清空后发出的 `?status=` 返回 400）。
 */
export const entityStatusQuery = queryEnum(USER_STATUSES, { description: '状态；空 = 全部', dict: 'common_status' });

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

/** Independent probes retain useful sections when another source is unavailable. */
export function sectionOf<T extends z.ZodType>(data: T) {
  return z.object({ available: z.boolean(), reason: z.string().nullable(), data: data.nullable() });
}

export type ProbeSection<T> = { available: boolean; reason: string | null; data: T | null };
