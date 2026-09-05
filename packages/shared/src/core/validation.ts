import * as z from 'zod';
import { DATE_TIME_PATTERN } from './constants';
import { jsonByteLength, jsonDepth } from './json-shape';
import { isHttpUrl, isSafeLinkUrl } from './url';

// ─── URL 字段 ─────────────────────────────────────────────────────────────────
/**
 * 绝对 http(s) URL。`z.url()` 会放过 `javascript:` / `file:` / `data:`，
 * 所有会被渲染为链接、图片、iframe 或交给系统打开 / 服务端外呼的 URL 字段统一用这个。
 */
export function httpUrl(message = 'URL 格式不正确，仅支持 http(s) 地址') {
  return z.url({ protocol: /^https?$/, error: message });
}

/** 绝对 http(s) URL 或站内根相对路径（如托管文件内容地址）；用于 href / src 类字段 */
export function linkUrl(message = '地址仅支持 http(s) URL 或站内路径') {
  return z.string().refine(isSafeLinkUrl, message);
}

/** 允许为空字符串的 linkUrl（表单可清空的可选地址） */
export function optionalLinkUrl(message = '地址仅支持 http(s) URL 或站内路径') {
  return z.string().refine((value) => value === '' || isSafeLinkUrl(value), message);
}

/** 允许为空字符串的 httpUrl */
export function optionalHttpUrl(message = 'URL 格式不正确，仅支持 http(s) 地址') {
  return z.string().refine((value) => value === '' || isHttpUrl(value), message);
}

/**
 * 自引用递归 schema 的 lazy 包装：**内部实例必须缓存**。
 *
 * `z.lazy(() => z.object({...}))` 每次取值都会新建一个 schema 实例，
 * OpenAPI 生成器只能靠实例标识判断环路，拿到的永远是新对象 → 无限展开 →
 * `/api/openapi.json` 栈溢出返回 500（整个 Swagger 文档不可用）。
 * 缓存后自引用命中同一实例，生成器改为输出 `$ref`，递归即终止。
 */
export function lazyRecursive<T extends z.ZodType>(build: () => T) {
  let cached: T | undefined;
  return z.lazy(() => (cached ??= build()));
}


/**
 * 剥离 `.default()` / `.prefault()` 后的字段类型。
 * 穿透 optional / nullable / readonly / pipe 包装并原样保留，只移除默认值层。
 */
type StripDefault<T> =
  T extends z.ZodDefault<infer Inner> ? StripDefault<Inner>
    : T extends z.ZodPrefault<infer Inner> ? StripDefault<Inner>
      : T extends z.ZodOptional<infer Inner> ? z.ZodOptional<StripDefault<Inner>>
        : T extends z.ZodNullable<infer Inner> ? z.ZodNullable<StripDefault<Inner>>
          : T extends z.ZodReadonly<infer Inner> ? z.ZodReadonly<StripDefault<Inner>>
            : T extends z.ZodPipe<infer In, infer Out> ? z.ZodPipe<StripDefault<In>, Out>
              : T;

/** 递归移除字段上任意层级的默认值包装，其余包装（optional / nullable / readonly / pipe）原样重建 */
function stripDefaults(field: z.ZodType): z.ZodType {
  // def 上的内层 schema 以 zod/core 的 $ZodType 声明，运行时即 classic ZodType 实例
  const inner = (schema: z.ZodType) => (schema.def as unknown as { innerType: z.ZodType }).innerType;
  if (field instanceof z.ZodDefault || field instanceof z.ZodPrefault) return stripDefaults(inner(field));
  if (field instanceof z.ZodOptional) return z.optional(stripDefaults(inner(field)));
  if (field instanceof z.ZodNullable) return z.nullable(stripDefaults(inner(field)));
  if (field instanceof z.ZodReadonly) return z.readonly(stripDefaults(inner(field)));
  if (field instanceof z.ZodPipe) {
    const { in: input, out } = field.def as unknown as { in: z.ZodType; out: z.ZodType };
    return z.pipe(stripDefaults(input), out);
  }
  return field;
}

/**
 * 深度剥离默认值：在 `stripDefaults` 的基础上继续递归进入 `z.object` 的每个字段与 `z.array` 的元素，
 * 得到「字段全部必填、任何层级都没有 `.default()` / `.prefault()`」的 schema。
 *
 * 用途：以「带默认值的读取 schema」为唯一真相、派生整体替换端点（PUT）的请求体——
 * 客户端必须回传完整文档，省略字段应得到 400，而不是被静默填入默认值
 * （契约层校验见 `app.contract.test.ts`：PUT / PATCH 请求体属性不得携带 `default`）。
 * `strictObjects: true` 时所有层级的对象改为 `z.strictObject`，未知键同样得到 400。
 *
 * 各层的 `.meta()` 说明（title / description / example）随派生结果保留，但 **`id` 不复制**：
 * zod 的全局注册表要求 `id` 唯一，派生出的新实例若沿用同一 `id` 会在注册时抛错；
 * 调用方按需给派生结果另起 `id`。对象 / 数组自身的校验（`.max()` 等）原样保留。
 * 派生结果不含默认值，输入类型与输出类型一致。
 */
