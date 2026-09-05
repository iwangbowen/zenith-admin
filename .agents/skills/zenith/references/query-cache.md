# 前端数据获取与缓存一致性契约

前端服务端状态统一由 **TanStack Query v5** 管理。写域 hooks 或决定失效策略前先读本文件；
硬约束条目见 [constraints-frontend.md → 缓存与 query key](./constraints-frontend.md#缓存与-query-key)，
代码模板见 [crud-frontend.md](./crud-frontend.md)。

---

## 分层

- **契约层**：`@zenith/shared/{域}` 的 `xxxContract`——路径、入参与响应形状的唯一来源
- **传输层**：`utils/request.ts`（token 刷新、401/429/503 处理、错误 Toast）
- **契约调用层**：`lib/contract-query.ts`（`api()` / `apiRaw()` / `apiQueryOptions()` / `useApiQuery()` / `useApiMutation()` /
  `createResourceQueries()`），基建在 `lib/query.ts`（`queryClient`、`unwrap()`、`toQueryString()`、`LOOKUP_STALE_TIME`）
- **服务端状态层**：`hooks/queries/<域>.ts` 域 hooks + 页面内 `useQuery` / `useMutation`

核心约定：

1. 所有请求经契约发起：`api(op, input)` 构造 URL、发送并 `unwrap`（`code !== 0` 抛 `ApiError`，request 层已自动 Toast）；
   需要信封 `message` / 非零 `code` 分支时用 `apiRaw(op, input)`；域 hooks 与页面不出现 `/api/...` 字面量
2. 每个域文件导出 keys 常量对象（`createResourceQueries().keys`），至少含 `all` / `lists` / `list(params)` / `detail(id)`；
   单操作查询的 key 由 `contractKey(op, input)` 生成：`[资源键, 操作名, input]`
3. 分页列表查询必须 `placeholderData: keepPreviousData`（翻页不闪白屏）
4. **查询 / 重置必回源**：列表页统一用 `useListSearch`，它把 draft/submitted 双状态、页码重置与
   `invalidateQueries` 焊在一处。条件未变化时 query key 不变，不失效则 staleTime 内不发请求，
   而本系统「查询」按钮兼具刷新语义
5. **mutation 按副作用精确失效**（见下文），成功 Toast 留在页面代码
6. 下拉源等低频 lookup 用 `staleTime: LOOKUP_STALE_TIME`（5 分钟），全局共享缓存
7. 轮询用 `refetchInterval`（毫秒），条件轮询用函数形式
   `refetchInterval: (query) => hasRunning(query.state.data) ? 5000 : false`
8. 一次性动作（`request.download`、验密、诊断类）可直接调用；WebSocket / SSE / xterm 流式逻辑不走 TanStack Query

---

## 缓存一致性契约

`invalidateQueries` 把所有匹配 key 标脏，但**默认只立即重拉活跃（已挂载）的查询**
（query-core：`type: refetchType ?? type ?? 'active'`）。由此得出两条推论：

- 失效一个**未挂载**的缓存代价接近零，只是标脏，等下次挂载再回源——该失效就失效，
  不要因为「怕多发请求」而漏掉；
- 真正的浪费是失效那些**与本次改动无关、却正好同屏挂载**的查询（尤其是 5 分钟 staleTime 的 lookup）。

因此 `xxxKeys.all` 不是默认选项：它会把同根下的详情、统计、日志、下拉源一并打掉。

### 标准 CRUD 与手写 mutation 的边界

`createResourceQueries` 是标准 CRUD 的统一契约：保存后失效 `detail(id)`、`lists` 与（契约声明 `all` 时）`lookup`，
删除后移除详情并失效列表与 lookup。使用工厂的域不得自行改写这套行为。

下表用于**其余操作**（`useApiMutation(op, { invalidate })` 的 `invalidate` 回调，或页面内 `useMutation`）：

| mutation 形态 | 策略 |
| --- | --- |
| 手写更新，且写接口与详情接口**同源**（服务端同一个 `mapXxx`） | 可用 `setQueryData(detail(id), saved)` 回填 + 失效 `lists` |
| 手写更新，但接口返回 `okBody(null, msg)` 或只返回局部字段 | 失效 `detail(id)` + `lists` |
| 新增 | 失效 `lists` + 受影响的计数 / 下拉源 |
| 删除 | `removeQueries(detail(id))` + 失效 `lists` + 受影响的下拉源 |
| 子资源写入（成员 / 权限 / 菜单） | 失效该子键；**若列表渲染了该子资源的派生列（如 `userCount`），仍须失效 `lists`** |
| 命令 / 动作（执行、重跑、发布） | 按**真实副作用**失效；只有确认没有任何已挂载查询读取被改状态时才可不失效 |
| 批量覆盖、切租户、全量导入 | 允许 `.all`，但必须在代码注释里写明理由 |

### 落地要求

- **一律替换而非追加**：`xxxKeys.all` 是 `xxxKeys.detail(id)` 的前缀，写成 `.all` 后再补 `.detail(id)` 属于空转
- **删除用 `removeQueries` 而非 `invalidateQueries`**：实体已不存在，失效会让仍缓存的详情去请求一个必然 404 的资源
- **手写 mutation 回填前先确认数据形状与可见性**：只有写接口与详情接口同源时才能 `setQueryData`。
  以下四种情况**必须**改为失效 `detail(id)`：
  - 详情接口按查看者**脱敏**：写接口返回 `mapUser`（明文）、详情走 `mapUserWithMask`，
    回填会把未脱敏的手机号 / 邮箱写进本不该展示它们的界面
  - 详情比写接口**多出关联数据**：如公告的收件人、附件
  - 写接口**不回传**表单编辑过的关联字段：如角色写接口不带 `menuIds`，回填会清空菜单勾选
  - 列表 / 树额外注入了**聚合字段**：如部门树、`userCount` / `userPreview`，
    那是列表独有的，不要拿写接口响应覆盖列表缓存
- **改完必须过一遍消费页面**：确认没有依赖广播失效才会刷新的列或面板。欠失效（陈旧 UI）比多失效更危险
- 本节只约束手写 mutation 的 `onSuccess`，与上面第 4 条「查询 / 重置必回源」互不冲突

---

## key 结构设计

key 的树形结构直接决定失效的连坐面，按「哪些数据应当被同一个意图一起打掉」分组：

- **`all` 只能是本域自己的根**：写 `['report','dashboards']`，不是 `['report']`。
  `all` 若指向整个业务大域的根，域内任何一次广播都会波及同域其余十几个 key factory
- **独立生命周期的子资源另起命名空间**：群成员写成 `['chat','group-members',id]`，
  而不是 `['chat','conversations',id,'members']`——后者会让「刷新会话列表」因前缀匹配连带打掉
  每个会话的成员名单。只有确实随父实体一起失效的子资源才嵌套
- **为「意图」导出前缀键**：同一实体存在多变体查询时用前缀键让一次调用精确覆盖整组，
  如 `detailOf(id)`（覆盖 auto / draft / published 三种模式的详情）、`dataOf(id)`（某看板的全部取数）、
  `lookupPrefix`（本域全部下拉源）。既免于逐个列举变体，也免于为图省事退回 `.all`
- **静态 lookup 与高频写入的数据分处不同前缀**：`LOOKUP_STALE_TIME` 的下拉源、数据库元数据、
  组织架构等长期挂载，一旦与列表同根就会被每次增删改打回源
- **昂贵的派生查询单独成键**：一屏可扇出数十个数据集请求的看板取数、答卷聚合分析
  （stats / cross / trend）不可与列表共享前缀

---

## 下拉源必须归属所有者域

**禁止**用本域的 key 去拉别的域的资源（例如以 `announcementKeys.recipientOptions` 为键请求 `/api/roles/all`）。
这类「藏键」在所有者域（角色）增删改时没有任何来源会失效它，界面会静默显示旧列表。

一律复用所有者域导出的共享 lookup hook（`useAllRoles` / `useFlatDepartments` / `useAllUsers` /
`useAllPositions` / `useDictItems` 等）；需要组合成特定选项结构时，在本域 hook 里对这些 query 的结果
做 `useMemo` 派生，而不是另起一份请求。

---

## 失效行为的测试

域 hooks 的行为测试用 `test-utils/query-harness.ts`，断言必须落在**可观测行为**上：
实际请求数（`ApiRecorder`）、真正进入 fetching 的查询（`observeFetches`）、
缓存内容与新鲜度（`getCacheEntry` / `isFresh` / `hasCacheEntry`）。

**禁止**只 spy「调用了 `invalidateQueries(某个 key)`」——这类断言在「冗余的广播写法」和
「被改坏的精确写法」两种情况下都会通过，等于没测。

参考实现：`hooks/queries/positions.ts`（回填 + 子资源）、`hooks/queries/cron-jobs.ts`
（命令型副作用 + 静态 lookup 保护），对应测试同名 `.test.tsx`。

---

## 补充场景

- **弹窗内交互态从查询数据播种**（如授权勾选）：
  `useEffect(() => { if (visible) setCheckedIds(detailQuery.data?.menuIds ?? []); }, [visible, detailQuery.data]);`
- **上传进度**：`request.postForm(url, formData, { onProgress })` 包进 mutationFn，
  参数形如 `{ formData, onProgress }`（参考 `hooks/queries/users.ts` 的 import mutation）
- **enabled 门控查询的 loading 判断**：`enabled: false` 时 `isPending` 恒为 true，
  整页 loading 判断必须写成 `(!!id && query.isPending)`，否则新建模式会卡死在 Spin
- **member C 端 SPA**（`src/member/`）：使用独立 `memberQueryClient`（`member/lib/member-query.ts`）
  + `memberRequest` 传输层，hooks 位于 `member/hooks/queries.ts`，其余约定与后台一致
