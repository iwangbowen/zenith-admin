# 开放 API 目录

本页汇总开放平台相关路径。管理端与开发者中心 API 使用业务响应信封；OAuth2 标准端点按 RFC 返回顶层格式；开放网关端点在 `/api/open/v1/*` 下统一经过鉴权、计量和限流。

---

## 开放网关端点

| 方法 | 路径 | Scope | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/open/v1/ping` | 无 | 连通性测试 |
| `GET` | `/api/open/v1/echo` | `data:read` | 查询参数回显 |
| `POST` | `/api/open/v1/echo` | `data:write` | 请求体回显，用于验证 body 参与签名 |
| `GET` | `/api/open/v1/userinfo` | `user:read` | 当前调用主体信息 |
| `POST` | `/api/open/v1/rules/evaluate` | `rules:evaluate` | 规则中心统一求值 |

### 规则求值

请求体：

```json
{
  "kind": "table",
  "key": "asset_key",
  "facts": { "amount": 100 },
  "subjects": ["optional-subject"]
}
```

- `kind` 使用规则中心支持的资产类型。
- `key` 为规则资产 key，不能为空。
- `facts` 为求值事实。
- 名单类资产可传 `subjects`。
- 调用方记录为 `open.<clientId>`，source 为 `open`。

## 开放 CMS 端点

所有路径挂载在 `/api/open/v1` 下。

| 方法 | 路径 | Scope | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/open/v1/cms/channels` | `cms:read` | 站点栏目树（启用中） |
| `GET` | `/api/open/v1/cms/contents` | `cms:read` | 已发布内容查询，支持过滤 / 排序 / 字段裁剪 / page 分页 |
| `GET` | `/api/open/v1/cms/contents/cursor` | `cms:read` | 已发布内容游标翻页 |
| `GET` | `/api/open/v1/cms/contents/sync` | `cms:read` | 内容增量同步，包含删除变更 |
| `GET` | `/api/open/v1/cms/contents/{idOrSlug}` | `cms:read` | 已发布内容详情 |
| `POST` | `/api/open/v1/cms/contents` | `cms:write` | 创建内容，默认落草稿并提交审核 |
| `PATCH` | `/api/open/v1/cms/contents/{id}` | `cms:write` | 更新内容，支持 `expectedVersion` 乐观锁 |
| `POST` | `/api/open/v1/cms/contents/{id}/submit` | `cms:write` | 提交审核 |
| `POST` | `/api/open/v1/cms/contents/{id}/publish` | `cms:publish` | 直接发布 |
| `DELETE` | `/api/open/v1/cms/contents/{id}` | `cms:write` | 移入回收站 |

### CMS 查询参数

| 参数 | 说明 |
| --- | --- |
| `siteCode` | 必填，站点标识 |
| `channel` | 栏目标识，逗号分隔多选，聚合主栏目与副栏目 |
| `channelPath` | 栏目路径前缀，包含全部子栏目 |
| `tag` | 标签 slug，逗号分隔多选 |
| `contentType` | 内容类型，逗号分隔 |
| `keyword` | 全文检索 |
| `author` | 作者 |
| `model` | 内容模型标识 |
| `isTop` / `isRecommend` / `isHot` / `isOriginal` | 布尔标记过滤 |
| `publishedFrom` / `publishedTo` | 发布时间范围 |
| `sort` | 排序字段，例如 `-publishedAt`；可用字段由 CMS 开放查询常量控制 |
| `fields` | 字段裁剪，逗号分隔；`id` 始终返回 |
| `include` | 关联展开 |
| `page` / `pageSize` | page 分页 |
| `cursor` | 游标翻页，传入后忽略 `page` |

写入端点还要求 `cms_open_app_grants` 中存在启用的站点授权；栏目白名单为空表示该站点全部栏目。直接发布需要同时满足 `cms:publish`、授权行 `canPublish=true` 与站点 `openApiPublishEnabled=true`。

## 开放网盘端点

