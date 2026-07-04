# 数据获取与服务端状态

前端所有服务端数据（列表、详情、下拉源、统计等）统一由 [TanStack Query v5](https://tanstack.com/query) 管理。`utils/request.ts` 仅作为传输层（token 刷新、错误 Toast 等，见[认证与请求](/frontend/auth-request)），页面不再手写 `loading` / `data` state 与 `fetchXxx` 拉取函数。

## 分层结构

```text
packages/web/src/
├── lib/query.ts            # queryClient 单例 + unwrap + toQueryString + LOOKUP_STALE_TIME
├── hooks/queries/          # 域 hooks：每个业务域一个文件（users.ts、roles.ts、payment-orders.ts …）
├── utils/request.ts        # 传输层（不变）
└── member/
    ├── lib/member-query.ts # 会员端独立 memberQueryClient
    └── hooks/queries.ts    # 会员端域 hooks（基于 memberRequest）
```

`QueryClientProvider` 在 `App.tsx` 顶层挂载（会员端在 `App-member.tsx`），开发模式附带 React Query Devtools。退出登录或切换用户时自动 `queryClient.clear()`，避免跨账号数据泄漏。

## 基建（lib/query.ts）

| 导出 | 说明 |
|------|------|
| `queryClient` | 全局单例。默认 `staleTime: 30s`、`retry: false`、`refetchOnWindowFocus: false` |
| `unwrap(res)` | 解包统一响应：`code !== 0` 时抛 `ApiError`（错误 Toast 已由 request 层弹出，调用方无需重复处理） |
| `ApiError` | 携带 `code` 的业务错误，`mutateAsync` 抛出后可保持弹窗打开 |
| `toQueryString(params)` | 构建查询串，自动过滤 `undefined` / `null` / 空字符串 |
| `LOOKUP_STALE_TIME` | 5 分钟，用于低频 lookup 数据（字典、部门树、用户下拉源等） |

## 域 hooks 约定

每个业务域一个文件，导出 keys 常量与查询/变更 hooks：

```ts
// hooks/queries/xxxs.ts
export const xxxKeys = {
  all: ['xxxs'] as const,                                        // 域根前缀（mutation 失效用）
  lists: ['xxxs', 'list'] as const,                              // 列表前缀（查询按钮失效用）
  list: (params: XxxListParams) => ['xxxs', 'list', params] as const,
  detail: (id: number | undefined) => ['xxxs', 'detail', id] as const,
};

export function useXxxList(params: XxxListParams) {
  return useQuery({
    queryKey: xxxKeys.list(params),
    queryFn: () => request.get<PaginatedResponse<Xxx>>(`/api/xxxs${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,   // 分页列表必加：翻页/改条件时保留旧数据不闪白
  });
}

export function useSaveXxx() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined ? request.post<Xxx>('/api/xxxs', values) : request.put<Xxx>(`/api/xxxs/${id}`, values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: xxxKeys.all }),   // 失效在 hooks，成功 Toast 在页面
  });
}
```

规则：

- **params 只放可序列化的 string / number**：`Date` 先用 `formatDateTimeForApi` 转字符串，空字符串筛选项映射为 `undefined`
- **mutation 统一在域 hooks 的 `onSuccess` 中失效域根前缀**；成功 `Toast.success` 写在页面代码；不要额外加错误 Toast（request 层已统一弹出）
- 共享 lookup（`useAllUsers`、`useFlatDepartments`、`useDepartmentTree`、`useMenuTree`、`useAllRoles`、`useAllPositions`、`useDictItems` 等）已存在，直接 import 复用，禁止在页面或新域文件中重复定义同一数据源
- **官方 ESLint 插件已启用**（`@tanstack/eslint-plugin-query`，见 `packages/web/eslint.config.js`）：自动检查不稳定依赖（useQuery/useQueries/useMutation 结果对象不得直接进 deps 数组）等问题；多查询聚合场景用 `useQueries` 的 `combine` 选项产出稳定引用。其中 `exhaustive-deps` 规则因误报较多（如 `silent` 等仅影响行为不影响数据的选项）已关闭——**queryFn 引用的会影响响应数据的变量必须进 queryKey**，这一点靠约定与评审保证

## 列表页模式

搜索条件采用 **draft / submitted 拆分**：`draftParams` 绑定输入框（输入不触发请求），`submittedParams` 与 `page` / `pageSize` 一起进入 query key（key 变化自动请求）。

```tsx
const queryClient = useQueryClient();
const { page, pageSize, setPage, buildPagination } = usePagination();
const [draftParams, setDraftParams] = useState(defaultSearchParams);
const [submittedParams, setSubmittedParams] = useState(defaultSearchParams);

