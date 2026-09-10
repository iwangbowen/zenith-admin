# 渲染与静态化

前台页面由 **React SSR**（`renderToStaticMarkup`）渲染，配合三种静态化模式与多层缓存。页面地址、静态文件名、搜索结果和后台预览均以服务端 URL resolver 的结果为准。

## 站点路由

- **域名模式**：前台按请求 Host 精确匹配站点 `domain` / `aliasDomains`，未命中回退默认站点（`isDefault`）
- **预览模式**：`/__cms/{siteCode}/...` 前缀直达任意站点（跳过静态缓存，后台改动即时可见）
- **多域名**：同一站点绑多个域名走 `aliasDomains`；设备差异由响应式主题的 CSS 断点解决，不做服务端 UA 分支（静态产物按 URL 缓存，按 UA 分叉要么废掉 CDN 缓存、要么产生重复内容）。若确需 PC/移动两套完全不同的前台，建子站点 + 站群映射分发

## URL 规则

| 页面 | URL |
|------|-----|
| 首页 | `/`（可被「页面搭建」isHome 页面接管） |
| 栏目列表 | `/{channelPath}/`，分页 `/{channelPath}/index_{n}.html` |
| 内容详情 | `/{channelPath}/{归档目录}{idOrSlug}.html`，正文多页 `/{channelPath}/{归档目录}{idOrSlug}_{n}.html`；内容设了 `.html` 结尾的 `staticPath` 时改用该相对路径（分页在扩展名前追加 `_{n}`）。归档目录见「详情页目录归档」 |
| 标签聚合 | `/tag/{slug}/` |
| 搭建页面 | `/p/{slug}/`，或页面自定义的 `path`（如 `/about.html`、`/zh/about/`） |
| 互动问卷 | `/interaction/{code}/` |
| 搜索 | `/search?q=`（永远动态） |
| 草稿预览 | `/__cms/{siteCode}/preview/{id}?exp=&sig=`（签名校验） |
| 主题样式资产 | `/_assets/theme.{hash}.css` |
| 前台岛脚本资产 | `/_assets/islands.{hash}.js`（全站同一份，`type="module"` 外链） |
| 站点资源 | `/sitemap.xml`、`/robots.txt`、`/rss.xml`、`/{channelPath}/rss.xml` |

## 静态化三模式

站点 `staticMode` 决定渲染策略：

| 模式 | 行为 | 适用 |
|------|------|------|
| `dynamic` | 纯 SSR + Redis 页面缓存；公开内容变更会清理该站点页面与 sitemap/RSS 缓存 | 内容高频变化 |
| `hybrid`（默认） | 静态文件命中直返；miss 时 SSR 渲染并**回写**静态文件 | 通用推荐 |
| `static` | 仅发布任务生成，miss 由当前请求 SSR 兜底且不回写 | 高安全静态托管 |

静态产物：首页、栏目全分页（上限 50 页）、站内详情页、标签页、搭建页、`sitemap.xml`（5 万条上限）、`robots.txt`、RSS。外链栏目和外链型内容只返回解析后的跳转，不生成详情 HTML。写入采用 `.tmp` + rename 原子操作。产物统一落在 `{siteCode}/` 单棵树下。dynamic 模式 Redis 页面缓存 key 绑定当前 cache epoch，形如 `cms:page:{siteId}:{epoch}:{path}`；公开变更先递增 epoch，再清理旧 key，因此并发请求不会读回变更前的缓存。

### 栏目级静态化开关

栏目 `staticMode` 可逐栏目覆盖站点设置：

| 值 | 行为 |
|------|------|
| `inherit`（默认） | 跟随站点 `staticMode` |
| `dynamic` | 本栏目**不产出**任何静态文件（列表页、详情页均走 SSR），站点其余栏目不受影响 |
| `hybrid` / `static` | 覆盖站点设置，语义同上表 |

生效点：增量刷新（`refreshContentStatic`）、快照发布（`applyCmsContentPublishSnapshot`）、栏目重建与全量构建（`buildSiteStatic`）。切换栏目静态模式会提交发布任务；任务按新模式生成或删除对应产物。链接型栏目（`type=link`）本来就不生成静态文件，不展示该选项。

### 发布时重建页数上限

站点 `settings.maxPageOnContentPublish`（内容策略）限制**单条内容发布/更新**时重建所属栏目的列表页数（默认 `0` = 全部重建，上限同 50 页）。仅作用于增量刷新路径；栏目级重建与全量构建始终生成全部分页。超出页数的历史分页文件仍会正常清理，不会残留。

