# 开放能力（Headless API）

CMS 内容可通过开放平台网关以 **Headless** 方式供外部系统消费：读取走查询 DSL 与增量同步，
写入走受治理的双向接口，变更通过 Webhook 实时外推。本篇只说明 CMS 侧资源语义；应用、签名、限流、配额、Webhook 投递与调试台能力见 [开放平台](/open-platform/)。每次写请求都会建立独立的开放应用 scope，不能借用后台用户或平台管理员权限。

所有端点与后台一致，由 `@zenith/shared/cms` 的 `openCmsContract`（`packages/shared/src/cms/contracts/open-cms.ts`）经 `defineContractRoute` 定义，因此会进入 Swagger（`/api/docs`），
客户端可直接由 `openapi.json` 生成 SDK；调试台的可调试端点目录同样由该契约派生。

## 接入方式

走开放平台标准链路：创建开发者应用 → 授权 scope → HMAC 签名调用（经鉴权/计量/限流三层网关）。
CMS 开放端点由 `packages/server/src/routes/open-platform/open-cms.ts` 承载并挂载到 `/api/open/v1/cms`；签名规范见 [开放平台](/open-platform/)。

Base：`/api/open/v1/cms`

### Scope

| scope | 能力 |
|---|---|
| `cms:read` | 读取栏目树、已发布内容、增量同步 |
| `cms:write` | 创建/更新内容、提交审核、移入回收站 |
| `cms:publish` | 绕过审核直接发布 |

### 写入授权（fail-closed）

持有 `cms:write` **不等于**能写任意站点。写入前必须在「站点管理 → 操作 → 开放授权」中
为该应用显式授权站点，并可进一步限定栏目白名单；未授权一律 403。授权行 `channelIds=[]` 表示该站点全部栏目，非空时只允许列出的栏目。与人类侧的
`cms_site_users` / `cms_channel_users` 是同一套 fail-closed 思路。表：`cms_open_app_grants`。

**直接发布需三个条件同时成立**（任一不满足即 403）：

1. 应用持有 `cms:publish` scope
2. 授权行开启「允许直接发布」
3. 站点编辑 →「内容策略」开启「允许开放 API 直接发布」（默认关闭）

默认关闭是有意的：外部创建先写入草稿并立即提交审核，最终进入 `pending`；只有三重开关同时满足时才直接发布。站点导入包则统一保留为草稿，由后台显式审核或排期。

## 只读端点

### 栏目树

```http
GET /api/open/v1/cms/channels?siteCode=main
```

返回站点启用中的栏目树（含 id/code/name/slug/path/type/children）。`code` 为站内唯一的稳定标识，
建议客户端按它引用栏目而非数值 id。

### 内容查询

```http
GET /api/open/v1/cms/contents?siteCode=main&channel=news,notice&sort=-publishedAt&fields=title,coverImage,url
```

| 参数 | 说明 |
|---|---|
| `channel` | 栏目标识，逗号分隔多选（聚合主栏目与副栏目，与前台栏目页一致） |
| `channelPath` | 栏目路径前缀，**含全部子栏目** |
| `tag` | 标签 slug，逗号分隔多选 |
| `contentType` | `article` / `album` / `media` / `link`，逗号分隔多选 |
| `keyword` | 全文检索（与站内搜索共用同一分词与 tsquery 构造，结果集一致） |
| `author` / `model` | 作者精确匹配 / 内容模型标识 |
| `isTop` `isRecommend` `isHot` `isOriginal` | 布尔筛选（`true`/`false`/`1`/`0`） |
| `publishedFrom` / `publishedTo` | 发布时间闭区间（`YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm:ss`） |
| `extend.{字段}` | 扩展字段过滤，**仅限模型中标记「纳入检索」的字段** |
| `sort` | `-publishedAt,-topWeight`，前缀 `-` 为倒序 |
| `fields` | 字段裁剪，逗号分隔；`id` 始终返回 |
| `include` | `tags,channel,relations,attachments,body,extend` |
| `page` / `pageSize` | 页码分页；必须是十进制正整数，`pageSize` 上限 100、缺省 20。`0`、负数、小数、非数字和超过上限均返回 400，不做截断或归一化 |

