# 调试与排错指南

按症状定位，修复方式指回对应规范。约束正文在 [constraints.md](./constraints.md)（后端与全局）与
[constraints-frontend.md](./constraints-frontend.md)（前端），本文件不复述规则。

| 症状分类 | 章节 |
| --- | --- |
| 迁移 / Swagger / 路由 404 | [后端结构](#后端结构) |
| 类型不匹配、共享包找不到、`z.enum` 崩溃 | [类型与共享包](#类型与共享包) |
| 分页 total、日期筛选、关键字搜索异常 | [数据库查询](#数据库查询) |
| 403、页面可见但请求被拒 | [权限](#权限) |
| 外呼流式响应 / SSE 约 5 分钟断开 | [外呼 HTTP](#外呼-http) |
| 数据不刷新、弹窗数据丢失、重复提示、表格列宽异常 | [前端缓存与表单](#前端缓存与表单) |
| MSW 不生效 | [Demo 模式](#demo-模式) |
| 测试超时、启动缓慢 | [性能](#性能) |

---

## 后端结构

### `npm run db:generate` 报 "Integrity constraint violation"

对已有数据的列做了不兼容修改（如给有数据的表加 NOT NULL 列）。
分三步：先设为 nullable 执行迁移 → 更新已有数据 → 再改为 NOT NULL。

### pgEnum 添加新值失败

PostgreSQL 的 `ALTER TYPE ADD VALUE` 只能追加到枚举末尾。
Drizzle 会自动处理；如需在中间插入，必须创建新枚举并迁移。

### 迁移文件已存在但 schema 有变化

删除 `packages/server/drizzle/` 下最新的迁移文件，重新 `npm run db:generate`。

### 新增路由后 `/api/docs` 不显示

1. 路由是否已在 `routes/{业务域}/index.ts` 中挂载？（挂载点是域 barrel，不是 `src/index.ts`）
2. 路由文件是否调用了 `xxxRouter.openapiRoutes([...] as const)`？
3. 是否重启了开发服务器？（热更新可能不生效）
4. 浏览器硬刷新（Ctrl+Shift+R）

### 实体在 Swagger Components 中重复或命名冲突

两个契约实体 schema 使用了相同的 `.meta({ id })`。组件名全局唯一，按「域 + 实体」命名（如 `CmsContent` / `WikiComment`）。

### 访问 `/api/xxx` 返回 404

1. 路由是否已挂载到 `routes/{业务域}/index.ts`？新增域是否已加进 `routes/index.ts` 的 `ROUTE_DOMAINS`？
2. 挂载是否写成 `[xxxContract.basePath, xxxRoutes]`，契约 `basePath` 是否正确？
3. 契约操作的 `path` 是否正确？（`/` 列表，`/{id}` 详情）
4. `openapiRoutes([...])` 是否包含了该路由？

### `DELETE /batch` 被匹配为 `DELETE /{id}`

注册顺序错误。`batchDeleteRoute` 必须排在 `deleteRouteDef` **之前**。

---

## 类型与共享包

### handler 的 `c.json(okBody(...))` 类型报错

service 返回值与契约实体 schema 不一致（字段名、可空性、缺字段）。以契约为准修正 `mapXxx()`，
或在 `shared/src/{业务域}/contracts/xxxs.ts` 修正 schema——前端类型随之更新，无需另改。
时间字段一律 `z.string()`（`YYYY-MM-DD HH:mm:ss`）。

### 前端 `api(op, input)` / `mutate(input)` 类型报错

输入形状必须是契约的 `{ params?, query?, body? }`：路径参数放 `params`、筛选条件放 `query`、请求体放 `body`。
筛选控件的 `string` 值交给按枚举声明的查询参数前用 `enumValueOf(XXX_VALUES, value)` 收窄。

### `api-conformance.test.ts` 报某个 URL 不在服务端路由表

仍以字面量书写的请求路径与服务端不一致（线上会 404）。优先把该调用改为契约驱动；服务端确实缺少端点时，
补齐契约与路由，或在 `api-conformance.allowlist.ts` 登记并写明原因。

### 请求参数类型报错

检查 `shared/src/{业务域}/validation.ts` 的 schema 定义，确认前端 payload 与 `CreateXxxInput` 匹配。
注意 `z.coerce.number()` 与 `z.number()` 的区别（前者自动转换字符串）。

### 共享包类型找不到

`@zenith/shared` 只暴露各业务域子路径与 `/seed`，根入口被 ESLint 禁用。

1. 导入写法须为 `import type { Xxx } from '@zenith/shared/{业务域}'`
2. 确认符号确实在该域：`shared/src/{业务域}/{contracts/,types,validation,constants}.ts`
3. 新增业务域必须同时做三件事，缺一会报模块找不到：建域 `index.ts` 并 re-export、
   在 `shared/package.json` 的 `exports` 中登记、域 `index.ts` **不得**导出 seed

### `z.enum(...)` 报 "Cannot convert undefined or null to object"

ESM 值环导致 TDZ：某域 `validation.ts` 引用了另一域 `validation.ts` 的常量数组且互相引用，
初始化期取到 `undefined`。

把被跨域 `z.enum()` 引用的常量数组上移到所属域的 `constants.ts`（枚举 SSOT），
`validation.ts` 只做 `z.enum(XXX_TYPES)` 引用。定位环路可用
`npx madge --circular --extensions ts packages/shared/src`——注意它不区分 `import` 与 `import type`，
只有**值**导入构成的环才会崩溃，`import type` 形成的环编译后被擦除，可忽略。

### `npm run build` 失败

看错误中的文件路径与行号。常见原因：导入路径层级不对、service 返回值与契约实体不一致、
契约实体漏写 `.meta({ id })`（Swagger 中显示为内联 schema）。用 `npm run dev:server` / `npm run dev:web` 可获得更详细的实时错误。

---

## 数据库查询

### 分页 total 不正确

1. 是否用了 `db.$count(table, where)` 而非 `count()`？
2. count 与 list 的 `where` 条件是否一致？
3. 有 dataScope / tenantScope 过滤时，count 查询是否也应用了相同条件？

### 按日期筛选查不到当天数据

**症状**：时间范围选到「今天」列表却少了今天的记录；起止选同一天时结果为空。

范围末端用了 `parseDateTimeInput`——它把 `2026-08-01` 解析成 `00:00:00`，
`lte(col, 2026-08-01 00:00:00)` 排除掉当天绝大部分数据。

改用 `dateRangeConditions(column, start, end)`（`lib/where-helpers`），
内部走 `parseDateRangeStart` / `parseDateRangeEnd`，末端取当天 `23:59:59.999`。

### 传了非法时间参数却返回全量数据

**症状**：`?endTime=abc` 或 `?endTime=2026/08/01` 不报错，返回未经筛选的全量列表。

查询参数声明成了裸 `z.string().optional()`，Zod 放行后解析函数返回 `null`，条件被静默丢弃。
改用 `dateRangeBound('说明')`（`@zenith/shared/core`），非法输入直接 400。

### 关键字搜索把 `%` 当通配符 / 搜不到含下划线的内容

手写 `like(col, '%${keyword}%')` 未转义 LIKE 元字符。
用户输入参与 LIKE / ILIKE 一律走 `keywordCondition(keyword, [colA, colB], mode?, match?)`，
内部已 trim、判空并转义 `%`、`_`、`\`；列参数可传裸列或 SQL 表达式。

### RQB 关联查询返回 null

1. `db/schema/relations.ts` 中是否已声明 `xxxRelations`？
2. `db` 实例创建时是否传入了 `schema`？
3. `with:` 中的关联名是否与 relations 中定义的一致？

---

## 权限

### 403 Forbidden

1. 当前用户角色是否有对应权限码？权限码全部来自**按钮型菜单节点**，
   仅分配页面菜单不会获得任何权限码（含查询）
2. `guard({ permission: '...' })` 的权限码是否与按钮节点定义的 `permission` 一致？
3. 超管角色自动跳过权限检查

### 页面可见但列表请求 403

角色只分配了页面菜单，没有分配其「查询」按钮。
在角色授权面板重新勾选该页面（会自动带上「查询」按钮），或单独勾选「查询」按钮。

### 按钮显示了但无权限操作

前端没有用 `hasPermission()` 控制按钮显示。

---

## 外呼 HTTP

### 消费外部 SSE / 流式响应约 5 分钟整点断开（`TypeError: terminated`）

根因是 undici 的 `bodyTimeout`（body 字节之间的空闲超时，默认 300s），机理与接入原则见
[backend-patterns.md → 流式 / SSE 消费注意事项](./backend-patterns.md#流式--sse-消费注意事项)；
入站方向 nginx `proxy_read_timeout 300s`（`docker/nginx.conf`）同样会断开静默 SSE。

按场景处置：

- 上游有心跳（间隔 < 5 分钟，如 LLM 流式 API 的 ping 事件）→ 无需处理，默认即安全
- 长期消费可能静默的外部流 → 断线重连做主体 + 事件幂等，`bodyTimeout` 保留有限值当死链探测
- 误给流式调用设了 `httpRequest` 的 `timeout` → 它是硬超时，会掐断进行中的流，改回默认 `0`

### 上游明明可用，新请求却立即报「熔断」

http-client 按 host 熔断：连续 5 次失败后 30 秒内新请求直接拒绝（fail fast），30 秒后自动放行探测。
只拦截新发起的请求，不影响已建立的连接与流。等待冷却结束即可，测试中可用 `resetHttpCircuitBreakers()` 清态。

---

## 前端缓存与表单

### 操作成功后页面数据没刷新

**欠失效**——被改动的状态有已挂载的查询在读，但 `onSuccess` 没覆盖到它。典型场景：

- 命令型接口只返回一句提示，实际却改写了 `lastRun`、写了执行日志、变更了概览统计
- 子资源写入（分配成员 / 角色）改变了列表的派生列（`userCount` / `userPreview`），却只失效了子键
- 下拉源以本域 key 请求了别域资源（藏键），所有者域改动时无人失效它

按「有没有已挂载的查询读了这次被改动的状态」逐一补齐失效；藏键改为复用所有者域的共享 lookup hook。
失效**未挂载**的缓存代价接近零，宁可多列几个 key，也不要漏。见
[query-cache.md → 缓存一致性契约](./query-cache.md#缓存一致性契约)。

### 改一条数据，整屏查询全部重拉

失效面过大。常见于 `xxxKeys.all` 指向整个业务大域的根、静态 lookup 与列表同前缀、
昂贵派生取数（看板数据、聚合分析）与列表同根。

按 [query-cache.md → key 结构设计](./query-cache.md#key-结构设计)重新划分命名空间，
把 `onSuccess` 收敛到具体前缀键；用 `test-utils/query-harness.ts` 的 `observeFetches`
断言实际进入 fetching 的查询数量。

### 保存后详情显示异常（菜单勾选被清空 / 出现不该显示的明文字段）

手写 mutation 用 `setQueryData(detail(id), saved)` 回填了与详情接口**形状或可见性不一致**的写接口响应。
改为 `invalidateQueries({ queryKey: xxxKeys.detail(id) })`。
四种禁止回填的情形见 [query-cache.md → 落地要求](./query-cache.md#落地要求)。

### 编辑弹窗打开后详情数据进不了表单

**症状**：列表行的字段显示正常，但详情接口独有的字段是空的；保存后这些字段被静默清空。

Semi 的 `initValues` 只在 `Form` **挂载时**读取一次。弹窗打开瞬间详情还没回来，表单先拿列表行占位；
详情到达后记录 id 没变，若 `key` 只含 id（`key={record.id}`）React 不会重挂载，详情永远进不了表单。
列表与详情恰好返回同一组字段时该缺陷不会暴露，直到详情多出一个字段。

改用 `hooks/useEditModal.ts` 并展开 `formProps`——它的 `key` 由 `${id}:${详情是否已到达}` 派生。
确有正当理由自持表单实例时，`key` 直接调用同一个 `formRemountKey(id, detail)`，不要手写模板串。

### 校验没过时弹出两个提示，其中一个是「操作失败：xxx」

用抛裸 `Error` 的方式中断了提交。`useGlobalErrorHandler` 只放行 `ApiError`、`SubmitAborted`
与单词消息的裸 `Error`；`throw new Error('empty content')`（带空格）、`'save-failed'`（带连字符）
会被当成真实故障：弹兜底 Toast + 上报错误监控。Semi 的 Modal 不吞 `onOk` 的拒绝，
自定义 footer 里 `void modal.modalProps.onOk()` 更是直接落到 window。

先给出面向用户的提示，再调用 `@/lib/abort-submit` 的 `abortSubmit()`；
不要改成 `return`——那样 Semi 的确定按钮会一直转圈。

```ts
beforeSave: (values) => {
  if (!contentHtml) {
    Toast.warning('请输入公告内容');  // 面向用户的提示由调用方负责
    abortSubmit();                    // 中断提交，不弹兜底 Toast、不上报
  }
  return { ...values, content: contentHtml };
}
```

> 反过来也要留意：**真实的不变量违反不要用 `abortSubmit()` 吞掉**。
> 「编辑态却没有 id」这类本不该发生的情况应当继续抛 `Error` 并被上报，
> 只需把消息写成用户看得懂的中文。

### 操作列被拉得很宽 / 表格横向溢出 / 表头与行错位

三种症状同一根因：列定义不符合「一个弹性主列 + 其余固定宽」约定
（[constraints-frontend.md → 搜索栏与表格](./constraints-frontend.md#搜索栏与表格)）。

- 操作列比配置值宽、每列都被均匀拉宽：所有列都写了 `width`，Semi 的 `table-layout: fixed` 把余量按比例摊给每列。
  开发期控制台会有 `[ConfigurableTable] … 已自动放开「xx」列` 告警——给主列改 `minWidth`、去掉 `width`
- 表格右侧出现横向滚动、表头与行不对齐：页面手写了 `scroll.x`（虚拟化表格尤其明显）。删掉即可，
  `ConfigurableTable` 按列宽之和自动推导；控制台的 `scroll.x … 已被忽略` 告警即指向此处
- 操作按钮贴边、挤压相邻状态列：`width` 小于内容宽，控制台有 `操作列内容宽 … 超过列内可用宽` 告警，
  按 [ui-patterns.md → 操作列](./ui-patterns.md#操作列) 的公式重算，或用 `desktopInlineKeys` 收纳低频动作

---

## Demo 模式

### 前端请求仍然打到真实后端

1. 确认 `VITE_DEMO_MODE=true`（检查 `packages/web/.env.demo` 或 `.env.development`）
2. 确认 `mocks/index.ts` 中的 `enableMocking()` 被调用
3. DevTools → Application → Service Workers，确认 MSW worker 已注册
4. 新 handler 是否在 `mocks/handlers/index.ts` 中注册？
5. 控制台是否有 MSW warning（如 "passthrough" 表示请求未被拦截）

### Mock 数据与 seed 数据不一致

mock 初始数据应从 `@zenith/shared/seed` 的 `SEED_XXXS` 派生，而非另写一份静态数组。

---

## 性能

### `npm test` 报超时，但单独跑那几个文件却能通过

耗时结构的根源是 vitest 的**隔离税**，而不是用例本身慢：`isolate: true` 下每个测试文件
都在全新 worker 里重新转译 + 重新执行自己那条模块图，累计 import 时间远大于断言时间。
装配整个 app 的重用例（`app.contract.test.ts`：一次装配同时喂给契约断言与路由表快照）本就贴近超时线，
CPU 被抢后直接撞破；普通秒级用例（exceljs 渲染、Semi 浮层交互）在发布流程四路并行下也会被成倍放大。

**据此与真 bug 区分**：失败全是**超时**而非断言失败；单独跑同样的文件能过；
`Duration` 里 transform / import 累计远大于墙钟。

按症状出现的场景调对应旋钮（取值以配置文件为准，理由见文件内注释）：

| 场景 | 旋钮 |
| --- | --- |
| 单独跑 `npm test` 就超时 | 调低两包 `vitest.config.ts` 的 `maxWorkers`——它是**上限**不是目标值，核数少的机器不受影响 |
| 只在发布流程的四路并行下超时 | 放宽两包 `vitest.config.ts` 的 `testTimeout`，或 `src/app.contract.test.ts` `beforeAll` 的超时——它们与 lint / build / docs 争抢同一种（转译 + CPU）资源 |
| web 全量明显变慢 | 确认 `packages/web/vitest.config.ts` 的 `deps.optimizer.web` 还在：Semi 的 CJS 里 require CSS，走不了原生加载，只能靠 esbuild 预打包（缓存于 `node_modules/.vite/deps`） |

放宽超时前先确认它属于「慢但有效」——独占跑能过、且失败是超时而非断言失败；
真卡死（如顶层 await 死锁）仍应快速失败。不要把发布流程的四路并行改成串行（单独跑 `npm test` 同样会超时，
外层并行不是根因），也不要改 `pool` / `isolate` 换速度——两份 `vitest.config.ts` 的注释写明了原因。

### 测试输出出现真实的 `[Redis] 连接成功` / worker 退出期 unhandled rejection

`lib/redis` 在模块加载时就 `connect()`，任何测试文件传递依赖摸到它就会向本机发真实 TCP。
由 `packages/server/src/test-setup.ts`（vitest `setupFiles`）全局替换为
`test-utils/redis-stub.ts` 的内存替身；单个文件仍可用自己的 `vi.mock('../lib/redis', ...)`
覆盖。若再看到真实连接日志，先确认 setupFiles 配置未被移除。

### `npm run dev:server` 冷启动明显变慢

某模块把重型 SDK（exceljs、sharp、cheerio、云厂商 SDK 等）写成了顶层静态 import，
被计入每次启动的模块图加载。

**定位**：`cd packages/server && npx tsx -e` 计时 `import('./src/app')`，
或对可疑包运行 `node -e "console.time('t');require('pkg');console.timeEnd('t')"`。

**解决**：改为 `createRequire` 惰性加载 + `import type`。禁用清单见
[constraints.md → 重型依赖懒加载](./constraints.md#重型依赖懒加载server)，
写法模板见 [backend-patterns.md → 重型依赖懒加载](./backend-patterns.md#重型依赖懒加载)。

### 某功能首次调用报 `require is not defined`

ESM 模块中使用了裸 `require()`。文件顶部加
`const require = createRequire(import.meta.url)`（来自 `node:module`）后再调用。
