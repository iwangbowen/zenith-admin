# 渲染与静态化

前台页面由 **React SSR**（`renderToStaticMarkup`）渲染，配合三种静态化模式与多层缓存。

## 站点路由

- **域名模式**：前台按请求 Host 精确匹配站点 `domain` / `aliasDomains`，未命中回退默认站点（`isDefault`）
- **预览模式**：`/__cms/{siteCode}/...` 前缀直达任意站点（跳过静态缓存，后台改动即时可见）；H5 通道预览走 `/__cms/{siteCode}/__h5/...`
- **H5 发布通道**：站点 `settings.h5Enabled` 开启后，`settings.h5Domain`（如 `m.example.com`）精确匹配 H5 通道；PC/H5 域名都绑定时按 UA 302 互跳（移动 UA 访问 PC 域名跳 H5，反之亦然，响应带 `Vary: User-Agent`）

## URL 规则

| 页面 | URL |
|------|-----|
| 首页 | `/`（可被「页面搭建」isHome 页面接管） |
| 栏目列表 | `/{channelPath}/`，分页 `/{channelPath}/index_{n}.html` |
| 内容详情 | `/{channelPath}/{idOrSlug}.html` |
| 标签聚合 | `/tag/{slug}/` |
| 搭建页面 | `/p/{slug}/` |
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

静态产物：首页、栏目全分页（上限 50 页）、详情页、标签页、搭建页、`sitemap.xml`（5 万条上限）、`robots.txt`、RSS。写入采用 `.tmp` + rename 原子操作。H5 通道开启后，页面产物在 `{siteCode}/__h5/` 子树双份生成；`sitemap.xml`/`robots.txt`/RSS 仅站点级一份。dynamic 模式 Redis 页面缓存 key 含通道维度（`cms:page:{siteId}:{device}:{path}`）。

## 增量刷新

内容发布/更新/下线/回收、评论过审、搭建页保存等操作自动触发**增量静态刷新**（详情页 + 所属栏目全分页 + 首页 + sitemap + RSS），异步执行不阻塞请求。全量重建走任务中心 `cms-static-build`（静态化管理页提交，带进度/取消）。

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

主题包注册于 `packages/server/src/cms/themes/registry.ts`，站点 `theme` 字段选择。模板上下文含导航、碎片、广告位、友链、SEO、评论、相关文章等。

主题除默认模板集外可注册**变体模板**（`extraListTemplates` / `extraDetailTemplates`，带展示名），default 主题内置 `list-card`（卡片网格）、`list-compact`（紧凑标题）、`detail-plain`（简洁正文）。可选清单通过 `GET /api/cms/sites/themes/{code}/templates` 返回，后台站点/栏目/内容三级下拉动态取。

**模板解析链**（按优先级，空值逐级回退）：

| 页面 | 解析顺序 |
|------|----------|
| 列表页 | 栏目 `listTemplate` → 站点 `settings.defaultTemplates[device].list` → 主题默认 |
| 详情页 | 内容 `detailTemplate` → 栏目 `detailTemplate` → 站点 `defaultTemplates[device].detailByModel[模型code]` → 站点 `defaultTemplates[device].detail` → 主题默认 |

`device` 为发布通道（`pc` / `h5`），站点级默认模板可按通道分别配置（站点编辑 →「模板与通道」标签页）。
