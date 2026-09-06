# 打包与首屏性能

前端产物的分层规则、启动链路、度量口径与 CI 门禁。改任何会进入首屏的东西（新增页面文件、引入重库、
改启动请求、调分包）之前先读本文；对应的硬约束见
[constraints-frontend.md → 打包与首屏性能](https://github.com/iwangbowen/zenith-admin/blob/master/.agents/skills/zenith/references/constraints-frontend.md#打包与首屏性能)。

## 度量口径

所有数字都来自 `packages/web/scripts/bundle-analyze.mjs`，沿 HTML 入口的**静态 import 图**计算，与浏览器实际的
modulepreload 行为一致：

| 指标 | 含义 |
| --- | --- |
| critical（关键路径） | 从入口 `<script type="module">` 出发、只沿静态 `import` 可达的 JS 集合 + HTML 引用的样式表。首帧前必须全部下载并求值 |
| incremental(X) | 某个懒加载 chunk（如 `AdminLayout`、`DashboardPage`）出发的静态闭包，排除已在 critical 中的文件。同一入口下不同路由的 incremental 相互重叠 |
| 认证首屏 | critical ∪ incremental(AdminLayout) ∪ incremental(DashboardPage)：已登录用户刷新到看见仪表盘所需的全部 JS |
| 体积 | raw = 产物字节；gz = zlib gzip level 6；br = brotli quality 11 |
| 动态入口数 | 页面注册表 `import.meta.glob` 产生的动态 import 目标数 |

lucide 图标全表（615 KB / 153 KB gz）在任何口径下都是运行时按需拉取的独立 chunk，不计入上表。

## 构建编排

`npm run build -w @zenith/web` = `tsc -b` + `scripts/build.mjs`：

1. 三个入口各自独立 `vite build`（环境变量 `ZENITH_WEB_ENTRY=main|member|approval`），JS chunk 写入同一 `dist/` 的不同 `assetsDir`
   （`assets/`、`assets-member/`、`assets-approval/`），只有 main 清空目录；静态资源（字体 / wasm / 图片 / CSS）三个入口共用 `assets/`
   （`output.assetFileNames`）——文件名含内容 hash，相同内容在各入口构建中得到同名文件，落到同一目录即天然去重；
2. `scripts/precompress.mjs` 用 worker 线程为 ≥ 1 KB 的文本资源生成 `.gz`（level 9）与 `.br`（quality 11），供 nginx `gzip_static` / `brotli_static` 直接下发。

分入口构建的原因：rolldown 的 `$initial` 标签取「任一用户入口静态可达」的并集，三入口共建时后台关键路径会混入会员 / 审批入口的模块，
并且每个共享模块的「入口集合」都掺进几十个懒加载页面，关键路径无法收敛为少数几个 chunk。三个入口面向三类用户，跨入口共享 chunk 的收益≈0。
未设置 `ZENITH_WEB_ENTRY` 时仍是三入口共建（dev server 与直接 `vite build` 可用），但产物结构不满足预算。

分入口构建的代价：任何被多个入口触达的模块都会在各入口产物中各输出一份。因此**非后台入口绝不能触达后台页面注册表**
（`utils/page-registry.ts` 的 `import.meta.glob('../pages/**/*Page.tsx')`）：glob 在构建期按模块展开，引用它的入口会把几百个后台页面 chunk
及其重依赖全部打进自己的 `assetsDir`。工作流自定义业务表单单独收在 `utils/business-form-registry.ts`（`pages/biz/**`、`*BusinessForm.tsx`、
`*ApprovalView.tsx`），`BusinessFormHost` 与流程设计器只引用它；`bundle-budget.json` 的 `maxTotalJsChunks / maxTotalJsMB`
按入口 assetsDir 统计全部 JS（含按需加载）作为门禁——误引注册表时关键路径指标不变，但这两项会成倍增长。

## chunk 分层

`vite.config.ts` 的 `build.rollupOptions.output.codeSplitting.groups`（rolldown 原生分组，指派是权威的），按优先级从高到低：

| 层 | chunk | 收什么 | 何时加载 |
| --- | --- | --- | --- |
| 运行时 | `vite-runtime` | Vite preload helper 等虚拟模块 | 入口 |
| 运行时 | `vendor-react-core` | react / react-dom / scheduler | 入口 |
| 页面层 | `vendor-<lib>`（`HEAVY_LIBRARIES`） | univerjs、monaco、xterm、visactor、maplibre、mermaid、d3、embedpdf、wangeditor、rrweb、emoji、heic2any、exceljs、file-viewer、xyflow、lottie、lunar、sql-formatter、pinyin、unicode-regex、semi-illustrations、semi-json-viewer | 使用它的页面 |
| 关键路径层 | `initial-vendor` / `initial-app` | 入口静态闭包内的全部第三方 / 应用模块（tags `$initial`） | 入口 |
| 壳层 | `vendor-semi-markdown` | Semi aiChatDialogue / aiChatInput / chat / markdownRender / codeHighlight / jsonViewer + prismjs | 使用它的页面 |
| 壳层 | `vendor-semi-media` | Semi lottie / videoPlayer / audioPlayer | 使用它的页面 |
| 壳层 | `vendor-semi` | 其余全部 Semi（semi-ui / semi-foundation / semi-icons / semi-animation） | 登录后 |
| 壳层 | `vendor-common` | 被 ≥ 10 个模块共享的 node_modules | 登录后 |
| 壳层 | `app-shared` | 被 ≥ 10 个模块共享的 `hooks/` `lib/` `utils/` `providers/` `config/` + `@zenith/shared` + analytics-sdk 源码 | 登录后 |
| 页面层 | `vendor~A~B~…` | 其余第三方，按「消费页面集合」精确分组（`entriesAware`，不侧向合并） | 使用它的页面 |
| 页面层 | 页面 chunk | 页面注册表的每个动态入口及其独占模块 | 路由命中 |

### 分层为什么安全

- **关键路径层对 import 封闭**：闭包内模块的依赖必然也在闭包内，不会与任何其它 chunk 成环；也不按「哪些页面用到」再拆——它们在任何页面运行前都已加载，拆出来只会制造请求。
- **Semi 核心只有一个 chunk**：Semi 内部 `button ↔ iconButton`、`form ↔ 各控件` 等强连通分量全部留在 chunk 内；Semi 只被外部单向引用，不会形成跨 chunk 环。
  拆出去的 markdown / media 两组只单向依赖核心（`upload` 引用 `cropper`、`image` 被多处引用，所以它们留在核心；`videoPlayer` 引用 `audioPlayer` / `audioSlider`，所以三者同组）。
- **公共层只收纯逻辑**：`APP_SHARED_LOGIC` 只匹配 `hooks/` `lib/` `utils/` `providers/` `config/` 与 shared / analytics-sdk。组件一旦进入公共层会把图表 / 编辑器等重型依赖静态拖进壳层，
  例如图表主题必须放在 `components/charts/vchart-theme.ts`，放 `lib/` 会让 `AdminLayout` 多下载 2 MB 的 vchart。
- **重库各自独立**：判定为单库 > 150 KB 且内部无对 Semi / 应用代码的反向依赖；d3 单列一组供 xyflow / vchart / mermaid 共享。

### 禁止的分包手法

以下写法都会让构建 `exit 0` 但产物退化或运行时白屏，任何分包改动必须同时通过 `check:bundle` 与 `smoke`：

| 手法 | 后果 |
| --- | --- |
| `entriesAwareMergeThreshold` / `minSize` 回落 | 把消费方不同的子组合并，邻组的静态依赖（图表 / 编辑器）被一并拖进消费方，登录页多出 3 MB |
| `strictExecutionOrder: true` | 模块包装器给 chunk 图加边，关键路径层因一个 init 包装器引用整个公共层 |
| 把 Semi 按组件拆散或与 semi-foundation 分开 | 跨 chunk 环 → TDZ（`reading 'PREFIX'`）白屏 |
| 把 prismjs 与 Semi codeHighlight 分开 | 语言组件依赖 core 先设置全局 `Prism`，跨 chunk 后求值顺序丢失（`Prism is not defined`） |
| 含组件的 commons 组 | 组件的重型依赖随之进入壳层（见「公共层只收纯逻辑」） |
| 三入口共建 | `$initial` 取并集，关键路径无法收敛 |

## 启动链路

```text
匿名：index.html → 5 个 JS（运行时 ×3 + initial-vendor + initial-app）→ 登录页（静态打包，无额外请求）

已登录（含刷新）：
  index.html → 5 个 JS
      ├─ AuthProvider：GET /api/auth/me
      └─ prefetchAdminShell()（lib/shell-prefetch.ts，与 /me 并行）
            ├─ prewarmLucideIcons()             图标全表
            ├─ import() AdminLayout / DashboardPage   壳层 chunk
            ├─ prefetchQuery GET /api/menus/user      当前用户菜单树
            └─ prefetchQuery GET /api/settings/me     个人设置
  /me 返回 → AdminRouteLoader 只等 useCurrentUserMenuTree → 注册动态路由 → 仪表盘
```

- 登录页静态进入关键路径：匿名首屏 5 个请求；Semi Form 家族因此在 `initial-vendor` 中，已登录用户无论如何都需要它。
- 完整菜单树（`GET /api/menus`，1,100+ 行）只由 catch-all 的 `NotFoundOrForbidden` 在命中时自行拉取，不在启动链路上。
- 行为采集 SDK 由 `lib/tracker-boot.ts` 在 idle 时初始化，不阻塞首屏。
- MSW 只在 `VITE_DEMO_MODE=true` 时经入口的 `await import('./mocks')` 进入产物。
- 按名称渲染图标统一走 `components/DynamicIcon.tsx`（`DynamicIcon`）或 `utils/icons.tsx`（`renderLucideIcon`）：图标名来自数据（菜单、工作流模板、表单配置…），
  静态摇树无法覆盖，因此全表作为独立 chunk 在启动时并行预热，之后任意位置按名渲染都不再产生网络请求；页面里静态已知的图标继续按名具名 `import`。
- `@douyinfe/semi-illustrations`（130 KB）一律 `lazy(() => import(...))` + `Suspense`；偏好设置面板正文 `layouts/admin/PreferencesSheetBody.tsx` 在 SideSheet 首次打开时才加载。

## 页面注册表

只有 `pages/**/*Page.tsx`、`pages/biz/**`、`*BusinessForm.tsx`、`*ApprovalView.tsx` 进入注册表并成为动态入口，
每个入口都在注册表里携带一份预载依赖表（`__vite__mapDeps`），入口数与 chunk 数共同决定注册表体积。命名规则与解析细节见
[路由与菜单 → 菜单 component 字段与页面注册表](./routing.md#菜单-component-字段与页面注册表)。

## 交付层

nginx 侧的 `gzip_static`、HTML `no-cache`、静态资源一年 immutable 与 HTTP/2 要求见 [Docker 部署 → Nginx 行为](../guide/docker.md#nginx-行为)
与 [部署说明 → Nginx 配置要点](../guide/deployment.md#_2-nginx-配置要点)。

## 度量与守卫

| 命令（`packages/web`） | 作用 | 需要 |
| --- | --- | --- |
| `npm run analyze:bundle` | 文本报告；`-- --json out.json --md out.md` 落盘；`-- --dist <dir>` 指定产物 | 已构建的 `dist/` |
| `npm run check:bundle` | 按 `bundle-budget.json` 检查，超限 exit 1（CI `Bundle budget` 步骤） | 已构建的 `dist/` |
| `npm run smoke` | 自起 `vite preview` 用系统 Chrome 真实启动三个入口 + 登录 → 仪表盘 → 用户管理，控制台错误 / 错误边界即失败（CI `smoke` job 基于 demo 产物）。`-- --url <url> --no-serve` 复用已有服务 | 系统 Chrome；非 demo 产物需要可用的 API |
| `npm run bench:runtime` | 冷缓存首屏基准：匿名 `/login` 与已登录 `/` 的请求数 / 字节 / 可交互 / LCP，取多次中位数；`-- --latency 50 --download 10` 经 CDP 注入网络条件；`-- --json out.json` 落盘 | 另一终端 `npm run preview`；API 可用 |

`bundle-budget.json` 的阈值 = 当前实测留约 10% 余量。分包改动或新增首屏依赖导致超限时，先证明必要性再上调，并同步更新下方记录表。

## 基准记录

测量条件：Windows 11 / Node 24 / Chrome（Playwright `channel: chrome`，headless）；产物由 `vite preview` 托管（HTTP/1.1、无压缩），
`/api` 代理到本机开发 API；运行时指标为 3 次冷缓存中位数；限速档为 CDP 注入 50 ms RTT / 10 Mbps。
原始数据在 [`docs/frontend/perf/`](https://github.com/iwangbowen/zenith-admin/tree/master/docs/frontend/perf)
（`baseline-*` 取自 `fe5c8e628`，`current-*` 为当前分层）。

### 产物（静态口径）

| 指标 | 基线 | 当前 |
| --- | --- | --- |
| 后台 critical JS | 85 个 / 368.7 KB gz | 5 个 / 469.8 KB gz |
| 后台 critical CSS | 14 个 / 20.6 KB gz | 2 个 / 53.4 KB gz |
| 后台 modulepreload 提示 | 84 | 0 |
| 登录页 incremental | 91 个 / 255.4 KB gz | 0（静态在关键路径内） |
| 匿名首屏合计（critical + 登录页） | 176 个 / 624.1 KB gz | 5 个 / 469.8 KB gz |
| incremental(AdminLayout) | 154 个 / 379.1 KB gz | 29 个 / 402.2 KB gz |
| incremental(DashboardPage) | 79 个 / 165.7 KB gz | 16 个 / 370.2 KB gz |
| 认证首屏（并集） | 278 个 / 843.0 KB gz | 44 个 / 896.2 KB gz |
| 会员端 critical | 94 个 / 329.9 KB gz | 5 个 / 237.5 KB gz |
| 审批端 critical | 55 个 / 258.3 KB gz | 5 个 / 191.6 KB gz |
| 注册表动态入口 | 544 | 276 |
| JS chunk 总数（其中 < 4 KB） | 1,711（922） | 1,542（764） |
| dist JS 总量 | 38.5 MB | 75.8 MB |

认证首屏的 gz 体积 +6%（Semi 核心整包、公共层一次装载）换来文件数 −84%。上表「dist JS 总量」翻倍来自审批入口独立构建时
复制了一份页面注册表（`BusinessFormHost` 曾复用 `lazyPageComponent`），v2.20.1 起注册表拆分、静态资源跨入口共用后，
dist JS 总量 53.1 MB / 904 个 chunk，发布 zip 由 94.3 MB 回落到约 60 MB（其余高于 v2.19 的部分为 `.gz/.br` 预压缩产物与各入口独立的按需 chunk）。

### 运行时（冷缓存中位数）

| 链路 | 指标 | 基线 | 当前 |
| --- | --- | --- | --- |
| 匿名 `/login` | 请求数 | 230 | 17 |
| | 传输（其中 JS） | 784 KB（690） | 542 KB（482） |
| | 可交互 / LCP | 2,214 ms / 2,064 ms | 633 ms / 580 ms |
| | 可交互 @50 ms RTT · 10 Mbps | 3,818 ms | 1,303 ms |
| 已登录 `/` → 仪表盘 | 请求数 | 412 | 89 |
| | 传输（其中 JS） | 2,042 KB（1,871） | 1,955 KB（1,842） |
| | 可交互 / LCP | 2,809 ms / 3,232 ms | 1,310 ms / 1,176 ms |
| | 可交互 / LCP @50 ms RTT · 10 Mbps | 5,888 ms / 6,124 ms | 2,363 ms / 2,356 ms |

两条链路的控制台错误均为 0。仪表盘链路的 JS 字节几乎不变而耗时减半：收益来自请求数（−78%）与串行等待的消除，而非字节数。
