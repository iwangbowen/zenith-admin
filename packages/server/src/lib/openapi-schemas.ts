/**
 * 路由层的响应信封与校验钩子：契约适配（lib/contract-route.ts）与少数协议端点共用。
 *
 * 统一接口响应结构：{ code, message, data }
 *  - 成功：code = 0
 *  - 失败：code 为非零（400/401/403/404/500 等）
 *
 * 入参 schema 积木（分页 / 时间范围 / 查询串布尔与枚举 / 批量 ID）见 `@zenith/shared/core` 的 api-schemas。
 */
import { z, type Hook } from '@hono/zod-openapi';
import type { Context } from 'hono';

/**
 * 统一验证失败 Hook：将 Zod 校验错误转为 { code: 400, message, data: null }
 * 在 new OpenAPIHono({ defaultHook: validationHook }) 中使用
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const validationHook: Hook<any, any, any, any> = (result, c) => {
  if (!result.success) {
    return c.json({ code: 400, message: formatZodIssue(result.error.issues?.[0]), data: null }, 400);
  }
};

/** Zod v4 issue code → 中文兜底文案（具体分支在 describeIssue 里用结构化字段细化） */
const ZOD_CODE_MESSAGES: Record<string, string> = {
  invalid_type: '类型不正确',
  too_small: '长度或数值小于允许范围',
  too_big: '长度或数值超出允许范围',
  invalid_format: '格式不正确',
  invalid_value: '取值不在允许范围内',
  not_multiple_of: '不是允许的步进值',
  unrecognized_keys: '包含未知字段',
  invalid_union: '格式不符合任一允许的形态',
  invalid_key: '键名不合法',
  invalid_element: '集合元素不合法',
  custom: '参数校验未通过',
};

/** formatZodIssue 关心的 Zod v4 issue 结构化字段（宽松声明，避免耦合内部类型） */
interface ZodIssueLike {
  path?: PropertyKey[];
  message?: string;
  code?: string;
  expected?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
  origin?: string;
  format?: string;
  divisor?: number;
  keys?: string[];
  values?: unknown[];
}

/** 数量语义按 origin 细分：字符串按长度、集合按项数、数字按大小 */
function describeBound(issue: ZodIssueLike, kind: 'min' | 'max'): string {
  const bound = kind === 'min' ? issue.minimum : issue.maximum;
  const generic = ZOD_CODE_MESSAGES[kind === 'min' ? 'too_small' : 'too_big'];
  if (bound === undefined) return generic;
  const incl = issue.inclusive !== false;
  switch (issue.origin) {
    case 'string':
      return kind === 'min'
        ? (incl ? `长度不能少于 ${bound} 个字符` : `长度必须多于 ${bound} 个字符`)
        : (incl ? `长度不能超过 ${bound} 个字符` : `长度必须少于 ${bound} 个字符`);
    case 'array':
    case 'set':
    case 'map':
      return kind === 'min' ? `至少需要 ${bound} 项` : `最多允许 ${bound} 项`;
    case 'number':
    case 'int':
    case 'bigint':
      return kind === 'min'
        ? (incl ? `不能小于 ${bound}` : `必须大于 ${bound}`)
        : (incl ? `不能大于 ${bound}` : `必须小于 ${bound}`);
    default:
      return generic;
  }
}

/** 按 v4 issue code 与结构化字段生成具体中文描述 */
function describeIssue(issue: ZodIssueLike): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.expected ? `类型不正确，期望 ${issue.expected}` : ZOD_CODE_MESSAGES.invalid_type;
    case 'too_small':
      return describeBound(issue, 'min');
    case 'too_big':
      return describeBound(issue, 'max');
    case 'invalid_format':
      return issue.format ? `格式不正确（要求 ${issue.format} 格式）` : ZOD_CODE_MESSAGES.invalid_format;
    case 'invalid_value': {
      const values = (issue.values ?? []).map((v) => JSON.stringify(v));
      if (!values.length) return ZOD_CODE_MESSAGES.invalid_value;
      const shown = values.slice(0, 8).join(' / ') + (values.length > 8 ? ' 等' : '');
      return `取值不在允许范围内（允许：${shown}）`;
    }
    case 'not_multiple_of':
      return issue.divisor !== undefined ? `必须是 ${issue.divisor} 的倍数` : ZOD_CODE_MESSAGES.not_multiple_of;
    case 'unrecognized_keys':
      return issue.keys?.length ? `包含未知字段：${issue.keys.join('、')}` : ZOD_CODE_MESSAGES.unrecognized_keys;
    default:
      return ZOD_CODE_MESSAGES[issue.code ?? ''] ?? '参数校验未通过';
  }
}

