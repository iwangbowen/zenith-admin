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

1. 入口清单唯一来源是 `packages/web/entries.json`（`vite.config.ts`、`scripts/build.mjs`、`scripts/bundle-analyze.mjs` 共同读取）。
   各入口各自独立 `vite build`（环境变量 `ZENITH_WEB_ENTRY=<entry>`），JS chunk 写入同一 `dist/` 的各自 `assetsDir`
   （`assets/`、`assets-member/`、`assets-approval/`），清单中第一个入口负责清空目录；静态资源（字体 / wasm / 图片 / CSS）各入口共用 `assets/`
   （`output.assetFileNames`）——文件名含内容 hash，相同内容在各入口构建中得到同名文件，落到同一目录即只保留一份；
2. `scripts/precompress.mjs` 用 worker 线程为 ≥ 1 KB 的文本资源生成 `.gz`（level 9）与 `.br`（quality 11），供 nginx `gzip_static` / `brotli_static` 直接下发。
   预压缩副本随 Docker 镜像一起构建，**不进 GitHub Release 的 web zip**（同一份 JS/CSS 的另一种编码、zip 无法再压缩）；
   手动部署时执行随包提供的 `node web/precompress.mjs web/dist` 生成。

新增入口：新建 `<input>.html` 与 `src/<entry>/main-*.tsx`，在 `entries.json` 加一行，跑一次 `npm run analyze:bundle` 后在 `bundle-budget.json`
补该入口预算（关键路径 + `maxTotalJsChunks / maxTotalJsMB`，实测留 ~10% 余量），并在 `scripts/smoke.mjs` 补启动检查。

分入口构建的原因：rolldown 的 `$initial` 标签取「任一用户入口静态可达」的并集，多入口共建时后台关键路径会混入会员 / 审批入口的模块，
并且每个共享模块的「入口集合」都掺进几十个懒加载页面，关键路径无法收敛为少数几个 chunk。各入口面向不同用户群，跨入口共享 chunk 的收益≈0。
未设置 `ZENITH_WEB_ENTRY` 时仍是多入口共建（dev server 与直接 `vite build` 可用），但产物结构不满足预算。

分入口构建的代价：任何被多个入口触达的模块都会在各入口产物中各输出一份。因此**非后台入口不得触达后台页面注册表**
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
| 页面层 | `vendor-<lib>`（`HEAVY_LIBRARIES`） | univerjs、monaco、xterm、visactor、maplibre、mermaid、d3、embedpdf、wangeditor、rrweb、emoji、heic2any、exceljs、file-viewer 各包、xyflow、lottie、lunar、sql-formatter、pinyin、unicode-regex、semi-illustrations、semi-json-viewer | 使用它的页面 |
| 关键路径层 | `initial-vendor` / `initial-app` | 入口静态闭包内的全部第三方 / 应用模块（tags `$initial`） | 入口 |
| 壳层 | `vendor-semi-markdown` | Semi aiChatDialogue / aiChatInput / chat / markdownRender / codeHighlight / jsonViewer + prismjs | 使用它的页面 |
| 壳层 | `vendor-semi-media` | Semi lottie / videoPlayer / audioPlayer | 使用它的页面 |
| 壳层 | `vendor-semi-form` | Semi Form（BaseForm 静态引入全部字段控件）+ 只经 Form 使用的 Cascader / TreeSelect / Upload(+Cropper) / TagInput / AutoComplete / Transfer；`form/label`、Slider 与 semi-foundation 的 `form/*` 因被核心反向引用（`input/inputGroup`、`image/previewFooter`）留在 `vendor-semi` | 使用表单的页面 |
| 壳层 | `vendor-semi` | 其余全部 Semi（semi-ui / semi-foundation / semi-icons / semi-animation） | 登录后 |
| 页面层 | `vendor-approval-icons`（仅审批入口） | 不在入口静态闭包内的 lucide SVG 图标；优先级低于 `initial-vendor` | 首次使用相关页面或预热图标时 |
| 特性层 | `entity-discovery` | 统一搜索面板、对象关联与时间线 UI、查询契约和实体元数据 | 打开统一搜索或相关业务页面；快捷键触发器与纯缓存失效 helper 留在组外 |
| 壳层 | `vendor-common` | 被 ≥ 10 个模块共享的 node_modules | 登录后 |
| 壳层 | `shared-common` | 被 ≥ 10 个模块共享的 Shared 契约、常量与纯业务工具；不包含 Web hooks | 登录后 |
| 壳层 | `app-shared` | 被 ≥ 10 个模块共享的 Web `hooks/` `lib/` `utils/` `providers/` `config/` + analytics-sdk 源码 | 登录后 |
| 页面层 | `vendor~A~B~…` | 其余第三方，按「消费页面集合」精确分组（`entriesAware`，不侧向合并） | 使用它的页面 |
| 页面层 | 页面 chunk | 页面注册表的每个动态入口及其独占模块 | 路由命中 |

### 分层为什么安全