export function stripDefaultsDeep<T extends z.ZodType>(
  schema: T,
  options: { strictObjects?: boolean } = {},
): z.ZodType<z.output<T>, z.output<T>> {
  const inner = (field: z.ZodType) => (field.def as unknown as { innerType: z.ZodType }).innerType;
  const checksOf = (field: z.ZodType) => ((field.def as { checks?: unknown[] }).checks ?? []) as never[];
  const withMeta = (field: z.ZodType, next: z.ZodType): z.ZodType => {
    const { id: _id, ...rest } = field.meta() ?? {};
    return Object.keys(rest).length > 0 ? next.meta(rest) : next;
  };
  const walk = (field: z.ZodType): z.ZodType => {
    if (field instanceof z.ZodDefault || field instanceof z.ZodPrefault) return withMeta(field, walk(inner(field)));
    if (field instanceof z.ZodOptional) return withMeta(field, z.optional(walk(inner(field))));
    if (field instanceof z.ZodNullable) return withMeta(field, z.nullable(walk(inner(field))));
    if (field instanceof z.ZodReadonly) return withMeta(field, z.readonly(walk(inner(field))));
    if (field instanceof z.ZodPipe) {
      const { in: input, out } = field.def as unknown as { in: z.ZodType; out: z.ZodType };
      return withMeta(field, z.pipe(walk(input), out));
    }
    if (field instanceof z.ZodArray) {
      const element = (field.def as unknown as { element: z.ZodType }).element;
      return withMeta(field, z.array(walk(element)).check(...checksOf(field)));
    }
    if (field instanceof z.ZodObject) {
      const shape = field.shape as Record<string, z.ZodType>;
      const next: Record<string, z.ZodType> = {};
      for (const key of Object.keys(shape)) next[key] = walk(shape[key]);
      const rebuilt = options.strictObjects ? z.strictObject(next) : z.object(next);
      return withMeta(field, rebuilt.check(...checksOf(field)));
    }
    return field;
  };
  return walk(schema) as z.ZodType<z.output<T>, z.output<T>>;
}

/**
 * 由 create schema 派生「部分更新」schema：先剥离全部 `.default()`，再 `.partial()`。
 *
 * 部分更新的契约是「未提交的字段保持不变」。Zod 的 `.partial()` 会保留 `.default()`
 * （`ZodOptional` 遇到能接受 undefined 的内层会直接委托），字段省略时仍会填入默认值，
 * 服务层 `.set({ ...data })` 随即把这些从未提交的字段写回库。因此所有 update schema
 * 一律经本函数派生，禁止直接调用 `.partial()`（ESLint 已封禁）。
 *
 * 默认值只属于创建语义；嵌套在 optional / nullable / pipe 内的默认值同样会被剥离。
 * 契约层校验见 `app.contract.test.ts`：PUT / PATCH 请求体属性不得携带 `default`。
 */
export function partialForUpdate<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
): z.ZodObject<{ [K in keyof T['shape']]: z.ZodOptional<StripDefault<T['shape'][K]>> }> {
  const shape = schema.shape as Record<string, z.ZodType>;
  const stripped: Record<string, z.ZodType> = {};
  for (const key of Object.keys(shape)) {
    stripped[key] = stripDefaults(shape[key]);
  }
  // eslint-disable-next-line no-restricted-syntax -- 唯一合法的 .partial() 调用点：输入已剥离全部默认值
  return z.object(stripped).partial() as unknown as z.ZodObject<{
    [K in keyof T['shape']]: z.ZodOptional<StripDefault<T['shape'][K]>>
  }>;
}


export const dateTimeStringSchema = z.string().regex(DATE_TIME_PATTERN, '日期时间格式必须为 YYYY-MM-DD HH:mm:ss');


// ─── 埋点事件上报 ─────────────────────────────────────────────────────────────
export function boundedJsonRecord(label: string, maxKeys: number, maxBytes: number, maxDepth = 6) {
  return z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
    if (Object.keys(value).length > maxKeys) {
      ctx.addIssue({ code: 'custom', message: `${label}最多允许 ${maxKeys} 个字段` });
    }
    if (jsonDepth(value) > maxDepth) {
      ctx.addIssue({ code: 'custom', message: `${label}嵌套层级不能超过 ${maxDepth} 层` });
    }
    if (jsonByteLength(value) > maxBytes) {
      ctx.addIssue({ code: 'custom', message: `${label}序列化后不能超过 ${maxBytes} 字节` });
    }
  });
}


// ─── 告警规则 ─────────────────────────────────────────────────────────────────
export const webhookUrlSchema = httpUrl('Webhook URL 仅支持 HTTP/HTTPS').max(512);


export function validateAlertDelivery(
  value: { enabled?: boolean; channels?: string[]; webhookUrl?: string | null; recipients?: string[] },
  ctx: z.RefinementCtx,
) {
  if (value.enabled === false) return;
  const channels = value.channels ?? [];
  if (channels.length === 0) {
    ctx.addIssue({ code: 'custom', path: ['channels'], message: '启用告警时至少选择一个通知渠道' });
  }
  if (channels.includes('webhook') && !value.webhookUrl) {
    ctx.addIssue({ code: 'custom', path: ['webhookUrl'], message: 'Webhook 渠道必须配置有效 URL' });
  }
  if ((channels.includes('email') || channels.includes('inapp')) && !(value.recipients?.length)) {
    ctx.addIssue({ code: 'custom', path: ['recipients'], message: '邮件或站内通知渠道必须配置接收人' });
  }
}
