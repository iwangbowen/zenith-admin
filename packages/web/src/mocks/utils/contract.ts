import { http, type HttpHandler } from 'msw';
import type * as z from 'zod';
import {
  isMultipart,
  toColonPath,
  type AnyOperation,
  type HeadersOf,
  type MultipartBody,
  type OutputOf,
  type ParamsOf,
  type QueryOf,
} from '@zenith/shared/core';
import { badRequest, ok, pageResult } from './handlers';

/**
 * 契约驱动的 MSW handler。
 *
 * 路径、方法与入参解析全部来自契约操作：params / query / body 按契约 schema 解析
 * （与真实后端同一套校验，非法输入同样得到 400），`ok()` 的载荷类型绑定到契约响应，
 * Demo 模式因此无法给出与服务端不一致的路径或形状。
 *
 * ```ts
 * mock(tenantContract.detail, ({ params, ok }) => {
 *   const tenant = mockTenants.find((t) => t.id === params.id);
 *   return tenant ? ok(tenant) : notFound('租户不存在');
 * });
 * ```
 */

export interface MockContext<Op extends AnyOperation> {
  /** 已按契约解析（含 coerce）的路径参数 */
  readonly params: ParamsOf<Op>;
  /** 已按契约解析的查询参数；未声明时为 undefined */
  readonly query: QueryOf<Op>;
  /** 已按契约解析的业务请求头（键为小写头名）；未声明时为 undefined */
  readonly headers: HeadersOf<Op>;
  /** 已按契约解析的 JSON 请求体；multipart 为原始 FormData；未声明时为 undefined */
  readonly body: Op['body'] extends MultipartBody ? FormData : Op['body'] extends z.ZodType ? z.output<Op['body']> : undefined;
  readonly request: Request;
  readonly url: URL;
  /** 成功响应；`data` 必须满足契约响应类型 */
  readonly ok: (data: OutputOf<Op>, message?: string, init?: ResponseInit) => Response;
  /** 按 query 的 page / pageSize 切片成分页载荷（未声明分页参数时按 1 / 10） */
  readonly paginate: <T>(list: readonly T[]) => { list: T[]; total: number; page: number; pageSize: number };
}

export type MockResolver<Op extends AnyOperation> = (ctx: MockContext<Op>) => Response | Promise<Response>;

type ParseOutcome = { ok: true; value: unknown } | { ok: false; message: string };

function parseWith(schema: z.ZodType | undefined, value: unknown, label: string): ParseOutcome {
  if (!schema) return { ok: true, value: undefined };
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data };
  const issue = result.error.issues[0];
  const path = issue?.path?.map(String).join('.');
  return { ok: false, message: `${label}${path ? `「${path}」` : ''}${issue?.message ?? '不合法'}` };
}

function searchParamsToObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams) {
    const prev = out[key];
    if (prev === undefined) out[key] = value;
    else out[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}

/** 由契约操作生成 MSW handler；路径 `{id}` 自动转为 `:id` */
export function mock<Op extends AnyOperation>(op: Op, resolver: MockResolver<Op>): HttpHandler {
  const path = toColonPath(op.fullPath);
  return http[op.method](path, async ({ request, params: rawParams }) => {
    const url = new URL(request.url);

    const params = parseWith(op.params, rawParams, '路径参数');
    if (!params.ok) return badRequest(params.message, { status: 400 });

    const query = parseWith(op.query, searchParamsToObject(url), '参数');
    if (!query.ok) return badRequest(query.message, { status: 400 });

    const headers = parseWith(op.headers, Object.fromEntries(request.headers), '请求头');
    if (!headers.ok) return badRequest(headers.message, { status: 400 });

    let body: ParseOutcome = { ok: true, value: undefined };
    if (op.body && request.method !== 'GET') {
      if (isMultipart(op.body)) {
        body = { ok: true, value: await request.clone().formData() };
      } else {
        body = parseWith(op.body, await readJsonBody(request), '请求体');
        if (!body.ok) return badRequest(body.message, { status: 400 });
      }
    }

    const pageOf = (query.value as { page?: number; pageSize?: number } | undefined) ?? {};
    const ctx: MockContext<Op> = {
      params: params.value as ParamsOf<Op>,
      query: query.value as QueryOf<Op>,
      headers: headers.value as HeadersOf<Op>,
      body: body.value as MockContext<Op>['body'],
      request,
      url,
      ok: (data, message, init) => ok(data, message, init),
      paginate: (list) => pageResult([...list], pageOf.page ?? 1, pageOf.pageSize ?? 10),
    };
    return resolver(ctx);
  });
}

async function readJsonBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return undefined;
  try {
    return await request.clone().json();
  } catch {
    return undefined;
  }
}