### 详情页目录归档

栏目 `detailPathRule` 决定详情页静态产物落在栏目路径下的哪一级子目录，用于把海量内容打散、避免单目录文件过多：

| 规则 | 产出目录（以栏目 `news`、发布于 2026-07-05 的内容 #42 为例） |
|------|------|
| `none`（默认） | `/news/42.html` |
| `year` | `/news/2026/42.html` |
| `month` | `/news/2026/7/42.html` |
| `date` | `/news/2026/7/5/42.html` |
| `dateStr` | `/news/2026-07-05/42.html`（补零，目录名等宽便于排序） |
| `idHash` | `/news/2/42.html`（`id % 10` 分 10 桶，不依赖时间） |

优先级与边界：

- 内容自填 `staticPath` **完全绕过**本规则
- 日期类规则取 `publishedAt`，未发布时回退 `createdAt`；两者都缺失则退化为不归档，不会产生 `undefined` 目录
- 规则由 `contentUrl()` 统一计算，静态化写文件与模板生成链接共用同一函数；内容接口额外返回 `canonicalUrl`，后台预览使用 `previewUrl`，调用方不应自行拼接路径

> 改动栏目路径或归档规则会提交整站重建任务。新路径由任务生成，不再归属的产物由完整重建的孤儿清扫删除；需要保留入口时，请在「SEO 管理 → 301 重定向」配置显式跳转。

### 孤儿产物清扫

静态产物的路径由栏目路径、归档规则、内容 slug/staticPath 等共同决定，任何一项变更都会使原路径不再归属当前对象。**整站重建结束时会自动清扫这些孤儿**：

- **mark**：构建过程中用 AsyncLocalStorage 收集本次写入的全部相对路径
- **sweep**：递归遍历站点静态目录，删除不在写入集合中的文件，并自底向上回收空目录
- 删除走 `deleteStaticFile`，因此同样受发布围栏保护，且每个被删文件都会落一条 `deleted` 产物记录，可在发布中心审计
- 清扫数量回填任务结果 `prunedArtifacts`

**触发时机**：任意完整站点发布任务。栏目改路径/改归档规则、站点改主题等操作会提交整站重建；增量内容任务则使用快照中的 `deletePaths` 精确清理。

**安全边界**：

| 情形 | 行为 |
| --- | --- |
| 断点续跑的构建（`resumeAfterKey` 非空） | **跳过清扫** —— 续跑只写了后半程，集合不完整，清扫会误删前半程的有效产物 |
| 被取消的构建 | **跳过清扫**（提前返回一律 `pruned: 0`） |
| 内容级 / 栏目级增量刷新 | 不清扫，仅按快照 `deletePaths` 精确删除旧路径 |
| hybrid 按需回写的深分页（如标签页第 2 页） | 会被清扫；下次访问自动重新生成。`static` 模式下这类页面本就不生成，无影响 |

> 路径归一化复用 `pathToStaticFile`：写入侧记录的是 URL 形态（`news/`、``），磁盘上是 `news/index.html`、`index.html`。两侧若不用同一套映射，首页与全部栏目页会被误判成孤儿。

### 页面区块展示条件的静态安全策略

区块只支持公开且非敏感的 `always`、`guest`、`member` 与可组合时间窗。出现 `guest/member` 或 `startAt/endAt` 时，页面写入自动标记 `requiresDynamic=true`：

- 全量/增量静态构建删除并跳过该页面的静态文件，hybrid miss 也不回写，共享 Redis 页面缓存同样跳过。
- 首次导航只渲染游客可见区块；浏览器若存在会员 token，会用当前页面 URL 携带会员 `Authorization` 请求头发起 `no-store` 请求，服务端经 optional member auth 重新渲染会员版本后替换文档。
- 会员响应使用 `private, no-store` 与 `Vary: Authorization, Cookie`。JWT、JTI 黑名单、Redis 会话或会员状态任一校验失败均保留游客版本。
- 时间条件在服务端过滤；未到 `startAt` 或已过 `endAt` 的内容不会进入 HTML。为避免静态文件跨越时间边界后泄露，含 dateRange 的页面采用 dynamic；仅纯 `always` 页面进入静态产物。角色/权限/私密字段不属于展示条件 DSL。

### 公开聚合的状态边界

