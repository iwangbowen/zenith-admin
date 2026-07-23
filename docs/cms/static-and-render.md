# 渲染与静态化

前台页面由 **React SSR**（`renderToStaticMarkup`）渲染，配合三种静态化模式与多层缓存。

## 站点路由

- **域名模式**：前台按请求 Host 精确匹配站点 `domain` / `aliasDomains`，未命中回退默认站点（`isDefault`）
- **预览模式**：`/__cms/{siteCode}/...` 前缀直达任意站点（跳过静态缓存，后台改动即时可见）；非默认通道预览走 `/__cms/{siteCode}/__{channelCode}/...`
- **发布通道**：通道（PC/H5/小程序等输出端）在「CMS 内容管理 → 发布通道」按站点自由创建（`cms_publish_channels` 表）。默认通道服务站点主域名与静态根目录；非默认通道可绑定独立域名（Host 精确匹配）与 UA 正则——两者同配时，主域名按 UA 302 跳通道域名、通道域名 UA 不匹配时跳回主域名（响应带 `Vary: User-Agent`）。站点无通道记录时自动回退虚拟 PC 默认通道，零迁移兼容

## URL 规则

| 页面 | URL |
|------|-----|
| 首页 | `/`（可被「页面搭建」isHome 页面接管） |
| 栏目列表 | `/{channelPath}/`，分页 `/{channelPath}/index_{n}.html` |
| 内容详情 | `/{channelPath}/{idOrSlug}.html`，正文多页 `/{channelPath}/{idOrSlug}_{n}.html` |
| 标签聚合 | `/tag/{slug}/` |
| 搭建页面 | `/p/{slug}/` |
| 互动问卷 | `/interaction/{code}/` |
| 搜索 | `/search?q=`（永远动态） |
| 草稿预览 | `/preview/{id}?exp=&sig=`（签名校验） |
| 站点资源 | `/sitemap.xml`、`/robots.txt`、`/rss.xml`、`/{channelPath}/rss.xml` |

## 静态化三模式

站点 `staticMode` 决定渲染策略：

| 模式 | 行为 | 适用 |
|------|------|------|
| `dynamic` | 纯 SSR + Redis 页面缓存 | 内容高频变化 |
| `hybrid`（默认） | 静态文件命中直返；miss 时 SSR 渲染并**回写**静态文件 | 通用推荐 |
| `static` | 仅发布时生成，miss 不回写 | 高安全静态托管 |

静态产物：首页、栏目全分页（上限 50 页）、详情页、标签页、搭建页、`sitemap.xml`（5 万条上限）、`robots.txt`、RSS。写入采用 `.tmp` + rename 原子操作。默认通道产物在站点根目录，非默认通道在 `{siteCode}/__{channelCode}/` 子树逐通道生成；`sitemap.xml`/`robots.txt`/RSS 仅站点级一份。dynamic 模式 Redis 页面缓存 key 含通道维度（`cms:page:{siteId}:{channelCode}:{path}`）。

### 页面区块展示条件的静态安全策略

区块只支持公开且非敏感的 `always`、`guest`、`member` 与可组合时间窗。出现 `guest/member` 或 `startAt/endAt` 时，页面写入自动标记 `requiresDynamic=true`：

- 全量/增量静态构建删除并跳过该页面的静态文件，hybrid miss 也不回写，共享 Redis 页面缓存同样跳过。
- 首次导航只渲染游客可见区块；浏览器若存在会员 token，会用 Bearer 对同 URL 发起 `no-store` 请求，服务端经 optional member auth 重新渲染会员版本后替换文档。
- 会员响应使用 `private, no-store` 与 `Vary: Authorization, Cookie`。JWT、JTI 黑名单、Redis 会话或会员状态任一校验失败均保留游客版本。
- 时间条件在服务端过滤；未到 `startAt` 或已过 `endAt` 的内容不会进入 HTML。为避免静态文件跨越时间边界后泄露，含 dateRange 的页面采用 dynamic；仅纯 `always` 页面进入静态产物。角色/权限/私密字段不属于展示条件 DSL。

## 增量刷新

内容发布/更新/下线/回收、评论过审、搭建页保存等操作自动触发**增量静态刷新**（详情页 + 所属栏目全分页 + 首页 + sitemap + RSS），异步执行不阻塞请求。新提交的全量重建统一走任务中心 `cms-publish-build`；`cms-static-build` 仅保留为存量任务兼容类型。

## 缓存分级与协商缓存

SSR 响应按页面类型分级缓存（v1.6.0+）：

| 页面类型 | dynamic 模式 Redis TTL / Cache-Control max-age |
|----------|------------------------------------------------|
| 详情页 | 600s |
| 首页 / 单页 | 300s |
| 栏目列表 | 180s |
| 其他 | 60s |

所有 HTML 响应附带**弱 ETag**，命中 `If-None-Match` 返回 **304**，CDN 与浏览器可协商缓存。浏览计数经 Redis 缓冲聚合（`cms:viewbuf`），每分钟批量落库，避免高并发行锁排队。

## 主题与模板解析

内置可信主题注册于 `packages/server/src/cms/themes/registry.ts`；签名扩展主题使用不可执行的声明式 DSL，由仓库内 React renderer 解释。站点主题只能经主题生命周期接口事务化切换，普通站点更新不能写 `theme`。模板上下文含导航、碎片、广告位、友链、SEO、评论、相关文章等。完整安全模型与发布生命周期见[模板、签名主题包与发布中心](./templates-themes-publishing)。

主题除默认模板集外可注册**变体模板**（`extraListTemplates` / `extraDetailTemplates`，带展示名），default 主题内置 `list-card`（卡片网格）、`list-compact`（紧凑标题）、`detail-plain`（简洁正文）。可选清单通过 `GET /api/cms/sites/themes/{code}/templates` 返回，后台站点/栏目/内容三级下拉动态取。

**模板解析链**（按优先级，空值逐级回退）：

| 页面 | 解析顺序 |
|------|----------|
| 列表页 | 栏目 `settings.templates[通道].list` → 栏目 `listTemplate`（全通道通用） → 站点 `settings.defaultTemplates[通道].list` → 主题默认 |
| 详情页 | 内容 `detailTemplate` → 栏目 `settings.templates[通道].detailByModel[模型code]` → 栏目 `settings.templates[通道].detail` → 栏目 `detailTemplate`（全通道通用） → 站点 `defaultTemplates[通道].detailByModel[模型code]` → 站点 `defaultTemplates[通道].detail` → 主题默认 |

通道维度 key 为发布通道编码（`cms_publish_channels.code`，用户自建）。站点级默认模板在站点编辑 →「模板与通道」页签配置；栏目级在栏目编辑「模板配置」区按「全通道通用 + 各通道」页签配置，均支持按内容模型细分详情模板。
