# 安全体系

本文描述后端安全边界、认证授权、中间件和与安全相关的治理能力。实现入口以 `packages/server/src/app.ts`、`packages/server/src/middleware/*`、`packages/server/src/routes/identity/*`、`packages/server/src/routes/platform/*` 为准。

## 中间件链路

`createApp()` 在路由挂载前装配全局中间件，顺序如下：

1. Prometheus / HTTP metrics / OpenTelemetry（按配置启用）。
2. `requestId`、`contextStorage`、`requestTrace`。
3. `secureHeaders`。
4. `compress`：排除长连接、大文件、AI 流、客户端制品等响应。
5. CORS 与 Mastra CORS。
6. CSRF：排除 SAML ACS、开放平台 OAuth2 token / authorize、Open API 等回调型接口。
7. Hono logger、HTTP 流量日志、可选 Server-Timing。
8. 可选请求体大小限制与 `/api/*` 请求超时。
9. IP 访问控制。
10. 具名限流：`auth`、`captcha`、`sensitive` 等。
11. 路径绑定限流。
12. 维护模式。
13. 业务路由。

## 认证令牌

管理端 API 使用 `Authorization: Bearer <token>`。`authMiddleware` 支持两类凭据：

- 管理员 JWT；
- 个人 API Token，令牌前缀为 `zat_`，服务端按 SHA-256 摘要校验。

JWT payload 包含：`userId`、`username`、`roles`、`tenantId`、可选 `viewingTenantId`、`jti`、`authType`、`apiTokenId`。管理端接口拒绝会员 token。Access token 有效期为 2 小时，Refresh token 有效期为 30 天，同一次签发共享同一个 `jti`。

会话状态保存在 Redis，每个 `jti` 对应三类 key：`session:{jti}`（在线会话，8h 滑动 TTL）、`refresh:{jti}`（refresh 授权，30d）、`blacklist:{jti}`（吊销标记，2h）。refresh token 本身只是承载 `jti` 的凭据，能否续签以 `refresh:{jti}` 是否存在为准；登出、强制下线、改密 / 重置密码、管理员重置密码、禁用 / 删除用户都会吊销 `jti`（写黑名单 + 删除会话与 refresh 授权），因此未过期的 access token 与 refresh token 会同时立即失效。认证中间件会检查黑名单并 touch 会话；Redis 访问异常时采用 fail-open（最长 2h 窗口）。会话缺失但 JWT 合法且未被吊销时，服务端会懒重建会话记录（仅影响在线列表，不会重新签发 refresh 授权）。

## 登录、刷新与退出