栏目列表、首页、标签页、相关阅读和上一篇/下一篇使用 `published + 未回收 + 未归档 + 未过期` 作为内容条件；内容详情在主栏目自身及全部祖先栏目有效启用且内容已发布、未回收、未过期时按规范 URL 渲染，已归档详情仍可直达但不会进入聚合位。`expireAt` 同时参与请求时的公开可见性判断，并由每分钟周期任务转为 `offline`，因此任务尚未执行前也不会继续公开到期内容。

Theme API 的内容来源按 `published + 未回收 + 未归档 + 未过期` 读取，并始终要求主栏目自身及全部祖先栏目有效启用；指定 `channelCode` 时还要求栏目属于本站。已发布页面部件的 `content` 来源同样使用该有效栏目集合，来源失效时只保留仍可解析的条目；主题作者不得把部件来源当作独立的权限边界。

站点级 sitemap 与站点级/栏目级 RSS 由渲染服务生成并缓存 10 分钟；对每条内容检查其主栏目自身及全部祖先栏目有效启用，栏目级 RSS 另要求请求栏目自身及全部祖先栏目有效启用，并且只收录满足 `published + 未回收 + 未归档 + 未过期` 的站内内容。发布任务会清理对应 Redis 元数据 key；客户端/CDN 仍受其 HTTP 缓存策略与主动 purge 结果约束。

### 聚合读取的列投影与导语

`cms_contents` 一行里 `body`（富文本）与 `search_vector`（正文前 2 万字的 tsvector）各占几十 KB，`extend` / `media_data` / `attachments` 也可能很大。所有返回多行的读路径都只取 `services/cms/cms-content-columns.ts` 定义的投影：

| 投影 | 内容 | 使用者 |
| --- | --- | --- |
| `cmsContentListColumns` | 全部列去掉 `body` / `search_vector` / `attachments`（保留 `extend` / `media_data`：列表要显示 showInList 模型字段与图集张数 / 媒体类型） | 栏目分页、首页区块、标签页、Theme API 与页面区块取数、部件内容源、RSS、Open API 列表 / 游标 / 增量同步、后台内容列表（另带 `attachments` 做附件计数） |
| `cmsContentLinkColumns` | `id / siteId / channelId / title / slug / staticPath / externalLink / publishedAt / createdAt` | 上一篇 / 下一篇、相关文章 |
| 全行 | 含正文 | 详情页、草稿预览、Headless 详情、写入路径 |

导语来自 **`excerpt` 生成列**：PostgreSQL 在写入 `body` 时自动维护正文纯文本的前 400 字符（去标签、还原常见实体、去 `[分页]` 标记、折叠空白），任何写入路径（编辑、复制、投稿、采集、分发、导入、种子）都不需要也不能手工维护它。列表项、搜索结果摘要、RSS `description` 统一经 `listSummaryOf(row, maxLength)`：手填 `summary` 优先，否则取 `excerpt`；列表截 120 字、搜索与 RSS 截 400 / 300 字。

Open API 的 `include=body|extend|attachments` 决定这三列是否进入 `SELECT`，不再取全行后裁输出。全站静态构建的计划只装载 URL 所需的窄列，正文分页数按 100 篇一批临时取 `body` 计算，全站正文不再一次性进入内存。

索引：公开可见谓词（`status='published' AND deleted_at IS NULL AND archived_at IS NULL`）上有两个部分索引 `(site_id, published_at DESC, id DESC)` 与 `(channel_id, published_at DESC, id DESC)`，分别服务站点级时间序（首页最新 / 推荐、RSS、标签页、Open API 默认排序）与栏目级时间序（上下篇、栏目 RSS、栏目区块）；`expire_at > now()` 不可进部分索引谓词，留给扫描过滤。栏目分页的排序键以置顶 / 权重 / 排序值开头，走 top-N 排序，目标栏目条件放在 OR 的第一分支、「有效栏目」约束只落在副栏目聚合分支，使扫描量随栏目内容数而非站点内容数增长。