**白名单 fail-closed**：`sort` / `fields` / `include` / `contentType` 传入白名单之外的取值直接返回 400，
而不是静默忽略 —— 静默忽略会让调用方误以为过滤生效、拿到比预期更宽的数据集。
`extend.*` 额外要求字段在内容模型中标记为可检索，避免外部应用通过 JSONB 路径探测未公开字段。

只返回**已发布、未回收、未归档、未过期，且主栏目自身及全部祖先栏目有效启用**的内容。栏目或其祖先停用等同前台下线：
不带 `channel` 参数的站级 feed 与显式指定该栏目的结果保持一致，不会出现「站级能拉到、指定栏目 404」。

站内内容的 `url` 均按服务端栏目归档规则和 `staticPath` 生成；外链型内容的地址经过 CMS link policy 校验后原样返回。调用方不要根据 `channelCode + slug` 自行拼接 URL。

### 游标翻页（大数据量拉取）

```http
GET /api/open/v1/cms/contents/cursor?siteCode=main&pageSize=100
→ { list: [...], hasMore: true, nextCursor: "MTc2..." }

GET /api/open/v1/cms/contents/cursor?siteCode=main&pageSize=100&cursor=MTc2...
```

keyset 推进，深翻不退化为大 offset，期间新增内容也不会让结果错行或漏行。过滤参数与上面一致。

`sort` 在游标模式下**只允许单个字段**（多字段返回 400）：keyset 条件按「排序值 + id」推进，
多字段排序无法用一个游标准确表达边界，静默降级会漏行。需要多字段排序请改用 `page` 分页。

### 增量同步

```http
GET /api/open/v1/cms/contents/sync?siteCode=main&since=2026-07-01 00:00:00
```

```json
{
  "changes": [
    { "op": "upsert", "id": 12, "updatedAt": "2026-07-02 10:00:00", "content": { "id": 12, "title": "…" } },
    { "op": "delete", "id": 9,  "updatedAt": "2026-07-02 11:20:00" }
  ],
  "hasMore": true,
  "nextCursor": "MTc2…"
}
```

按 `updated_at` keyset 输出变更集，客户端只需持有上次的 `nextCursor` 即可续拉，不必全量重拉。`pageSize` 必须是正整数，上限 200、缺省 100；格式错误、超过上限或无效的 `since` 日期时间均返回 400。