const listQuery = useXxxList({
  page, pageSize,
  keyword: submittedParams.keyword || undefined,
  status: submittedParams.status || undefined,
});

function handleSearch() {
  setPage(1);
  setSubmittedParams(draftParams);
  void queryClient.invalidateQueries({ queryKey: xxxKeys.lists });
}

function handleReset() {
  setPage(1);
  setDraftParams(defaultSearchParams);
  setSubmittedParams(defaultSearchParams);
  void queryClient.invalidateQueries({ queryKey: xxxKeys.lists });
}
```

::: warning 查询必回源
`handleSearch` / `handleReset` 中的 `invalidateQueries` **不可省略**：条件未变化时 query key 不变，数据在 `staleTime` 内被视为新鲜将不发请求；而本系统「查询」按钮兼具刷新语义，必须强制回源。非分页的树/列表页同理（失效该页主查询的前缀 key）。
:::

表格接线：

```tsx
<ConfigurableTable
  bordered
  dataSource={listQuery.data?.list ?? []}
  loading={listQuery.isFetching}
  onRefresh={() => void listQuery.refetch()}
  refreshLoading={listQuery.isFetching}
  pagination={buildPagination(listQuery.data?.total ?? 0)}   // 翻页由 key 驱动，无需回调
/>
```

## 弹窗 / 抽屉懒加载

用 `enabled` 门控 + 行数据回退，打开时才请求，30s 内重开命中缓存秒开：

```tsx
const [editingRecord, setEditingRecord] = useState<Xxx | null>(null);
const detailQuery = useXxxDetail(editingRecord?.id, modalVisible);
const editing = editingRecord ? (detailQuery.data ?? editingRecord) : null;

// 交互态从查询数据播种（如授权勾选）
useEffect(() => {
  if (modalVisible) setCheckedIds(detailQuery.data?.menuIds ?? []);
}, [modalVisible, detailQuery.data]);
```

::: tip enabled 门控与 isPending
`enabled: false` 时 `isPending` 恒为 `true`。整页级 loading 判断必须写成 `(!!id && query.isPending)`，否则「新建模式」（无 id）会永久停留在 Spin。
:::

弹窗提交沿用 AppModal 契约：`await mutation.mutateAsync(...)` 失败抛 `ApiError` → 弹窗保持打开；成功后 Toast + 关闭。行级 pending（如状态 Switch）用专用 mutation 实例派生：`mutation.isPending ? mutation.variables?.id : null`，不再用 useState。

## 轮询与上传

- **轮询**：`refetchInterval: 5000`；条件轮询用函数形式 `refetchInterval: (query) => hasRunning(query.state.data) ? 5000 : false`。禁止手写 `setInterval` 拉数据（倒计时、轮播等纯 UI 定时器不受限）。
- **上传进度**：`request.postForm(url, formData, { onProgress })` 包进 `mutationFn`，参数形如 `{ formData, onProgress }`。

## 会员端（member SPA）

`src/member/` 是独立入口，使用独立的 `memberQueryClient`（`member/lib/member-query.ts`，默认配置与后台一致）和 `memberRequest` 传输层；域 hooks 集中在 `member/hooks/queries.ts`，`unwrap` / `toQueryString` 从 `@/lib/query` 复用。会员退出登录时清空 `memberQueryClient` 缓存。移动端加载更多列表使用 `useInfiniteQuery`。

## 不走 TanStack Query 的场景

以下场景保持原有实现，不强行套用：

- **WebSocket / SSE / 流式**：聊天消息流、进程 SSE 监控、xterm 终端、docker 日志跟随、AI 流式回复
- **一次性动作**：`request.download` 文件下载、验密（`skipAuth`）、网络诊断类单发操作（建模为 mutation 或直接调用均可）
- **与命令式组件深度耦合的数据流**：如 db-admin 表格浏览的 `useTableRowsInfinite`（与 DataGrid 虚拟滚动/undo-redo 耦合）
