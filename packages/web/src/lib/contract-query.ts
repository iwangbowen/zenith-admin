import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import type { ApiResponse } from '@zenith/shared/core';
import {
  fillPath,
  resourceKeyOf,
  type AnyOperation,
  type BodyOf,
  type EmptyInput,
  type InputOf,
  type OutputOf,
  type ParamsSchema,
  type QueryOf,
  type ShapeInput,
} from '@zenith/shared/core';
import { request, type RequestOptions } from '@/utils/request';
import { LOOKUP_STALE_TIME, toQueryString, unwrap } from '@/lib/query';

/**
 * 契约驱动的数据访问层。
 *
 * 所有服务端调用都由 `@zenith/shared` 的契约操作驱动：URL、方法、入参与响应类型均来自契约，
 * 页面与域 hooks 不再书写路径字符串或响应泛型。
 *
 * - `api(op, input)`：单次调用，返回解包后的 `data`
 * - `apiQueryOptions(op, input)` / `useApiQuery(op, input)`：可缓存查询
 * - `useApiMutation(op)`：变更，变量即契约输入 `{ params?, query?, body? }`
 * - `createResourceQueries(contract)`：标准 CRUD 资源的 keys 与全套 hooks，失效契约焊死在工厂里
 */

/** 与 `@/utils/request` 及会员端 / 审批端客户端共有的最小请求接口 */
export interface ApiClient {
  get<T>(url: string, opts?: RequestOptions): Promise<ApiResponse<T>>;
  post<T>(url: string, body?: unknown, opts?: RequestOptions): Promise<ApiResponse<T>>;
  put<T>(url: string, body?: unknown, opts?: RequestOptions): Promise<ApiResponse<T>>;
  patch<T>(url: string, body?: unknown, opts?: RequestOptions): Promise<ApiResponse<T>>;
  delete<T>(url: string, body?: unknown, opts?: RequestOptions): Promise<ApiResponse<T>>;
}

export interface ApiCallOptions extends RequestOptions {
  /** 覆盖请求实例（会员端 / 审批端），默认管理端 `request` */
  client?: ApiClient;
}

/** 无输入段的操作允许省略 input */
type InputArgs<Op extends AnyOperation> = Record<never, never> extends InputOf<Op>
  ? [input?: InputOf<Op>]
  : [input: InputOf<Op>];

/** 只影响 URL 的输入段（params / query）；构造 URL 不需要 body */
export type UrlInputOf<Op extends AnyOperation> =
  (Op['params'] extends ParamsSchema ? { params: ShapeInput<Op['params']> } : EmptyInput) &
  (Op['query'] extends ParamsSchema ? { query: ShapeInput<Op['query']> } : EmptyInput);

type UrlInputArgs<Op extends AnyOperation> = Record<never, never> extends UrlInputOf<Op>
  ? [input?: UrlInputOf<Op>]
  : [input: UrlInputOf<Op>];

type LooseInput = { params?: Record<string, unknown>; query?: object; headers?: Record<string, unknown>; body?: unknown } | undefined;

/**
 * 契约操作 + 输入 → 完整 URL（含查询串）。只需要 params / query 段，
 * 供 `request.postForm(urlOf(op), formData)`、`<Upload action>`、下载链接等只消费 URL 的场景使用。
 */
export function urlOf<Op extends AnyOperation>(op: Op, ...args: UrlInputArgs<Op>): string {
  const input = args[0] as LooseInput;
  return fillPath(op.fullPath, input?.params) + (input?.query ? toQueryString(input.query) : '');
}

/** 契约声明的业务请求头（输入 `headers` 段）合并到请求选项；未声明时原样返回 */
function withContractHeaders(options: RequestOptions, headers: Record<string, unknown> | undefined): RequestOptions {
  if (!headers) return options;
  const merged = new Headers(options.headers);
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null) merged.set(name, String(value));
  }
  return { ...options, headers: merged };
}