管理端认证接口位于 `/api/auth`：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/api/auth/login` | 用户名或手机号 + 密码登录，可携带验证码、租户编码、设备信息、设备 ID、可信设备标记 |
| `POST` | `/api/auth/refresh` | 一次性消费 refresh 授权并**轮换**：返回新 `jti` 的 access token 与 refresh token，旧 `jti` 立即吊销；被盗的 refresh token 最多只能用一次 |
| `POST` | `/api/auth/logout` | 吊销当前 `jti`（access token 拉黑、refresh 授权删除、会话移除） |
| `POST` | `/api/auth/logout-by-refresh` | 按 refresh token 注销对应会话，用于多账号切换器移除停靠账号 |
| `GET` | `/api/auth/me` | 查询当前登录人 |

刷新令牌会校验用户状态、租户状态和租户到期时间。登录失败锁定使用 Redis key：`login_attempt:` 与 `login_lock:`，并叠加 `REDIS_KEY_PREFIX`。

## 授权与审计

业务权限由 `guard()` 统一处理：

- 校验权限码；
- 可选校验 License feature；
- 可选记录操作日志；
- 支持 `setAuditBeforeData()`、`setAuditAfterData()` 写入变更快照。

平台管理员判定使用 `platformAdminOnly()` 或 `isPlatformAdmin(user)`。在多租户模式下，平台超管必须同时满足 `roles` 包含 `super_admin` 且 `tenantId === null`。

## 多因素、可信设备与登录风险

身份安全策略由运行时设置模块 `identitySecurity`（租户作用域，见[运行时设置](./settings.md)）和身份路由共同实现：

- `mfa.enabled`、`mfa.mode`、`mfa.rememberDeviceDays` 控制 MFA 与可信设备；
- `risk.enabled`、`risk.newDeviceAction` 控制新设备风险动作；
- `lockout.maxAttempts` / `lockout.durationMinutes` 与 `password.*` 控制登录锁定与密码策略，按用户所属租户解析，未覆盖时继承平台值；
- MFA 因子表为 `user_mfa_factors`，可信设备表为 `user_trusted_devices`；
- 登录风险事件写入 `login_risk_events`，查看要求独立的 `system:login-risk:list` 权限；列表与总数都按 `tenantCondition` 限定当前租户视角，不因策略继承而共享平台或其他租户的事件。

## IP 访问控制

IP 访问控制由 `packages/server/src/middleware/ip-access.ts` 实现，配置来自运行时设置模块 `ipAccess`（平台作用域，进程内缓存 + 跨实例失效，管理页 `/system/ip-access`）：

| 字段 | 说明 |
| --- | --- |
| `whitelistEnabled` | 是否启用白名单 |
| `whitelist` | 白名单数组，支持 IP 与 CIDR（IPv4 / IPv6） |
| `blacklistEnabled` | 是否启用黑名单（黑名单优先于白名单） |
| `blacklist` | 黑名单数组，支持 IP 与 CIDR |

免检精确路径包括登录、验证码、注册、刷新、找回密码、重置密码；免检前缀包括 `/api/oauth/` 与 `/api/auth/oauth/`。被拦截请求写入 `ip_access_logs`，查询接口位于 `/api/ip-access-logs`。

`getClientIp()` 只信任 `TRUSTED_PROXY_CIDRS` 中代理转发的 `x-forwarded-for` / `x-real-ip`；非可信代理请求使用 TCP 连接 IP。

## 限流

限流包含代码内置默认规则、数据库规则和路径绑定规则。规则表为 `rate_limit_rules`，管理接口位于 `/api/rate-limit`，权限为：

- `system:rate-limit:view`
- `system:rate-limit:manage`

具名默认规则包括 `auth`、`captcha`、`sensitive`、`analytics-ingest`、`error-report`、`report_public_share`、`chat_send`、`chatbi_ask`、`report_chatbi_write`、`report_fill_write`、`ai_chat_send`、`ai_share_view`。种子数据会写入常用规则，数据库中也可维护自定义规则。

## 数据脱敏

数据脱敏是**契约驱动、出口强制**的：

- **声明**：敏感字段在 `@zenith/shared` 契约实体上用 `sensitive(z.string(), 'phone')` 标记（`core/sensitive.ts`），
  这是「哪些字段是 PII」的唯一真相。已声明：`User.email / phone`、`RoleUser.email`、`PositionMember.email`、
  `UserGroupMember.email`、`Tenant.contactPhone`、`Member.email / phone`、`MemberOption.phone`、`MemberRecharge.memberPhone`、
  `PaymentDispute.complainantPhone`、`SmsSendLog.phone`、`EmailSendLog.toEmail`。
- **注册表**：`defineContractRoute` 在路由定义时静态遍历响应 schema（`collectSensitiveFields`），把敏感字段登记进
  `lib/data-mask/registry.ts`——注册表即「本进程实际对外暴露的敏感字段全集」，不再扫描数据库列名猜测。
- **策略**：`data_mask_policies` 只保存与契约默认不同的覆盖记录（脱敏类型 / 自定义规则 / 豁免权限 / 停用）；
  没有记录的字段按契约默认类型脱敏、仅平台超管免脱敏。策略进程内缓存，`data_mask_policies` 表的
  `notify_cache_invalidate` 触发器经 `invalidation-bus` 让所有实例即时失效。
- **响应出口**：含敏感字段的 JSON 契约路由由 `lib/data-mask/boundary.ts` 自动包裹：handler 经 `c.json(okBody(...))`
  出口时按当前查看者的决策沿路径打码（顶层 / 分页 / 嵌套实体统一处理，写时复制不改写 handler 持有的对象）。
  决策：平台超管明文；策略停用不打码；拥有任一豁免权限（`exemptPermissions`）明文；其余打码。
  匿名 / 会员端 / 开放 API 请求按最严格口径打码。`unmasked: true` 的自视图端点（`/api/auth/me`、`/api/member/auth/me` 等）除外。
- **请求入口**：写操作请求体在敏感字段上携带「像脱敏输出」的值（`138****1234`）一律 400——
  这是非豁免用户把详情回填进表单再原样保存时会发生的事，放行等于把掩码写进数据库。前端配套
  `useSensitiveFormFields` + `SensitiveFormInput`：被打码的字段在编辑表单中锁定，点「修改」才可输入，未修改不提交。
- **按需查看明文**：`POST /api/data-mask/reveal`（权限 `system:data-mask:reveal`）按实体登记的加载器
  （`registerRevealSource`，复用该实体自己的读取函数与可见性口径）返回单个字段明文，逐次写操作日志
  （记录实体 / 记录 ID / 字段，不记录明文）。前端 `SensitiveText` 提供查看按钮，明文 30 秒后自动恢复掩码。
- **脱敏原语 fail-closed**：手机号 / 邮箱 / 证件号等格式不符合预期时退回尾部保留策略，不放行明文；
  `custom` 缺规则用默认规则；类型：`phone`、`email`、`id_card`、`name`、`bank_card`、`address`、`redact`、`custom`。
- **导出中心**：列声明 `sensitive: true, maskKey: 'User.phone'` 绑定契约字段，脱敏导出按同一生效策略打码
  （策略停用即不再视为敏感，与页面口径一致）；导出不考虑查看者豁免。

接口位于 `/api/data-mask`：`GET /fields`（注册表 + 生效策略，`system:data-mask:list`）、
`GET /effective`（当前用户视角：被打码的字段键与是否可查看明文，登录即可）、
`PUT / DELETE /fields/{entity}/{field}`（保存 / 恢复默认策略，`system:data-mask:update`，多租户模式仅平台管理员）、
`POST /reveal`。权限 `system:data-mask:bypass` 是推荐配置到策略 `exemptPermissions` 的通用免脱敏权限码。

## 安全头、CORS、CSRF

- 安全响应头由 `secureHeaders` 设置，`X-Frame-Options: SAMEORIGIN` 对全部响应生效（本进程直出 CMS 前台、短链 / 退订 / 表单提示页等 HTML）。
- 直出 HTML 的内容安全策略由 `lib/html-security-headers.ts` 的中间件统一补齐：凡 `text/html` 且未自带 CSP 的响应，按正文实际包含的内联 `<script>` 计算 sha256 哈希放行（不使用 `'unsafe-inline'`），并设置 `object-src 'none'`、`base-uri 'self'`、`form-action 'self'`、`frame-ancestors 'self'`，第三方仅放行 Cloudflare Turnstile；CMS 静态化产物出站时同样计算，`/api/docs`（Swagger UI，依赖 CDN 脚本）除外。该中间件位于 `compress` 内侧，读取的是压缩前正文。
- 管理端 SPA 的 CSP 在 Vite 构建期注入入口 HTML 的 `<meta>`（`packages/web/vite.config.ts`），帧保护由 nginx 下发（见 [Docker 部署 · Nginx 行为](../guide/docker#nginx-行为)）。
- CORS 使用 `CORS_ORIGIN` 与 `ALLOWED_ORIGINS`。
- CSRF 中间件保护需要浏览器 Cookie 语义的写入请求；第三方回调、OAuth2 授权端点和 Open API 等机器接口按排除规则处理。

## 数据表速查

| 能力 | 表 |
| --- | --- |
| 登录日志 | `login_logs` |
| 操作日志 | `operation_logs` |
| IP 拦截日志 | `ip_access_logs` |
| 限流规则 | `rate_limit_rules` |
| OAuth 配置 | `oauth_configs` |
| OAuth 账号绑定 | `user_oauth_accounts` |
| MFA 因子 | `user_mfa_factors` |
| 可信设备 | `user_trusted_devices` |
| 登录风险事件 | `login_risk_events` |
| 数据脱敏策略 | `data_mask_policies` |