基准（`packages/server/scripts/bench-cms-lists.ts`，3,000 篇 × 30.5 KB 正文 / 104 MB TOAST，7 轮中位数，PG 16，本机；原始数据 [`docs/backend/perf/`](https://github.com/iwangbowen/zenith-admin/tree/master/docs/backend/perf)，`baseline` 为全行读取，`current` 为当前投影）：

| 读路径 | 耗时 ms | 交给下游的字节 KB | cms_contents TOAST 块 / 次 |
| --- | --- | --- | --- |
| 栏目分页第 1 页（20 行） | 33.1 → 9.9 | 1,118 → 32 | 123 → 0 |
| 首页最新 / 推荐 / 热门 | 26.1 → 5.7 | 1,676 → 48 | 184 → 0 |
| 标签页第 1 页 | 26.8 → 4.9 | 1,118 → 32 | 125 → 0 |
| 详情页上下篇 + 相关文章 | 18.0 → 6.3 | 390 → 2 | 44 → 0 |
| 站内搜索第 1 页 | 54.5 → 41.4 | 8 → 8 | 32,724 → 31,488 |
| 后台内容列表第 1 页（= HTTP 响应体） | 39.3 → 15.1 | 636 → 25 | 121 → 0 |
| Theme API `contents.list({ limit: 100 })` | 140.8 → 21.1 | 53 → 53 | 604 → 0 |
| 整页 SSR：栏目列表页 | 53.2 → 23.9 | — | 123 → 0 |
| 整页 SSR：首页 | 38.0 → 17.1 | — | 184 → 0 |
| RSS（50 行） | 60.9 → 8.4 | 14 → 23 | 309 → 0 |

两点说明：搜索剩余的 TOAST 访问来自 `ts_rank_cd` 对全部命中行的 `search_vector` 解压（本数据集全部 3,000 篇命中），与列表投影无关；`excerpt` 内联后主表行变宽（ASCII 400 字节、中文最多 1.2 KB），扫描同样多行会多摸 2–3 倍堆页（如栏目分页 216 → 628 块），这部分是缓冲区命中，被 TOAST 归零与 3–7 倍的耗时下降覆盖。RSS 字节上升是无手填摘要的条目现在也带 `description`。

## 增量刷新

内容、栏目、页面、部件及其他公开配置的变更（例如内容发布/更新/下线/回收、评论过审、搭建页保存）自动触发**增量静态刷新**（详情页 + 所属栏目全分页 + 首页 + sitemap + RSS），异步执行不阻塞请求；事务 outbox 提交后先清理受影响站点的 Redis 页面和元数据缓存。新提交的全量重建统一走任务中心 `cms-publish-build`，文件生成/删除和 CDN purge 在任务中完成。

## 缓存分级与协商缓存

SSR 响应按页面类型分级缓存：

| 页面类型 | dynamic 模式 Redis TTL / Cache-Control max-age |
|----------|------------------------------------------------|
| 详情页 | 600s |
| 首页 / 单页 | 300s |
| 栏目列表 | 180s |
| 其他 | 60s |

所有 HTML 响应附带**弱 ETag**，命中 `If-None-Match` 返回 **304**，CDN 与浏览器可协商缓存；响应会标注 `X-Cms-Cache=static|redis|dynamic-audience`。任务提交后服务端 Redis key 会先清理，已缓存的浏览器/CDN 响应仍遵循其 `Cache-Control` 生命周期；配置 CDN purge 后会异步发送受影响路径。浏览计数经 Redis 缓冲聚合（`cms:viewbuf`），每分钟批量落库，避免高并发行锁排队。

### 发布修订与产物新鲜度

整站/主题公开快照任务使用站点 `publicRevision`：任务提交时记录 `themeRevision`、`templateRefsRevision` 和 `publicRevision`，产物记录同一公开修订号；worker 在站点发布锁内复验，过期或失败任务不得写入、删除或覆盖当前修订的产物。首页、标签、sitemap、RSS、robots 等聚合产物按站点公开修订校验。路径级增量产物即使记录提交时的 `publicRevision` 供审计，也不以它作为全站失效条件。

内容、栏目和搭建页面的增量任务使用对象版本、路径快照和引用关系校验，避免一条内容变更使无关页面失效。`hybrid` 命中缺失或过期产物时回退 SSR，并只允许通过写入 fence 的结果回写；`static` 模式的 miss 只做 SSR 兜底，不回写。任务提交是异步边界，不等同于文件已生成；发布中心的任务状态和产物状态是最终完成依据。

## 主题与模板解析

前台外观由**主题**决定（内置 `default` / `docs` / `gov-portal` / `magazine` / `news-portal` 五套，全部为仓库内 React TSX 组件，服务端 SSR 渲染）。主题体系——主题注册、样式资产、Theme API 首页取数、主题参数（settingsSchema）、变体模板与解析链、共享组件、模型字段消费、部件插槽——完整说明见 **[主题与模板开发](./themes)**。

与渲染管线相关的几个事实：

- 站点切换主题时服务端校验主题已注册并原子递增 `themeRevision`；整站/主题发布任务同时携带 `templateRefsRevision` 与 `publicRevision` 做**过期栅栏**，执行中发现任一修订变化即失效退出
- 模板解析链为 内容/栏目级覆盖 → 站点有效 `defaultTemplates`（经站群继承 resolver）→ 主题默认；主题升级导致的失效模板引用在站点保存时自动摘除（自愈机制见[主题文档](./themes#变体模板与解析链)）
- 正式渲染输出 `/_assets/theme.{hash}.css` 指纹外链，文件缺失时由前台 `_assets/` 路由现场生成；整站孤儿清扫保留 `_assets/` 目录。主题配置中的链接值仍必须遵守 CMS 安全 URL 约定，不能把任意协议字符串传给模板。
- 前台交互脚本以同一机制交付：`/_assets/islands.{hash}.js`（`type="module"` 外链，正式与预览渲染均输出，预览不落盘）。
  静态页只含容器与 `data-*` 契约、不含内联可执行脚本；陈旧静态页引用旧指纹时路由返回当前脚本并降为 `no-cache`，
  岛在找不到期望容器时静默 no-op，因此新旧产物混跑不会报错。详见[主题文档 · 前台交互脚本](./themes#前台交互脚本islands)。

## 页面部件与主题插槽

「页面部件」（`/cms/widgets`，权限 `cms:widget:list|create|update|publish|offline|delete|bind`）是可复用的内容块：在一处维护榜单/推荐位，多个页面位置引用。部件变更通过任务中心按引用索引刷新受影响页面；需要更新站点级公开修订时同时提交站点发布任务，任务完成前不会暴露半成品。

### 数据与状态

- 类型目前为 `manual-list`（手工榜单）；条目来源三种：`manual`（手填标题/链接）、`content`（引用站内已发布内容）、`channel`（引用启用中栏目的最新内容，**实时来源**——渲染时动态取数）
- **草稿/发布双份数据**：编辑改 `draftData`（`draftRevision` 乐观锁，版本不符 409）；「发布」将草稿快照为 `publishedData`，前台只渲染发布快照。状态机 `draft → published → offline`，下线后可再发布
- 引用校验：条目引用的内容必须已发布、未回收、未归档、未过期，且主栏目自身及全部祖先栏目有效启用；反向地，**删除内容 / 停用栏目时若仍被已发布部件引用会被 409 阻断**，需先下线或调整部件
- 展示模板（renderer）：`list-sidebar`（侧栏榜单）/ `list-grid`（网格卡片）/ `list-carousel`（轮播），部件设默认模板，引用处可覆盖
- 表：`cms_widgets` / `cms_widget_refs`（被引用索引，`ownerType: page | theme_slot`）/ `cms_widget_source_refs`（实时来源反向索引）

### 两种引用位置

| 引用方式 | 说明 |
|---|---|
| 页面搭建 `widget-ref` 区块 | 搭建页面中插入部件（`ownerType=page`），随页面静态化输出 |
| 主题插槽绑定 | `PUT /api/cms/widgets/slots/{slotKey}`（权限 `cms:widget:bind`），把**已发布**部件绑到主题声明的插槽上；插槽清单由主题注册表 `widgetSlots` 声明（五套内置主题均提供 `home.sidebar` 首页侧栏），并校验部件类型与模板是否适用 |

编辑页提供 `GET /{id}/preview`（草稿/发布态渲染预览）与 `GET /{id}/refs`（引用位置清单）；列表以 `referenceCount/impactCount` 展示引用面，达到高扇出阈值（20 个引用位置）标记 `highFanout` 提醒操作影响面。

### 定向刷新

部件发布/下线（含批量任务 `cms-widget-batch`）自动提交任务中心刷新；按引用索引重建受影响页面与相关首页的静态产物，并通过统一站点缓存失效入口递增 cache epoch、清理旧页面 key。关联的整站/主题任务仍由站点 `publicRevision` fence 保护，部件定向任务按页面与来源索引快照校验。连续来源变更按任务幂等键合并，`content`/`channel` 来源经 `cms_widget_source_refs` 反查后只刷新确有引用的站点和页面；任务完成前不覆盖旧的有效产物。
