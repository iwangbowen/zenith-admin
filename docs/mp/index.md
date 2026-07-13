# 微信公众号

公众号管理是一个**一级菜单目录**，将微信公众平台的开发者能力（账号、粉丝、消息、菜单、素材、群发、模板消息、网页授权、客服、数据等）整合进后台，支持**多公众号统一管理**。所有路由挂载在 `/api/mp` 前缀下，业务表集中在 `packages/server/src/db/schema/mp.ts` 的 `mp_*` 系列表，前端页面集中在「公众号管理」目录（`packages/web/src/pages/mp/`）。

> 与微信的所有交互统一通过 `packages/server/src/lib/wechat/` 封装，外呼走 `http-client`，`access_token` / `jsapi_ticket` 经 Redis 缓存。示例种子账号未配置真实 AppSecret，调用真实接口时会返回 `40013 invalid appid`，并被统一映射为 `400` 业务错误（便于在未接入真实公众号时演示页面）。

---

## 能力地图

| 分组 | 能力 | 文档 |
| --- | --- | --- |
| 账号 | 多公众号账号、凭证与加密模式、连接测试、内容安全开关、关注自动建会员 | [账号管理](./accounts.md) |
| 回调 | 服务器配置校验、验签与 AES 加解密、消息处理管线、重试与去重 | [消息回调接入](./callback.md) |
| 粉丝 | 粉丝同步、标签管理、黑名单、会员体系打通（绑定 / 扫码送积分 / VIP 优先接入） | [粉丝、标签与会员](./fans.md) |
| 消息 | 消息记录、客服消息（富媒体）、自动回复（关注 / 关键词 / 默认，富媒体 + 正则 + 转人工 + 未命中热词） | [消息与自动回复](./messages.md) |
| 客服 | 多客服账号、实时会话状态机（接入 / 转接 / 超时自动路由 / 会话分配）、满意度、会话报表 | [多客服会话治理](./customer-service.md) |
| 菜单 | 自定义菜单（按钮类型扩展）、个性化菜单（按规则下发 + 匹配测试） | [菜单管理](./menus.md) |
| 素材 | 永久素材（图片 / 语音 / 视频 / 缩略图，真实二进制上传）、图文草稿 | [素材与图文草稿](./materials.md) |
| 运营 | 群发（预览 / 定时 / 发送结果）、模板消息（行业 / 同步 / 批量 / 回执）、带参二维码（扫码送积分） | [群发、模板消息与二维码](./marketing.md) |
| 网页 | 网页授权 OAuth2（含公开回调）、JS-SDK `wx.config` 签名 | [网页授权与 JS-SDK](./web-dev.md) |
| 数据 | 基础统计、数据立方（用户 / 消息 / 图文 / 分享 / 接口分析）、内容安全校验 | [数据统计与内容安全](./statistics.md) |

---

## 架构约定

- **微信能力封装**：`packages/server/src/lib/wechat/` 按能力拆分（`access-token`、`api`、`menu`、`material`、`draft`、`template`、`broadcast`、`qrcode`、`reply`、`oauth`、`datacube`、`kf`、`security`、`jssdk`、`users`、`tags`、`messages`、`crypto`、`xml`、`signature` 等），统一通过 `index.ts` 桶导出。
- **错误映射**：微信业务错误（`errcode` 非 0）抛 `WechatApiError`，由 `lib/wechat-error.ts` 的 `mapWechatError` 统一映射——`WechatApiError → 400`、其余 → `502`。
- **租户隔离**：所有 `mp_*` 表带 `tenant_id`，鉴权路由统一用 `tenantScope()` 过滤；**公开回调无登录上下文**，按 `accountId` 直接查询并携带账号 `tenantId` 落库。
- **统一响应**：`{ code: 0, message, data }`；DTO 集中在 `lib/dtos/mp.ts`，路由用 `defineOpenAPIRoute` + 显式 `middleware: [authMiddleware, guard(...)]`。
- **凭证缓存**：`access_token`（key `mp:access_token:{id}`）与 `jsapi_ticket`（key `mp:jsapi_ticket:{id}`）缓存于 Redis，留 300s 安全余量。

---

## 数据表总览

| 表 | 说明 |
| --- | --- |
| `mp_accounts` | 公众号账号（AppID / AppSecret / Token / EncodingAESKey / 加密模式 / 类型 / 内容安全开关 / 关注建会员开关 / 默认标记） |
| `mp_tags` | 用户标签（本地标签 ↔ 微信 `tagid` 映射） |
| `mp_fans` | 粉丝（openid / 资料 / 标签 / `unionid` / `member_id` / `blacklisted`） |
| `mp_messages` | 消息收发记录（in / out，含去重 `msg_id`） |
| `mp_auto_replies` | 自动回复（关注 / 关键词 / 默认；富媒体 + `match_type` exact/contain/regex + `transfer_to_kf`） |
| `mp_unmatched_keywords` | 自动回复未命中热词（按 account + keyword 累计） |
| `mp_menus` | 默认自定义菜单（草稿 / 已发布） |
| `mp_conditional_menus` | 个性化菜单（按 `match_rule` 下发，含微信 `menuid`） |
| `mp_materials` | 永久素材 |
| `mp_drafts` | 图文草稿 |
| `mp_message_templates` / `mp_template_send_logs` | 模板消息库 / 发送日志（含送达回执状态） |
| `mp_broadcasts` | 群发任务（含 `scheduled_at` 定时） |
| `mp_qrcodes` | 带参二维码（含 `reward_points` 扫码奖励） |
| `mp_kf_accounts` | 多客服账号 |
| `mp_kf_sessions` / `mp_kf_session_events` / `mp_kf_routing_configs` | 多客服会话状态机 / 事件流水 / 路由治理配置 |

---

## 回调接入

公众号消息回调为**公开端点**（`/api/public/mp/callback/{accountId}`，无需登录，由微信服务器调用），按顺序处理：**入站落库去重 → 带参二维码扫码计数 + 扫码送积分 → 关注自动建会员 → 多客服会话接入 → 模板消息送达回执 → 自动回复**。

服务器配置、验签与加解密、重试与去重语义详见 [消息回调接入](./callback.md)；多客服实时事件（`mp-kf:session-*`）见 [WebSocket 事件清单](../backend/websocket-events.md)。

---

## 菜单与权限

公众号管理菜单位于种子数据 `seed-data.ts` 的 `1000` 段（目录 `公众号管理`，`name: MpCenter`），权限码统一以 `mp:` 开头，超级管理员默认绑定全部。各页面与权限码对应关系见对应能力页的「菜单与权限」小节。

---

## 相关文档

- [后端 API 规范](../backend/api-conventions.md)
- [外呼 HTTP 客户端](../backend/http-client.md)
- [WebSocket 事件清单](../backend/websocket-events.md)
- [定时任务](../backend/cron-jobs.md)
- [会员中心](../member/index.md)