/**
 * 把一条 Zod issue 渲染成可直接展示给用户的文案。
 *
 * schema 中自定义的中文 message 本身就是完整业务语义（例如「刷新令牌模式必须与授权码模式同时启用」），
 * 再拼上 `grantTypes: ` 这样的字段名只会让提示更难读。因此只有 Zod 内置英文消息才需要
 * 补充字段位置并按 issue 结构化字段翻译；缺字段时退回通用提示。
 *
 * 注意：不配置 `z.config(z.locales.zhCN())`——全局 locale 会把内置消息也变成中文，
 * 使「含中文即业务文案」的判别失效，业务消息与内置消息将无法区分、字段名前缀丢失。
 */
export function formatZodIssue(issue?: ZodIssueLike): string {
  if (!issue) return '请求参数错误';
  const message = issue.message ?? '';
  // 含中文即视为业务自定义文案，直接展示
  if (/[\u4e00-\u9fa5]/.test(message)) return message;

  const field = (issue.path ?? []).map(String).filter(Boolean).join('.');
  if (issue.code === 'invalid_type' && /received undefined/i.test(message)) {
    return field ? `缺少必填参数「${field}」` : '缺少必填参数';
  }
  const readable = describeIssue(issue);
  return field ? `参数「${field}」${readable}` : readable;
}

/** 通用成功响应封装：code=0 + 任意 data */
export function apiResponse<T extends z.ZodTypeAny>(data: T) {
  return z.object({
    code: z.literal(0),
    message: z.string(),
    data,
  });
}

/** 通用错误响应 */
export const ErrorResponse = z.object({
  code: z.number(),
  message: z.string(),
  data: z.null().optional().nullable(),
});

/** 构造 application/json content */
export function jsonContent<T extends z.ZodTypeAny>(schema: T) {
  return { 'application/json': { schema } };
}

/** 常用错误响应集合（复制到 responses 里） */
export const commonErrorResponses = {
  400: { content: jsonContent(ErrorResponse), description: '请求参数错误' },
  401: { content: jsonContent(ErrorResponse), description: '未登录或 token 失效' },
  403: { content: jsonContent(ErrorResponse), description: '无权限' },
  404: { content: jsonContent(ErrorResponse), description: '资源不存在' },
  500: { content: jsonContent(ErrorResponse), description: '服务端错误' },
} as const;

/** 409 冲突响应（删除对象仍被引用等场景），与 commonErrorResponses 配合展开使用 */
export const conflictResponse = {
  409: { content: jsonContent(ErrorResponse), description: '存在关联数据，操作冲突' },
} as const;

/** Excel 文件下载响应（OpenAPI responses 块） */
export function okExcel(description = 'Excel 文件') {
  return {
    200: {
      content: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
      description,
    },
  } as const;
}

/** CSV 文件下载响应（OpenAPI responses 块） */
export function okCsv(description = 'CSV 文件') {
  return {
    200: {
      content: {
        'text/csv; charset=utf-8': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
      description,
    },
  } as const;
}

/** 设置 CSV 响应头并以 ReadableStream 形式返回文件 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function csvStreamBody(c: Context<any>, stream: ReadableStream, filename: string): never {
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
  return new Response(stream) as never;
}

/** 通用文件下载响应（OpenAPI responses 块） */
export function okFile(description = '文件') {
  return {
    200: {
      content: {
        'application/octet-stream': {
          schema: z.string().openapi({ format: 'binary' }),
        },
      },
      description,
    },
  } as const;
}

/** 设置下载响应头并以字符串内容返回文件 */
export function fileBody(content: string, filename: string, contentType: string): never {
  return new Response(content, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
    },
  }) as never;
}

/**
 * 构造成功响应体，配合 c.json(okBody(data), 200) 使用。
 * `0 as const` 将类型收窄为字面量 0，满足 z.literal(0) 的类型检查。
 *
 * @example
 * return c.json(okBody(user, '创建成功'), 200);
 * return c.json(okBody(null, '删除成功'), 200);
 */
export const okBody = <T>(data: T, message = 'success') => ({ code: 0 as const, message, data });

/**
 * 构造错误响应体，配合 c.json(errBody(msg), 400) 使用。
 * 当错误码非 400 时，同时传入 code 与 c.json 的第二个 status 参数。
 *
 * @example
 * return c.json(errBody('密码不符合要求'), 400);
 * return c.json(errBody('用户不存在', 404), 404);
 */
export const errBody = <const T extends number = 400>(
  message: string,
  code: T = 400 as T,
) => ({ code, message, data: null });