所有路径挂载在 `/api/open/v1` 下。应用只能看到网盘管理员在「合规治理 → 开放应用授权」中授予的空间（`drive_open_app_grants`），
未授权空间的节点一律表现为不存在；授权角色再决定空间内的能力：`viewer` 只读元数据、`downloader` 可下载内容、`editor` 可上传。

| 方法 | 路径 | Scope | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/open/v1/drive/spaces` | `drive:read` | 当前应用被授权的空间（含角色、用量、配额、是否归档） |
| `GET` | `/api/open/v1/drive/nodes` | `drive:read` | 浏览目录（`spaceId` 必填，`parentId` 缺省为根级）或按 `keyword` 在整个空间搜索 |
| `GET` | `/api/open/v1/drive/nodes/{id}` | `drive:read` | 节点元数据（含 `legalHold`），不暴露内部对象 id |
| `GET` | `/api/open/v1/drive/nodes/{id}/content` | `drive:read` | 下载当前版本内容（支持 Range）；需授权角色 ≥ `downloader` |
| `POST` | `/api/open/v1/drive/nodes` | `drive:write` | multipart 上传（`file`、`spaceId`、可选 `parentId` / `conflictPolicy`）；需授权角色 `editor`，以授权人身份落盘并复用配额与内容策略 |

下载与上传都会写入文件动态（`detail.viaOpenApp = clientId`），归档空间与法律保留的限制同样生效。

## OAuth2 标准端点

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/oauth2/authorize/info` | 获取授权页应用与 Scope 信息 |
| `POST` | `/api/oauth2/authorize` | 用户确认授权 |
| `POST` | `/api/oauth2/token` | 令牌端点 |
| `POST` | `/api/oauth2/token/revoke` | 令牌撤销 |
| `POST` | `/api/oauth2/token/introspect` | 令牌自省 |
| `GET` | `/api/oauth2/userinfo` | OIDC UserInfo |

## 管理与开发者 API

| 前缀 | 说明 |
| --- | --- |
| `/api/developer-apps` | 开发者自助应用、配额用量、调试台 |
| `/api/oauth2/clients` | 管理员应用治理、审核、令牌与授权记录 |
| `/api/api-scopes` | Scope 注册表 |
| `/api/rate-plans` | 限流套餐 |
| `/api/open-signature` | 签名算法与在线验签工具 |
| `/api/open-api-stats` | 调用统计与日志 |
| `/api/app-webhooks` | Webhook 订阅与投递日志 |

## 管理菜单与权限

| 菜单 | 路径 | 关键权限 |
| --- | --- | --- |
| 应用管理 | `/system/oauth2-apps` | `system:oauth2-apps:view`、`system:oauth2-apps:manage` |
| 我的应用 | `/open-platform/my-apps` | 登录可见 |
| API Scope | `/open-platform/api-scopes` | `open:scope:view`、`open:scope:manage` |
| 限流套餐 | `/open-platform/rate-plans` | `open:rate-plan:view`、`open:rate-plan:manage` |
| 调用统计 | `/open-platform/stats` | `open:stats:view` |
| 签名验签 | `/open-platform/signature` | `open:signature:use` |
| Webhook 订阅 | `/open-platform/webhooks` | `open:webhook:view`、`open:webhook:manage` |
| SDK 示例 | `/open-platform/sdk` | `open:sdk:view` |
| API 调试台 | `/open-platform/debug` | 登录可见 |

## 运行配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `OPEN_RATE_LIMIT_FAIL_CLOSED` | `true` | 限流服务异常时是否拒绝请求 |
| `OPEN_WEBHOOK_AUTO_DISABLE_FAILURES` | `5` | Webhook 连续终态失败自动停用阈值 |
| `OPEN_SECRET_ROTATION_GRACE_HOURS` | `24` | 应用密钥轮换旧密钥宽限小时数 |
| `OPEN_GATEWAY_REQUIRE_APPROVAL` | `true` | 网关是否要求应用审核通过 |
| `OPEN_WEBHOOK_ALLOWED_HOSTS` | 空 | Webhook SSRF 防护放行主机，逗号分隔 |
| `OPEN_API_INTERNAL_BASE_URL` | `http://127.0.0.1:<PORT>` | 调试台内部请求基地址 |

