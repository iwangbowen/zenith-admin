# 开放能力（Headless API）

CMS 内容可通过开放平台网关以 **Headless** 方式供外部系统消费（v1.6.0+）。

## 接入方式

走开放平台标准链路：创建开发者应用 → 授权 scope `cms:read` → HMAC 签名调用（经鉴权/计量/限流三层网关）。签名规范见开放平台文档。

## 端点清单

Base：`/api/open/v1/cms`，全部只读，仅返回**已发布**内容。

### 栏目树

```http
GET /api/open/v1/cms/channels?siteCode=main
```

返回站点启用中的栏目树（含 id/name/slug/path/type/children）。

### 内容列表

```http
GET /api/open/v1/cms/contents?siteCode=main&channelId=3&page=1&pageSize=20
```

- 聚合主栏目与副栏目内容，置顶优先、发布时间倒序
- `pageSize` 上限 50；列表**不含正文**（减小载荷）
- 返回 `{ list, total, page, pageSize }`

### 内容详情

```http
GET /api/open/v1/cms/contents/{id}?siteCode=main
```

返回完整字段（含正文 HTML、扩展字段 extend、标签）。

## 错误约定

| code | 说明 |
|------|------|
| 400 | 缺少 channelId 等必要参数 |
| 403 | 应用未授权 scope `cms:read` |
| 404 | 站点不存在（siteCode 无效）/ 内容不存在或未发布 |

## 相关能力

- **草稿预览链接**：后台签发的 HMAC 签名临时 URL（2h 有效），见 [内容管线](./content-pipeline#草稿预览链接)
- **Webhook 事件外推**：内容发布/下线/回收实时通知外部系统，见 [SEO 与流量](./seo#webhook-事件外推)
- 前台公开接口（无需签名）：评论提交/点赞、表单提交、浏览计数 beacon、广告点击中转，均带 IP 限流与去重防刷