- **文件预览按实际格式加载**：`components/file-viewer/renderers.ts` 仅静态注册 Core 的轻量格式定义，处理函数首次执行时才动态导入对应渲染器；同时保留全部格式的延迟处理函数，压缩包内部的文档、表格等继续按需预览。`@file-viewer` 各包独立分组，禁止再合并成一个 vendor chunk。`check-preview-chunks.mjs` 在 bundle 门禁中确认预览壳层没有静态触达格式引擎。

- **关系失效不导入关系运行时**：业务 mutation 只引用 `lib/entity-relation-cache.ts`，通过查询 meta 标记失效；不能为了失效缓存静态导入包含全部关系契约和 UI 的 hooks。搜索面板由轻量 `MenuSearchInput` 首次打开时加载，Ctrl/Cmd+K 监听保留在触发器中；总量与认证首屏由现行 bundle 预算守住。

- **Shared 契约与 Web hooks 分离**：`workflow/graph-schema.ts` 在模块顶层读取工作流枚举，查询 hooks 也在顶层读取契约操作生成 key。
  把 Shared schema、常量与 Web hooks 一并强制塞进 `app-shared` 会制造跨 chunk 初始化环，Demo 审批入口可能读取到尚未初始化的枚举或契约。
  `APP_SHARED_LOGIC` 因此不匹配 Shared；高复用 Shared 模块单独进入 `shared-common`，其它模块保留原始依赖拆分，
  避免把契约与消费方混组，同时控制首屏文件数。冒烟输出完整 pageerror 栈便于定位。
- **关键路径层对 import 封闭**：闭包内模块的依赖必然也在闭包内，不会与任何其它 chunk 成环；也不按「哪些页面用到」再拆——它们在任何页面运行前都已加载，拆出来只会制造请求。
- **Semi 核心只有一个 chunk**：Semi 内部 `button ↔ iconButton`、`form ↔ 各控件` 等强连通分量全部留在 chunk 内；Semi 只被外部单向引用，不会形成跨 chunk 环。
  拆出去的 markdown / media 两组只单向依赖核心（`upload` 引用 `cropper`、`image` 被多处引用，所以它们留在核心；`videoPlayer` 引用 `audioPlayer` / `audioSlider`，所以三者同组）。
- **公共层只收 Web 纯逻辑**：`APP_SHARED_LOGIC` 只匹配 Web `hooks/` `lib/` `utils/` `providers/` `config/` 与 analytics-sdk。组件一旦进入公共层会把图表 / 编辑器等重型依赖静态拖进壳层，
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
| 重库只动态 `import()` JS、却在同一页面静态 `import` 它的 CSS | CSS 模块按 `HEAVY_LIBRARIES` 规则与 JS 同进 `vendor-<lib>`，对 CSS 的静态边即对整个 JS chunk 的静态边，动态 import 形同虚设，并会静态带入约 2 MB 的 maplibre；JS 与 CSS 放进同一个 `lazy()` 子组件 |
| 只用 `StatCard` 的页面 import `@/components/charts` 桶文件 | 桶文件顶层的 vchart 主题注册副作用会让约 600 KB gz 的 vendor-visactor 成为无图表页面的静态依赖；轻量导出按文件路径导入，`charts-barrel-imports.test.ts` 守住 |
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

- 登录页静态进入关键路径：匿名首屏 5 个请求。代价是登录页的静态闭包直接决定匿名首屏体积——Semi `Form`（`BaseForm` 静态引入全部
  字段控件，含 DatePicker → date-fns、Upload → Cropper，minified ≈ 770 KB / 210 KB gz）、`Tabs`、`Modal` 都不能出现在它的闭包里：
  登录 / 注册 / MFA 表单用 `pages/login/login-form.ts` + `LoginField` 的受控实现，找回密码与目录登录弹窗 `lazy()`，
  `PreferencesProvider` 的一周起始日偏好经 `lib/week-start.ts` 动态 `import()` DatePicker。`bundle-budget.json` 的
  `index.html.maxCriticalGzKB` 守住这一点；壳层增量（AdminLayout / DashboardPage）因此承接了原本在关键路径里的 Semi 核心控件，
  认证首屏合计不变。
- 完整菜单树（`GET /api/menus`，1,100+ 行）只由 catch-all 的 `NotFoundOrForbidden` 在命中时自行拉取，不在启动链路上。
- 行为采集 SDK 由 `lib/tracker-boot.ts` 在 idle 时初始化，不阻塞首屏。
- MSW 只在 `VITE_DEMO_MODE=true` 时经入口的 `await import('./mocks')` 进入产物。
- 按名称渲染图标统一走 `components/DynamicIcon.tsx`（`DynamicIcon`）或 `utils/icons.tsx`（`renderLucideIcon`）：图标名来自数据（菜单、工作流模板、表单配置…），
  静态摇树无法覆盖，因此全表作为独立 chunk 在启动时并行预热，之后任意位置按名渲染都不再产生网络请求；页面里静态已知的图标继续按名具名 `import`。