/** 调用契约操作并解包 `data`；`code !== 0` 抛 `ApiError` */
export async function api<Op extends AnyOperation>(
  op: Op,
  ...args: [...InputArgs<Op>, options?: ApiCallOptions]
): Promise<OutputOf<Op>> {
  const [rawInput, rawOptions] = splitArgs<Op>(op, args);
  if (op.kind !== 'json') {
    throw new Error(`契约操作「${op.name}」为 ${op.kind} 响应，请使用 request.download(urlOf(op, input)) 等二进制通道`);
  }
  const { client = request, ...baseOptions } = rawOptions ?? {};
  const requestOptions = withContractHeaders(baseOptions, (rawInput as LooseInput)?.headers);
  const url = urlOf(op, ...([rawInput] as unknown as UrlInputArgs<Op>));
  const body = (rawInput as LooseInput)?.body;
  const response = op.method === 'get'
    ? await client.get<OutputOf<Op>>(url, requestOptions)
    : await client[op.method]<OutputOf<Op>>(url, body, requestOptions);
  return unwrap(response);
}

const INPUT_KEYS = new Set(['params', 'query', 'headers', 'body']);

function splitArgs<Op extends AnyOperation>(op: Op, args: unknown[]): [InputOf<Op> | undefined, ApiCallOptions | undefined] {
  // 第一个参数是输入（可能省略），第二个是选项；单参数时按键集合判定：
  // 含 params / query / body 即输入；只含 headers 时，契约声明了 headers 段才视为输入（否则是请求选项）
  const [first, second] = args;
  if (args.length >= 2) return [first as InputOf<Op> | undefined, second as ApiCallOptions | undefined];
  if (first && typeof first === 'object') {
    const keys = Object.keys(first);
    const onlyInputKeys = keys.length > 0 && keys.every((k) => INPUT_KEYS.has(k));
    if ('params' in first || 'query' in first || 'body' in first || (onlyInputKeys && op.headers)) {
      return [first as InputOf<Op>, undefined];
    }
  }
  return [undefined, first as ApiCallOptions | undefined];
}

// ─── query key ───────────────────────────────────────────────────────────────

/**
 * 契约操作的 query key：`[资源键, 操作名, input?]`。
 * 省略 input 得到该操作全部查询的公共前缀（供 `invalidateQueries` / `useListSearch({ listKey })` 使用）。
 * 业务请求头不参与 key：它们不是资源身份的一部分。
 */
export function contractKey<Op extends AnyOperation>(op: Op, input?: InputOf<Op>): readonly unknown[] {
  if (input === undefined) return [resourceKeyOf(op.basePath), op.name];
  const { headers: _headers, ...identity } = input as LooseInput & object;
  return [resourceKeyOf(op.basePath), op.name, identity];
}

type ApiQueryExtraOptions<Op extends AnyOperation> = Omit<
  UseQueryOptions<OutputOf<Op>, Error, OutputOf<Op>, readonly unknown[]>,
  'queryKey' | 'queryFn'
> & { requestOptions?: ApiCallOptions };

/** 可缓存查询的 `queryOptions`，可直接给 `useQuery` / `queryClient.prefetchQuery` / `useQueries` */
export function apiQueryOptions<Op extends AnyOperation>(
  op: Op,
  ...args: [...InputArgs<Op>, options?: ApiQueryExtraOptions<Op>]
) {
  const [input, options] = splitQueryArgs<Op>(args);
  const { requestOptions, ...queryExtras } = options ?? {};
  return queryOptions<OutputOf<Op>, Error, OutputOf<Op>, readonly unknown[]>({
    queryKey: contractKey(op, input),
    queryFn: () => api(op, ...([input, requestOptions] as unknown as [...InputArgs<Op>, ApiCallOptions?])),
    ...queryExtras,
  });
}

function splitQueryArgs<Op extends AnyOperation>(args: unknown[]): [InputOf<Op> | undefined, ApiQueryExtraOptions<Op> | undefined] {
  const [first, second] = args;
  if (args.length >= 2) return [first as InputOf<Op> | undefined, second as ApiQueryExtraOptions<Op> | undefined];
  if (first && typeof first === 'object' && ('params' in first || 'query' in first || 'body' in first)) {
    return [first as InputOf<Op>, undefined];
  }
  return [undefined, first as ApiQueryExtraOptions<Op> | undefined];
}

