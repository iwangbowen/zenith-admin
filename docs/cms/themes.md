# 主题与模板开发

前台外观由**主题**决定：主题是仓库内置的 React TSX 模板包（服务端 `renderToStaticMarkup` SSR），在 `packages/server/src/cms/themes/registry.ts` 显式注册，无独立模板表、不做目录扫描。模板作者即开发人员——组件用 TypeScript + JSX 获得类型安全与复用，样式是主题目录下的独立 `styles.css`（见[样式体系](#样式体系)），而不是受限的字符串模板语言。

站点在「站点管理 → 编辑 → 基础信息 → 主题」下拉选择；保存时服务端校验主题已注册并原子递增 `themeRevision`，同时提交携带 `themeRevision`、`templateRefsRevision` 和 `publicRevision` 的受影响站点重建任务，worker 以三项修订做过期栅栏。子站可通过站群继承沿用父站主题（`theme` / `themeConfig` / `templates` 三个继承项独立选择来源，见[站群与分发](./site-groups-and-distribution#显式逐项继承)）。

## 内置主题

| 主题 | code | 形态 | 特色能力 |
|------|------|------|---------|
| 默认主题 | `default` | 通用企业官网 / 门户（亮色，支持暗色切换） | 品牌区 + 实色主色导航横条两段式头部、首页渐变 hero（无横幅图时以站名+简介兜底）、栏目区块、排行编号侧栏、变体模板最全 |
| 文档站主题 | `docs` | 文档/知识库（支持暗色切换） | 侧边目录导航（active 指示条）、正文排版 |
| 政府门户 | `gov-portal` | 政务门户（红色规制） | 大页头+主导航横条（固定高度，高亮与导航条严格重叠）、**纯 CSS 多级下拉导航**（三级缩进）、图标办事入口（hover 反色上浮）、双栏要闻区块、公文「文件信息」表头、详情页**字号切换/打印工具条**、相关阅读 |
| 资讯杂志 | `magazine` | 游戏/科技/数码资讯（暗色） | sticky 毛玻璃顶栏、霓虹发光品牌/徽章、焦点大图区（1 大 + 4 小）、栏目卡片流（hover 上浮+发光描边）、**评分徽章体系**（`ratingField` 参数）、内容形态角标（图集·N/视频/外链）、热门排行侧栏 |
| 新闻门户 | `news-portal` | 地方融媒体 / 行业资讯（报纸风） | 居中大报头+口号、主色主导航、首页头条区（置顶自动升为大标题+摘要+子链）、多栏新闻区块、热点排行侧栏、新闻详情（来源/记者/责编脚注） |

五套主题共用同一渲染管线与上下文契约，换主题只改 `cms_sites.theme` 一个值，内容数据无需改写。所有主题遵循同一套 CSS 变量契约（`--primary` / `--text` / `--text-2` / `--border` / `--bg` / `--bg-2`），站点级主题色（`themePrimary`）对任意主题即配即生效。

## CmsTheme 接口

开发主题 = 在 `themes/{code}/` 下实现 `CmsTheme`、放一份 `styles.css`，并在 registry 登记一行：

```ts
export const myTheme: CmsTheme = {
  code: 'my-theme',
  label: '我的主题',
  templates: {           // 七类核心模板（必备）
    index: HomeTemplate,       // 首页（支持 Theme API 定义体，见下）
    list: ListTemplate,        // 栏目列表页
    detail: DetailTemplate,    // 内容详情页
    page: PageTemplate,        // 单页栏目
    search: SearchTemplate,    // 搜索结果页
    tag: TagTemplate,          // 标签聚合页
    notFound: NotFoundTemplate,
  },
  customPage,            // 可选：可视化搭建页模板（缺省回退 default 实现）
  interaction,           // 可选：互动问卷页模板（缺省回退 default 实现）
  extraListTemplates,    // 可选：列表变体模板（按名引用）
  extraDetailTemplates,  // 可选：详情变体模板
  settingsSchema,        // 可选：主题参数声明（后台动态表单）
  darkVars,              // 可选：暗色模式 CSS 变量组；声明后站点可启用暗色/跟随系统
  widgetSlots,           // 可选：页面部件插槽声明
  widgetRenderers,       // 可选：覆盖核心部件 renderer（仅在确需不同 DOM 时）
};
```

主题 code 必须在注册表中存在；读取到未注册值时渲染回退 `default` 并记一次告警，站点保存和主题选择器会优先拒绝该值。

## 样式体系

主题样式与组件分离：组件在 tsx，样式在同目录 `styles.css`，由 `themes/theme-css.ts` 统一装配：

```text
themes/
  _shared/base.css      ← 跨主题公共样式（模型字段表 / 图集网格与播放器 / 内链词）
  theme-css.ts          ← 装配器：base.css + {code}/styles.css + 站点级覆盖，计算内容指纹
  default/
    Layout.tsx           ← 只有组件
    styles.css           ← 主题皮肤（可覆盖 base.css 同名选择器）
```

**装配规则**：最终样式表 = `base.css` + 主题 `styles.css` + 站点级覆盖（`themePrimary` 主色变量 + `themeDark` 暗色规则，暗色变量组来自 `CmsTheme.darkVars`）。开发模式每次渲染直读文件——**改 CSS 刷新页面即生效，不触发后端重启**；生产模式进程内缓存。

**输出双模式**（渲染管线注入 `ctx.assets`，`SeoHead` 统一消费）：

| 模式 | 判定 | 输出 | 目的 |
|------|------|------|------|
| 预览（`/__cms/{code}` 前缀） | `baseUrl` 非空 | 内联 `<style>` | 改主题/参数即时可见，不落盘 |
| 正式渲染（域名访问 / 静态化产出） | `baseUrl` 为空 | `<link href="/_assets/theme.{hash}.css">` | HTML 体积骤降（列表页约 29KB → 7KB），CSS 一次下载全站缓存复用 |

指纹资产 `_assets/theme.{hash}.css` 写入站点静态目录，`hash` 随最终 CSS 内容变化，响应头 `Cache-Control: public, max-age=31536000, immutable`。前台 `_assets/` 路由在文件缺失时**现场生成自愈**；请求非当前指纹时返回当前 CSS 并降为 `no-cache`，不污染 immutable 语义。整站重建的孤儿清扫豁免 `_assets/` 目录。构建产物侧，`npm run build` 后置 `copy-theme-assets` 把主题 CSS 拷入 `dist`。

主题源码里**不要**手写 `<style>` 或内联样式字符串——公共组件样式进 `base.css`，主题差异进自己的 `styles.css`。

## 前台交互脚本（islands）

主题组件是纯服务端组件（无 hook、无事件处理 prop）。浏览器端交互一律放在 `packages/server/src/cms/islands/`
里的 TS 模块（"岛"），主题**只输出容器与 `data-*` 契约**，不在 TSX 里写字符串脚本或 `dangerouslySetInnerHTML` 注入脚本。

| 组成 | 位置 | 说明 |
|------|------|------|
| 入口 / 加载器 | `islands/index.ts`、`mount.ts` | 按 `[data-island="name"]` 查找容器、按注册表挂载一次；单岛失败隔离 |
| 容器岛 | `follow`、`likes`、`comments`、`captcha`、`survey/**`、`article-tools` | 每个岛只读自身容器上的 `data-*`，找不到期望元素时静默 no-op |
| 页面岛 | `analytics`、`ads` | 无容器、每页运行一次；配置来自 `SeoHead` 输出的 `<meta name="cms-site" / "cms-analytics-key" / "cms-content-id">` |
| 共享件 | `islands/shared/` | 会员 token 读取与登录跳转、`fetch` + 鉴权头 + `code` 判定、meta 读取 |
| 类型检查 / 测试 | `tsconfig.islands.json`（lib DOM，`npm run lint` 内）、`*.test.ts`（`// @vitest-environment jsdom`） | 与服务端 tsc 隔离；类型可仅类型导入 `@zenith/shared/cms` 契约 |

**交付**：`scripts/build-islands.mjs` 用 esbuild 打成单个 ESM（生产预构建到 `dist/cms/islands/islands.js`；开发 / 测试由
`themes/islands-asset.ts` 按源码 mtime 在内存中按需构建，改岛源码刷新即生效）。渲染管线以内容指纹外链
`/_assets/islands.{hash}.js`（`SeoHead` 输出 `<script type="module" src>`，module 默认 defer，执行时文档已解析完毕），
落盘 / 自愈 / `immutable` / 旧指纹降级规则与主题 CSS 资产完全一致；内容全站相同、预览页同样加载（不落盘）。

**保留内联的两段脚本**（内容恒定、必须尽早同步执行）：`THEME_TOGGLE_SCRIPT`（head 内暗色初始化防闪烁）与 default 主题的
会员受众重载 / 清理脚本。除此之外主题不得新增内联可执行脚本——`cms-theme-shared-render.test.ts` 以渲染结果断言这一点，
`html-security-headers.ts` 的 CSP 也因此在全站各页恒定。

**新增一个岛**：① 在 `islands/` 新建模块导出 `mount(el: HTMLElement)`（或页面岛 `run(doc)`），只依赖 `data-*` 与共享件；
② 在 `registry.ts` 登记；③ 主题容器加 `data-island="name"` 与所需 `data-*`；④ 补 jsdom 单测（`test-utils.ts` 提供
`stubFetch` / `flush` / `setMemberToken` / `html`）；⑤ 若产出静态页需重建以引用新指纹（发布会自动处理）。

## Theme API：首页声明式取数

首页模板可用 `defineHomeTemplate` 定义体替代普通组件，把「取什么数据」与「怎么渲染」分离：

```tsx
const HomeTemplate = defineHomeTemplate({
  // load 声明式取数：返回值类型自动推导，注入 Component 的 data
  // 「首页栏目区块」（themeConfig.homeChannels）逐栏并发取数用 _shared 的 loadHomeBlocks，
  // 其它自定义取数直接调 cms.contents.list
  load: async ({ cms, site }) => ({ blocks: await loadHomeBlocks(cms, site, { limit: 8 }) }),
  Component: ({ data, ...ctx }) => (
    <Layout ctx={ctx}>
      {data.blocks.map((block) => (
        <Section key={block.channel.code} title={block.channel.name} more={block.channel.url}>
          {block.list.map((item) => <Card key={item.id} item={item} />)}
        </Section>
      ))}
    </Layout>
  ),
});
```

`CmsThemeDataApi`（`cms` 参数）当前提供：

| 方法 | 说明 |
|------|------|
| `cms.contents.list({ channelCode?, limit?, recommend?, hot? })` | 按栏目标识取已发布内容，返回 `{ channel, list }`；`channel` 含名称与列表页 URL |

安全边界：同参数调用**去重复用**（memo）、单次渲染 ≤ 20 次取数、`limit` ≤ 100；指定的栏目 code 必须属于当前站点且自身及全部祖先栏目有效启用，不存在或不可用时返回空集而不是抛错。`list` 中的条目为标准 `CmsContentItem`（含 `modelFields`），与栏目列表页同构。无论是否指定栏目，内容均限于有效启用栏目中的 `published + 未回收 + 未归档 + 未过期` 数据。

普通组件形式的首页模板继续可用（上下文自带 `latest` / `recommended` / `hot` 三组全站数据），Theme API 适合需要按栏目分区块的门户/资讯首页。

## 主题参数（settingsSchema）

主题声明参数 schema 后，后台站点编辑自动渲染「主题专属参数」动态表单（按 `group` 分组），值存 `cms_sites.settings.themeConfig`：

```ts
settingsSchema: [
  { name: 'homeChannels', label: '首页栏目区块', fieldType: 'text', group: '首页',
    placeholder: '如 reviews,news', description: '逗号分隔栏目标识（最多 6 个）' },
  { name: 'ratingField', label: '评分字段标识', fieldType: 'text', group: '内容',
    description: '内容模型中作为评分的字段：详情大徽章、卡片角标；留空默认 score' },
  { name: 'footerText', label: '页脚附加文案', fieldType: 'textarea', group: '页脚' },
]
```

- 字段类型：`text` / `textarea` / `color` / `number` / `switch` / `select` / `image`（image 直接对接素材上传）
- 渲染时经 `resolveThemeConfig` 解析：schema 默认值 ⊕ 已存值按类型宽容解析（非法值回退默认），模板经 `ctx.site.themeConfig` 消费，无需自行处理缺省
- 通用外观参数（主题色 `themePrimary`、暗色模式 `themeDark`）独立于 schema，全主题一致；主题色与暗色变量覆盖由 `themes/theme-css.ts` 的 `buildThemeOverrides` 装配进最终样式表
- `image` 值按当前站点的素材句柄解析；`bannerLink`、`serviceLinks` 等文本链接在保存时经过 CMS URL policy 校验，只接受可直接输出的安全站内路径或允许的外部协议（实体引用必须先由选择器解析为最终 href），模板不得把任意协议字符串直接输出到 `href`。
- 接口：`GET /api/cms/sites/themes/{code}/settings-schema`

各内置主题的专属参数：default（页头电话/首页横幅/栏目区块/热门开关/页脚）、docs（无专属参数）、gov-portal（页头副标题/首页栏目区块/**办事入口**（每行 `名称|链接`）/页脚）、magazine（首页栏目区块/**评分字段**/页脚）、news-portal（报头口号/首页栏目区块/页脚）。

## 变体模板与解析链

主题除默认模板集外可注册**变体模板**（带展示名），供站点/栏目/内容三级按名引用：

- default 内置：`list-card`（卡片网格）/ `list-compact`（紧凑标题）/ `detail-plain`（简洁正文）
- gov-portal 内置：`list-compact`（紧凑公文列表）/ `detail-policy`（政策文件）
- news-portal 内置：`list-headline`（纯标题两栏）/ `list-photo`（图片网格）/ `detail-plain`（简洁正文）/ `detail-wide`（宽幅版式）

可选清单：`GET /api/cms/sites/themes/{code}/templates`，后台三级下拉动态取。

**解析链**（按优先级，空值逐级回退）：

| 页面 | 解析顺序 |
|------|----------|
| 列表页 | 栏目 `listTemplate` → 站点 `settings.defaultTemplates.list` → 主题默认 |
| 详情页 | 内容 `detailTemplate` → 栏目 `detailTemplate` → 站点 `defaultTemplates.detailByModel[模型code]` → 站点 `defaultTemplates.detail` → 主题默认 |

站点级默认模板在站点编辑「模板与主题」页签配置，支持**按内容模型细分详情模板**；栏目级在栏目编辑「模板配置」区配置。栏目级不提供按模型细分——内容 `model_id` 恒等于其主栏目的 `model_id`，栏目内模型唯一，细分会退化为重复槽位。

**失效引用自愈**：主题注册表中不存在的变体引用在站点保存时自动摘除（`pruneStaleTemplateDefaults`，记 warn 日志）；本次新提交的失效模板名直接返回 400 并附可用清单。全站存量扫描见站点管理页健康检查 Banner（`getSiteTemplateHealth`）。

## 共享组件（_shared.tsx）

与主题视觉无关的公共件集中在 `themes/_shared.tsx`，新主题直接复用：

| 组件 / 常量 | 职责 |
|------|------|
| `SeoHead` | 完整 SEO head：TDK、canonical、Open Graph、Twitter Card、JSON-LD、hreflang；样式经 `ctx.assets` 输出（正式外链指纹 CSS / 预览内联）；输出岛脚本 `<script type="module">` 与页面岛配置 `<meta name="cms-*">`；暗色模式自动注入切换脚本 |
| `Breadcrumbs` / `Pagination` | 面包屑 / 分页导航（语义结构，样式由主题 CSS 决定） |
| `ArticleNav` / `RelatedArticles` / `AttachmentList` | 详情页上下篇导航（`.article-nav`）、相关阅读（`.related-articles`，可传 `title` / `heading`）、附件下载链接（`.attachments`）；空数据时不渲染 |
| `ModelFieldTable` | 模型字段双栏键值表，按 `detailGroup` 分组（公文信息表头样式钩子 `.model-fields*`，公共样式在 `_shared/base.css`） |
| `MediaBlock` | 内容形态区块：图集九宫格 / 音视频播放器（article/link 返回 null，公共样式在 `_shared/base.css`）。**详情模板须在正文前调用**，否则 album/media 形态丢失主图 |
| `SearchResultList` / `SearchResultLink` | 搜索结果列表（空态文案统一；默认条目为「标题链接 + 发布日期」，需要摘要 / 栏目名的主题传 `renderItem`，条目根元素自带 `key`）与高亮标题链接（外链新窗口、不拼 baseUrl） |
| `loadHomeBlocks` / `CmsThemeHomeBlock` | 首页栏目区块取数：解析 `themeConfig.homeChannels`（中英文逗号分隔，默认最多 6 个，可传 `maxChannels`）并发读取各栏目、过滤站内不存在的栏目 |
| `CaptchaBox` / `CmsFollowButton`（default） | 算术验证码容器（`data-island="captcha"`）/ 关注按钮（`data-island="follow"`）：只输出容器契约，交互见 [前台交互脚本（islands）](#前台交互脚本islands) |
| `THEME_TOGGLE_SCRIPT` | 暗色切换脚本（唯一保留在 head 内联的可执行脚本） |

五套内置主题的搜索页与 default 详情页 HTML 由 `cms-theme-markup-snapshot.test.ts` 快照锁定，改动共享件后快照必须逐字节一致或有意更新。

## 消费模型字段

内容模型中勾选「详情展示 / 列表显示」的字段经渲染管线翻译后注入上下文（见[内容模型](./content-models#前台渲染消费)），主题按需消费：

```tsx
// 详情页：键值表（公文场景）
{content.modelFields.length > 0 ? <ModelFieldTable fields={content.modelFields} /> : null}

// 详情页：拆出评分字段做大徽章，其余行内展示（资讯场景，magazine 实现）
const rating = content.modelFields.find((f) => f.name === ratingField && f.displayValue);
const rest = content.modelFields.filter((f) => f !== rating && f.displayValue);

// 列表卡片：角标 chips
{item.modelFields.filter((f) => f.displayValue).map((f) => (
  <span key={f.name} className="chip" title={f.label}>{f.displayValue}</span>
))}
```

`CmsModelFieldValue` 提供 `name / label / fieldType / rawValue / displayValue / group / sort`：`displayValue` 已完成字典与选项翻译、日期格式化、多选连接与开关转换，主题直接渲染即可；需要原始值做数值判断（如按评分上色）时读 `rawValue`。

## 页面部件插槽（widgetSlots）

主题可声明部件插槽，把「页面部件」（`/cms/widgets`）绑定到主题固定位置：

```ts
widgetSlots: [{
  key: 'home.sidebar',           // 当前内置主题统一声明的首页侧栏插槽
  label: '首页侧栏',
  allowedTypes: ['manual-list'],
  rendererKeys: [...CMS_WIDGET_RENDERER_KEYS],
}]
```

后台站点编辑出现「页面部件插槽」配置区；绑定走 `PUT /api/cms/widgets/slots/{slotKey}`（权限 `cms:widget:bind`），仅接受**已发布**部件并校验类型与模板适用性。模板中经 `ctx.homeSidebar` 取绑定结果、`renderCmsWidgetHtml` 输出。部件内容变化时**定向刷新**引用位置，机制见[渲染与静态化](./static-and-render#页面部件与主题插槽)。

## 上下文契约速览

所有模板的 props 均为强类型上下文（`themes/types.ts`）：

- **`CmsBaseContext`**（全模板共有）：`site`（含 `themeConfig` / `extend` / `settings`）、`nav`（导航树，节点带 `target`；链接栏目应使用已解析的最终 URL）、`ads`、`friendLinks` / `friendLinkGroups`、`baseUrl`、`searchUrl`、`seo`、`analytics`、`langAlternates`、`audience`、`assets`（`cssHref` / `inlineCss` / `darkMode`）
- **`CmsHomeContext`**：继承 `CmsBaseContext`，额外提供 `latest` / `recommended` / `hot` 与 `homeSidebar`
- **`CmsContentItem`**（列表条目）：标题/摘要/封面（`coverThumb` 优先）/形态（`contentType` + `imageCount` / `mediaType`）/属性标记（isTop/isRecommend/isHot）/`modelFields`
- **`CmsDetailContext`**：`content`（`CmsContentDetail`，含正文、`bodyPagination` 正文分页、`attachments`、`albumImages` / `mediaUrl`、`modelFields`、`tags`、`prev` / `next`）、`related` 相关阅读、`comments`
- **`CmsListContext` / `CmsTagPageContext` / `CmsSearchContext`**：`items` / `results` + `pagination` + `breadcrumbs`

链接一律使用上下文给出的最终 URL（`item.url` / `channel.url` 等），由 `contentUrl()` 和 CMS link resolver 统一计算；静态化写文件、搜索、RSS、sitemap 与后台预览共享同一 canonical 规则。模板不应读取 `staticPath` 后自行拼接，也不应把原始 `entity:` / `internal:` 值直接输出到 `href`。