- `upsert`：当前公开可见的内容
- `delete`：不再公开（下线/回收/归档/过期/**所属栏目或其祖先被停用**）**或已被彻底删除**

彻底删除的行已不在 `cms_contents` 中，靠墓碑表 `cms_content_tombstones` 补齐 —— 否则客户端
按游标永远拉不到这条变更，本地缓存会残留已删内容。`pageSize` 上限 200。

### 内容详情

```http
GET /api/open/v1/cms/contents/{idOrSlug}?siteCode=main
```

支持 id 或 slug。默认返回正文、扩展字段、标签、附件与栏目信息（无需显式 include），并返回规范 `url`。映射型内容读取目标站点保存的本地快照，来源变化由异步分发任务同步，不在请求时跨站读取。详情仅返回该站点 `published + 未回收 + 未归档 + 未过期`，且主栏目自身及全部祖先栏目有效启用的内容。

## 写入端点

| 方法 | 路径 | scope | 说明 |
|---|---|---|---|
| `POST` | `/cms/contents` | `cms:write` | 创建图文内容，默认落草稿并提交审核；`publish: true` 且三重开关全开时直接发布 |
| `PATCH` | `/cms/contents/{id}` | `cms:write` | 更新图文基础字段；带 `expectedVersion` 时版本不符返回 409。`publish` 只能用于创建或独立发布端点 |
| `POST` | `/cms/contents/{id}/submit` | `cms:write` | 提交审核 |
| `POST` | `/cms/contents/{id}/publish` | `cms:publish` | 直接发布 |
| `DELETE` | `/cms/contents/{id}` | `cms:write` | 移入回收站（彻底删除仅限后台） |

开放写入当前支持 `channel`、标题/摘要/作者/来源、正文、SEO 字段、`extend` 和外链等图文基础字段；
不接受 `contentType`、`mediaData`、附件、标签、副栏目、相关文章和排期字段，这些能力走后台 CMS API。
写入复用后台既有的 `createCmsContent` / `updateCmsContent` 管线，因此**版本快照、操作日志、
发布 outbox、静态产物、敏感词替换、编辑锁校验、素材句柄归一化与引用索引**全部自动生效，
开放 API 不另起一套写路径。

- 幂等：创建接口挂 `idempotencyGuard`，可用 `X-Idempotency-Key` 显式控制
- 来源标记：未显式提供 `source` 时自动写入 `开放应用: {AppKey}`；后台内容列表可据此筛出外部稿件
- 跨站或不存在的内容/栏目统一返回 404；缺少应用 scope、站点授权或栏目白名单返回 403，停用或非列表栏目返回 400，不泄露未授权对象的存在性
- HTML 正文、`externalLink`、`sourceUrl`、`coverImage` 和素材句柄遵守 CMS 的净化、URL policy 与站点隔离：`coverImage` 只接受安全站内绝对路径、http(s) 地址或本站 `cms-res://` 句柄；链接字段按共享协议白名单校验；`javascript:`、协议相对地址、反斜杠或跨站素材句柄均返回 400。开放写入不接受 `mediaData`。

## Webhook 事件外推

CMS 事件接入开放平台既有的 Webhook 投递管线（`app_webhook_subscriptions` + `app_webhook_deliveries`），
因此自带 **HMAC 签名、`eventId` 去重、指数退避重试、连续失败自动禁用、投递日志与手工重投**。

| 事件 | 触发时机 |
|---|---|
| `cms.content.published` | 手动发布 / 工作流通过 / 定时发布 |
| `cms.content.updated` | 内容更新 |
| `cms.content.offline` | 手动下线 / 过期自动下线 |
| `cms.content.recycled` | 移入回收站 |
| `cms.content.deleted` | 彻底删除 |
开放事件契约仅包含上表五类内容事件；`cms.comment.created` 与 `cms.form.submitted` 属于保留枚举，评论/表单提交不会产生这两类事件，应用不得依赖其投递。

### 可靠性

事件在**业务事务内**登记为任务中心 outbox（`cms-webhook-emit`），worker 取出后再 emit 到事件总线：
正常登记成功时，outbox 与业务事务一起提交；worker 或入队失败由任务中心的 pending 恢复扫描补投。outbox 写入失败只记录日志且不阻断业务事务，调用方必须把 Webhook 视为尽力而为交付并通过监控发现登记失败。

### 投递范围

CMS 事件是**站点域**事件（无 clientId），只投递给「订阅了该事件类型**且已被授权该站点**」的应用 ——
授权表是唯一的可见性来源，未授权应用即便订阅了事件类型也收不到，避免通过 Webhook 侧信道
泄露其他站点的内容变更。订阅还可用 `cmsSiteId` 进一步收窄到单站点。

### 站点级 Webhook

站点设置里的「Webhook」配置底层托管为一条 `internal` 订阅（`clientId` 形如 `cms-site:{siteId}`，不对应真实开放应用），因此站点级回调同样享有重试、投递日志与自动禁用。事件清单、信封结构与签名头细节见 [SEO 与流量 → Webhook 事件外推](./seo#webhook-事件外推)。

## 错误约定

| code | 说明 |
|---|---|
| 400 | 查询 DSL/写入参数不合法（白名单外的 sort/fields/include、非正整数或超过上限的分页值、格式错误的游标/日期、倒置的日期范围、不可用扩展字段或不安全链接） |
| 401 | AppKey 无效或签名校验失败 |
| 403 | 未授权 scope，或应用未被授权该站点/栏目，或直接发布三重开关未全开 |
| 404 | 站点/栏目/标签/内容不存在或未发布 |
| 409 | `expectedVersion` 与当前版本不一致 |
| 429 | 触发限流套餐配额或幂等窗口 |

## 相关能力

- **草稿预览链接**：后台签发的 HMAC 签名临时 URL（2h 有效），见 [内容管线](./content-pipeline#草稿预览链接)
- 前台公开接口（无需签名）：评论提交/点赞、表单提交、浏览计数 beacon、广告令牌/曝光/点击中转，均带 IP 限流、幂等或去重防刷；评论和表单提交还接入规则中心名单守卫（黑名单 403、灰名单观察标注）