export function useApiQuery<Op extends AnyOperation>(
  op: Op,
  ...args: [...InputArgs<Op>, options?: ApiQueryExtraOptions<Op>]
) {
  return useQuery(apiQueryOptions(op, ...args));
}

// ─── mutation ────────────────────────────────────────────────────────────────

export interface ApiMutationOptions<Op extends AnyOperation> extends Omit<
  UseMutationOptions<OutputOf<Op>, Error, InputOf<Op>>,
  'mutationFn'
> {
  /** 成功后的缓存失效 / 更新；`onSuccess` 仍可用于业务副作用 */
  invalidate?: (qc: QueryClient, output: OutputOf<Op>, input: InputOf<Op>) => void;
  requestOptions?: ApiCallOptions;
}

/** 契约操作的 mutation：`mutate({ params, body })`，变量形状即契约输入 */
export function useApiMutation<Op extends AnyOperation>(op: Op, options: ApiMutationOptions<Op> = {}) {
  const qc = useQueryClient();
  const { invalidate, requestOptions, onSuccess, ...rest } = options;
  return useMutation<OutputOf<Op>, Error, InputOf<Op>>({
    mutationFn: (input) => api(op, ...([input, requestOptions] as unknown as [...InputArgs<Op>, ApiCallOptions?])),
    onSuccess: (output, input, onMutateResult, context) => {
      invalidate?.(qc, output, input);
      return onSuccess?.(output, input, onMutateResult, context);
    },
    ...rest,
  });
}

// ─── 标准 CRUD 资源 ─────────────────────────────────────────────────────────

/** 分页载荷最小形态 */
export interface PageOf<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

type ListOp = AnyOperation & { method: 'get' };
type DetailOp = AnyOperation & { method: 'get' };
type WriteOp = AnyOperation & { method: 'post' | 'put' | 'patch' };
type RemoveOp = AnyOperation & { method: 'delete' };

/**
 * 标准 CRUD 契约组的形态约定：
 * - `list`：分页列表，`query` 含 page / pageSize，响应 `paginated(entity)`
 * - 可选 `detail`：`GET /{id}`，响应实体；未声明时实体类型取列表项
 * - `create` / `update`：`POST /` 与 `PUT /{id}`，响应实体
 * - `remove`：`DELETE /{id}`；可选 `removeBatch`：`DELETE /batch`，body `{ ids }`
 * - 可选 `all`：全量精简下拉源
 */
export interface ResourceContract {
  readonly basePath: string;
  readonly list: ListOp;
  readonly detail?: DetailOp;
  readonly create?: WriteOp;
  readonly update?: WriteOp;
  readonly remove?: RemoveOp;
  readonly removeBatch?: RemoveOp;
  readonly all?: AnyOperation;
}

/** 契约组中某个可选操作的类型；未声明时为 never */
type OpAt<C, K extends string> = K extends keyof C ? (C[K] extends AnyOperation ? C[K] : never) : never;
type ListItemOf<C extends ResourceContract> = OutputOf<C['list']> extends { list: (infer T)[] } ? T : never;
/** 实体类型：detail 的响应；未声明 detail 时取列表项 */
type EntityOf<C extends ResourceContract> = [OpAt<C, 'detail'>] extends [never] ? ListItemOf<C> : OutputOf<OpAt<C, 'detail'>>;
type ListParamsOf<C extends ResourceContract> = NonNullable<QueryOf<C['list']>>;
type IdFromParams<Op> = Op extends AnyOperation
  ? (Op['params'] extends ParamsSchema ? (ShapeInput<Op['params']> extends { id: infer TId } ? TId : number) : number)
  : never;
