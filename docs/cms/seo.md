# SEO 与流量

## 三级 TDK 覆盖

SEO 标题/关键词/描述按 **内容 → 栏目 → 站点** 三级向上回退，留空即继承。详情页额外输出 canonical、Open Graph 与 Article JSON-LD 结构化数据。

## SEO 管理页

「SEO 管理」（权限 `cms:seo:manage`）包含三个 Tab：

### 301/302 重定向

站内旧路径 → 新地址映射，前台路由优先级最高。**目标地址仅允许站内路径（`/` 开头）或本系统站点域名的完整 URL**——创建/更新时校验 + 解析时兜底双重防护，杜绝开放重定向被用作钓鱼跳板。

### 内链词

正文关键词自动加链（SEO 内链建设）。仅处理 HTML 文本节点，跳过 `<a>/<script>/<style>` 内部，每词限次替换；URL 经 HTML 属性转义防注入。

### 推送日志

发布内容后自动向搜索引擎主动推送：

- **百度普通收录**：站点配置 `baiduPushToken`
- **IndexNow**（Bing 等）：站点配置 `indexNowKey`，key 校验文件自动托管于 `/{key}.txt`

推送结果（成功/状态码/响应）留痕于 `cms_push_logs`。

## sitemap / robots / RSS

- `sitemap.xml`：动态生成（Redis 600s 缓存），含首页/栏目/详情，上限 5 万条
- `robots.txt`：站点级独立配置
- RSS 2.0：站点级 `/rss.xml` 与栏目级 `/{channelPath}/rss.xml`

## 死链检测

检索管理 →「死链检测」Tab 提交任务中心任务，扫描已发布内容中的站内/外部链接（SSRF 防护），输出死链行级明细。

## Webhook 事件外推

站点设置「Webhook」配置回调地址后，以下事件自动 POST 推送（v1.6.0+）：

| 事件 | 触发时机 |
|------|---------|
| `content.published` | 手动发布 / 工作流通过 / 定时发布 |
| `content.offline` | 手动下线 / 过期自动下线 |
| `content.recycled` | 移入回收站 |

请求体：

```json
{
  "event": "content.published",
  "occurredAt": "2026-07-20 12:00:00",
  "site": { "id": 1, "code": "main" },
  "content": { "id": 42, "channelId": 3, "title": "…", "slug": null, "status": "published" }
}
```

配置「签名密钥」后请求头携带 `X-Cms-Signature: HMAC-SHA256(body)`，接收方验签防伪造。推送为 fire-and-forget（5s 超时 + SSRF 防护），失败仅记日志不影响主流程。