- 文件类型 / 文件夹 / shell 图标（`utils/fileIcons.ts` 的 vscode-icons id）不再由 `@iconify/react` 在运行时向公网 Iconify API 拉取（内网 / 离线 / Demo 下空白）：
  `scripts/gen-iconify-assets.mjs` 在构建期从 `@iconify-json/*` 抽成 `src/assets/file-icons/*.svg`（含文件夹 `-opened` 展开态）与
  `components/icons/generated/mono-icons.ts`（单色品牌 / codicon 图标，`currentColor` 需内联），`components/FileTypeIcon` 只 eager 引入 URL、
  图标本体按可见类型逐个下载并走 immutable 缓存；`vite.config.ts` 对该目录关闭 `assetsInlineLimit`，否则 4KB 以下的 SVG 会内联成 data URL 塞进 `app-shared`（+70 KB gz）。
  守卫测试 `components/icons/iconify-assets.test.ts` 保证生成物与源码引用、安装的图标集版本一致；ESLint 禁止 `@iconify/react`。
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
| `npm run smoke` | 自起 `vite preview` 用系统 Chrome 真实启动全部入口 + 登录 → 仪表盘 → 用户管理，控制台错误 / 错误边界即失败（CI `smoke` job 基于 demo 产物）。`-- --url <url> --no-serve` 复用已有服务 | 系统 Chrome；非 demo 产物需要可用的 API |
| `npm run bench:runtime` | 冷缓存首屏基准：匿名 `/login` 与已登录 `/` 的请求数 / 字节 / 可交互 / LCP，取多次中位数；`-- --latency 50 --download 10` 经 CDP 注入网络条件；`-- --json out.json` 落盘 | 另一终端 `npm run preview`；API 可用 |

`bundle-budget.json` 的阈值以当前实测为基线并保留经过评估的余量。分包改动或新增首屏依赖导致超限时，先证明必要性再上调，并同步覆盖下方当前基准。

## 当前基准

### 产物（静态口径）

以下数据来自当前生产构建的 `npm run analyze:bundle`；预算取自 `bundle-budget.json`。

| 指标 | 当前实测 | 当前预算 |
| --- | --- | --- |
| 全部入口 JS | 1,100 个 chunk / 67.2 MB | chunk ≤ 1,160 |
| 后台 critical JS | 5 个 / 326.7 KB gz | ≤ 8 个 / 330 KB gz |
| 后台 critical CSS | 2 个 / 31.6 KB gz | ≤ 4 个 |
| incremental(AdminLayout) | 46 个 / 646.8 KB gz | ≤ 48 个 / 670 KB gz |
| incremental(DashboardPage) | 24 个 / 587.4 KB gz | ≤ 30 个 / 680 KB gz |
| 后台认证首屏 | 56 个 / 980.6 KB gz | ≤ 60 个 / 1,000 KB gz |
| 后台入口全部 JS | 869 个 / 44.8 MB | ≤ 900 个 / 45 MB |
| 会员端 critical JS | 5 个 / 270.6 KB gz | ≤ 8 个 / 280 KB gz |
| 会员端 critical CSS | 2 个 / 23.9 KB gz | ≤ 4 个 |
| 会员入口全部 JS | 74 个 / 1.9 MB | ≤ 75 个 / 2 MB |
| 审批端 critical JS | 5 个 / 208.0 KB gz | ≤ 8 个 / 220 KB gz |
| 审批端 critical CSS | 2 个 / 18.3 KB gz | ≤ 4 个 |
| 审批入口全部 JS | 157 个 / 20.5 MB | ≤ 185 个 / 21 MB |

登录页静态位于后台关键路径；AdminLayout、DashboardPage 与各重型库继续按需加载。三个入口的关键路径、
认证首屏和入口总量均满足现行预算。

### 运行时（冷缓存中位数）

测量条件：Windows 11 / Node 24 / Chrome（Playwright `channel: chrome`，headless）；产物由 `vite preview`
托管（HTTP/1.1、无压缩），`/api` 代理到本机开发 API；每条链路取 3 次冷缓存中位数，限速档为
CDP 注入 50 ms RTT / 10 Mbps。当前原始数据位于
[`docs/frontend/perf/`](https://github.com/iwangbowen/zenith-admin/tree/master/docs/frontend/perf) 的 `current-runtime-*.json`。

| 链路 | 请求数 | 传输（其中 JS） | 可交互 / LCP | 限速可交互 / LCP |
| --- | ---: | ---: | ---: | ---: |
| 匿名 `/login` | 17 | 542 KB（482 KB） | 633 ms / 580 ms | 1,303 ms / — |
| 已登录 `/` → 仪表盘 | 89 | 1,955 KB（1,842 KB） | 1,310 ms / 1,176 ms | 2,363 ms / 2,356 ms |

两条链路的控制台错误均为 0。代码、依赖、分包或启动链路变化后，应重新测量并直接覆盖本节。