/** 资源主键类型：依次取 detail / update / remove 操作路径参数 `id`（数值主键为 number，UUID 主键为 string） */
type IdOf<C extends ResourceContract> = [OpAt<C, 'detail'>] extends [never]
  ? [OpAt<C, 'update'>] extends [never]
    ? [OpAt<C, 'remove'>] extends [never] ? number : IdFromParams<OpAt<C, 'remove'>>
    : IdFromParams<OpAt<C, 'update'>>
  : IdFromParams<OpAt<C, 'detail'>>;
/**
 * 保存载荷：create 入参的部分形态。同一表单同时服务新增与编辑，必填字段由表单 rules 保证、
 * 服务端 schema 兜底校验；未声明 create 时取 update 入参。
 */
type SaveValuesOf<C extends ResourceContract> = C['create'] extends AnyOperation
  ? Partial<NonNullable<BodyOf<C['create']>>>
  : C['update'] extends AnyOperation ? Partial<NonNullable<BodyOf<C['update']>>> : never;
type LookupOf<C extends ResourceContract> = C['all'] extends AnyOperation ? OutputOf<C['all']> : never;

export interface ResourceQueryKeys<TListParams, TId = number> {
  readonly all: readonly string[];
  /** 全部列表查询的公共前缀，用于「任意条件下的列表都失效」 */
  readonly lists: readonly string[];
  readonly list: (params: TListParams) => readonly unknown[];
  readonly detail: (id: TId | undefined) => readonly unknown[];
  /** 下拉源（全量精简列表） */
  readonly lookup: readonly string[];
}

export interface CreateResourceQueriesOptions<C extends ResourceContract> {
  /**
   * 覆盖 query key 前缀，默认由 basePath 派生（`/api/tenants` → `['tenants']`）。
   * 仅用于既有跨域广播依赖嵌套前缀的域（如 `['workflow', 'automations']`）。
   */
  readonly keyPrefix?: readonly string[];
  /** 保存成功后的额外失效（跨域联动） */
  readonly onSaved?: (qc: QueryClient, saved: EntityOf<C>) => void;
  /** 删除成功后的额外失效 */
  readonly onDeleted?: (qc: QueryClient, ids: IdOf<C>[]) => void;
  readonly listStaleTime?: number;
  readonly requestOptions?: ApiCallOptions;
}

interface ResourceQueriesBase<C extends ResourceContract> {
  readonly keys: ResourceQueryKeys<ListParamsOf<C>, IdOf<C>>;
  readonly useList: (params: ListParamsOf<C>, enabled?: boolean) => ReturnType<typeof useQuery<PageOf<EntityOf<C>>>>;
  /** 无 id 走 create，有 id 走 update；成功后失效列表、详情与下拉源 */
  readonly useSave: () => ReturnType<typeof useMutation<EntityOf<C>, Error, { id?: IdOf<C>; values: SaveValuesOf<C> }>>;
  /** 单条走 remove，多条走 removeBatch（未声明时并发逐条删除）；成功后移除详情缓存并失效列表 */
  readonly useDelete: () => ReturnType<typeof useMutation<null, Error, IdOf<C>[]>>;
  readonly useLookup: (enabled?: boolean) => ReturnType<typeof useQuery<LookupOf<C>>>;
}

/** 契约声明了 detail 时才提供 `useDetail` */
export type ResourceQueries<C extends ResourceContract> = ResourceQueriesBase<C> &
  ([OpAt<C, 'detail'>] extends [never]
    ? Record<never, never>
    : { readonly useDetail: (id: IdOf<C> | undefined, enabled?: boolean) => ReturnType<typeof useQuery<EntityOf<C>>> });

export function createResourceQueries<const C extends ResourceContract>(
  contract: C,
  options: CreateResourceQueriesOptions<C> = {},
): ResourceQueries<C> {
  const { keyPrefix = [resourceKeyOf(contract.basePath)], onSaved, onDeleted, listStaleTime, requestOptions } = options;
  const prefix = [...keyPrefix];
  const keys: ResourceQueryKeys<ListParamsOf<C>, IdOf<C>> = {
    all: prefix,
    lists: [...prefix, 'list'],
    list: (params) => [...prefix, 'list', params] as const,
    detail: (id) => [...prefix, 'detail', id] as const,
    lookup: [...prefix, 'all'],
  };
  const call = <Op extends AnyOperation>(op: Op, input?: InputOf<Op>) =>
    api(op, ...([input, requestOptions] as unknown as [...InputArgs<Op>, ApiCallOptions?]));

  function invalidateCommon(qc: QueryClient) {
    void qc.invalidateQueries({ queryKey: keys.lists });
    if (contract.all) void qc.invalidateQueries({ queryKey: keys.lookup });
  }

  function useList(params: ListParamsOf<C>, enabled = true) {
    return useQuery({
      queryKey: keys.list(params),
      queryFn: () => call(contract.list, { query: params } as unknown as InputOf<C['list']>) as Promise<PageOf<EntityOf<C>>>,
      // 翻页 / 改条件时保留上一页数据，避免表格闪空
      placeholderData: keepPreviousData,
      staleTime: listStaleTime,
      enabled,
    });
  }

  function useDetail(id: IdOf<C> | undefined, enabled = true) {
    return useQuery({
      queryKey: keys.detail(id),
      queryFn: () => {
        if (!contract.detail) throw new Error(`契约 ${contract.basePath} 未声明 detail 操作`);
        return call(contract.detail, { params: { id } } as unknown as InputOf<DetailOp>) as Promise<EntityOf<C>>;
      },
      enabled: enabled && id !== undefined && Boolean(contract.detail),
    });
  }

  function useSave() {
    const qc = useQueryClient();
    return useMutation<EntityOf<C>, Error, { id?: IdOf<C>; values: SaveValuesOf<C> }>({
      mutationFn: ({ id, values }) => {
        if (id === undefined) {
          if (!contract.create) throw new Error(`契约 ${contract.basePath} 未声明 create 操作`);
          return call(contract.create, { body: values } as InputOf<WriteOp>) as Promise<EntityOf<C>>;
        }
        if (!contract.update) throw new Error(`契约 ${contract.basePath} 未声明 update 操作`);
        return call(contract.update, { params: { id }, body: values } as InputOf<WriteOp>) as Promise<EntityOf<C>>;
      },
      onSuccess: (saved) => {
        void qc.invalidateQueries({ queryKey: keys.detail((saved as { id: IdOf<C> }).id) });
        invalidateCommon(qc);
        onSaved?.(qc, saved);
      },
    });
  }

  function useDelete() {
    const qc = useQueryClient();
    return useMutation<null, Error, IdOf<C>[]>({
      mutationFn: async (ids) => {
        if (ids.length > 1 && contract.removeBatch) {
          await call(contract.removeBatch, { body: { ids } } as InputOf<RemoveOp>);
          return null;
        }
        if (!contract.remove) throw new Error(`契约 ${contract.basePath} 未声明 remove 操作`);
        await Promise.all(ids.map((id) => call(contract.remove as RemoveOp, { params: { id } } as InputOf<RemoveOp>)));
        return null;
      },
      onSuccess: (_data, ids) => {
        // 详情缓存必须移除而非失效：失效会让已删除记录在下次挂载时重新请求并 404
        for (const id of ids) qc.removeQueries({ queryKey: keys.detail(id) });
        invalidateCommon(qc);
        onDeleted?.(qc, ids);
      },
    });
  }

  function useLookup(enabled = true) {
    return useQuery({
      queryKey: keys.lookup,
      queryFn: () => {
        if (!contract.all) throw new Error(`契约 ${contract.basePath} 未声明 all 操作`);
        return call(contract.all) as Promise<LookupOf<C>>;
      },
      staleTime: LOOKUP_STALE_TIME,
      enabled: enabled && Boolean(contract.all),
    });
  }

  // 未声明 detail 的契约在类型上不暴露 useDetail；运行时对象保持同一形状以便 hooks 调用顺序恒定
  return { keys, useList, useDetail, useSave, useDelete, useLookup } as unknown as ResourceQueries<C>;
}
