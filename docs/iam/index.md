# 权限与组织

本页描述 Zenith Admin 当前 IAM 实现：管理员认证、RBAC、动态菜单、数据权限、组织架构、账号安全、企业身份源、通讯录同步、租户与套餐。事实来源以 `packages\server\src\routes\identity`、`packages\server\src\services\identity`、`packages\shared\src\identity` 与 `packages\shared\src\seed\menus` 为准。

## 模块边界

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 共享契约 | `packages\shared\src\identity` | 用户、角色、菜单、部门、岗位、用户组、企业身份源、通讯录同步的类型、常量与 Zod schema |
| 数据模型 | `packages\server\src\db\schema\core.ts`、`auth.ts`、`identity-providers.ts`、`directory-sync.ts` | IAM 主表、授权关系表、账号安全表、企业身份源与通讯录同步表 |
| 服务层 | `packages\server\src\services\identity` | 认证、权限解析、组织管理、用户管理、企业身份源、通讯录同步、租户生命周期 |
| HTTP 路由 | `packages\server\src\routes\identity` | `/api/auth`、`/api/users`、`/api/roles` 等管理端 API |
| 前端页面 | `packages\web\src\pages\users`、`packages\web\src\pages\system` | 用户、组织、角色、菜单、租户、安全策略、身份源、同步源、在线会话等页面 |
| 种子 | `packages\shared\src\seed\menus\system.ts`、`settings.ts`、`identity.ts` | 系统菜单、按钮权限、内置角色/组织/用户等初始数据 |

## RBAC 与权限解析

### 数据模型

| 表 | 说明 |
| --- | --- |
| `users` | 管理端用户；用户名、昵称、邮箱、手机号、部门、租户、状态、偏好、收藏菜单、用户级数据权限、密码更新时间、最近登录时间 |
| `roles` | 角色；包含 `code`、`status`、`dataScope`、`tenantId` |
| `menus` | 菜单/按钮树；`type` 为 `directory`、`menu`、`button`，按钮节点通过 `permission` 承载权限码，`featureKey` 参与套餐/License 功能过滤 |
| `user_roles` | 用户直接角色 |
| `role_menus` | 角色授权菜单/按钮 |
| `user_menus` | 用户直接菜单/按钮授权 |
| `user_groups` | 用户组；`memberMode` 为 `static` 或 `dynamic`，动态组用 `memberRule` 计算成员 |
| `user_group_members` | 用户组成员物化表 |
| `user_group_roles` | 用户组绑定角色，组内成员自动继承角色权限 |
| `role_dept_scopes` | 角色自定义数据范围部门 |
| `user_dept_scopes` | 用户自定义数据范围部门 |

### 权限计算

`packages\server\src\lib\permissions.ts` 是权限解析入口：

1. 读取用户直接角色、用户直接菜单、用户组继承角色。
2. 仅启用角色与启用菜单参与授权。
3. 多租户模式下，菜单 `featureKey` 与租户套餐功能集取交集；`featureKey = null` 的核心菜单保留。
4. 输出去重后的 `permissions` 与 `menuIds`。
5. 结果以 Redis 键 `{prefix}perm:{userId}` 缓存 300 秒，Redis 不可用时退化为进程内缓存。
6. 用户、角色、菜单、用户组授权变更后调用 `clearUserPermissionCache()` 清除缓存。

平台超管判定必须同时满足角色 code 为 `super_admin` 且角色 `tenantId` 为 `null`，避免租户自建同名角色获得平台级权限。

### 菜单与按钮权限

菜单树由 `menus` 表持久化，初始项来自 `packages\shared\src\seed\menus`。当前 IAM 相关入口：

| 页面 | 路由 | 组件 | 主要权限码 |
| --- | --- | --- | --- |
| 用户管理 | `/system/users` | `users/UsersPage` | `system:user:list`、`system:user:create`、`system:user:update`、`system:user:delete`、`system:user:import`、`system:user:export`、`system:user:export-raw`、`system:user:assign` |
| 部门管理 | `/system/departments` | `system/departments/DepartmentsPage` | `system:department:list`、`system:department:create`、`system:department:update`、`system:department:delete` |
| 岗位管理 | `/system/positions` | `system/positions/PositionsPage` | `system:position:list`、`system:position:create`、`system:position:update`、`system:position:delete` |
| 菜单管理 | `/system/menus` | `system/menus/MenusPage` | `system:menu:list`、`system:menu:create`、`system:menu:update`、`system:menu:delete` |
| 用户组 | `/system/user-groups` | `system/user-groups/UserGroupsPage` | `system:user-groups:list`、`system:user-groups:create`、`system:user-groups:update`、`system:user-groups:delete`、`system:user-groups:assign` |
| 角色管理 | `/system/roles` | `system/roles/RolesPage` | `system:role:list`、`system:role:create`、`system:role:update`、`system:role:delete`、`system:role:assign` |
| 租户管理 | `/system/tenants` | `system/tenants/TenantsPage` | `system:tenant:list`、`system:tenant:create`、`system:tenant:update`、`system:tenant:delete` |
| 租户套餐 | `/system/tenant-packages` | `system/tenant-packages/TenantPackagesPage` | `system:tenant-package:list`、`system:tenant-package:create`、`system:tenant-package:update`、`system:tenant-package:delete`、`system:tenant-package:assign` |
| 身份安全 | `/system/identity-security` | `system/identity-security/IdentitySecurityPage` | `system:identity-security:manage` |
| 企业身份源 | `/system/identity-providers` | `system/identity-providers/IdentityProvidersPage` | `system:identity-provider:manage` |
| 通讯录同步源 | `/system/directory-sync/sources` | `system/directory-sync/DirectorySyncSourcesPage` | `system:dirsync-source:list`、`system:dirsync-source:create`、`system:dirsync-source:edit`、`system:dirsync-source:delete`、`system:dirsync-source:test`、`system:dirsync-source:preview`、`system:dirsync-source:run` |
| 通讯录同步记录 | `/system/directory-sync/logs` | `system/directory-sync/DirectorySyncLogsPage` | `system:dirsync-log:list`、`system:dirsync-log:detail`、`system:dirsync-log:retry` |
| 通讯录冲突处理 | `/system/directory-sync/conflicts` | `system/directory-sync/DirectorySyncConflictsPage` | `system:dirsync-conflict:list`、`system:dirsync-conflict:resolve`、`system:dirsync-conflict:ignore` |
| 在线用户 | `/system/sessions` | `system/sessions/OnlineSessionsPage` | `system:session:list`、`system:session:forceLogout` |

`GET /api/menus/user` 返回当前用户可见菜单。后台菜单管理的写操作在多租户模式下还经过 `platformAdminOnly`，即只有平台管理员可维护全局菜单。

## 数据权限

`DataScope` 取值为：

| 值 | 含义 |
| --- | --- |
| `all` | 全部数据 |
| `custom` | 指定部门 |
| `dept_only` | 仅当前部门 |
| `dept` | 当前部门及子部门 |
| `self` | 仅本人 |

`packages\server\src\lib\data-scope.ts` 计算有效数据范围：

- 角色数据权限、用户直接数据权限、用户组继承角色数据权限合并，按最宽松原则生效。
- 平台超管或任一有效范围为 `all` 时不追加过滤条件。
- `dept` 会递归包含当前部门及子部门；用户无部门时降级为 `self`。
- `custom` 合并 `role_dept_scopes` 与 `user_dept_scopes`；无指定部门时降级为 `self`。
- `self` 依赖调用方传入 `ownerColumn`，用户列表用 `users.id` 作为本人字段。

用户管理列表、详情、批量状态、删除、重置密码、授权等入口都会校验目标用户处于当前操作者的租户与数据权限范围内，避免越权 IDOR。删除、禁用、重置密码对内置 `admin` 账号有保护；删除/禁用用户会尽力吊销其在线会话。

## 认证与账号安全

### 登录链路

`/api/auth/login` 支持用户名或手机号登录，可携带 `tenantCode`、验证码、设备指纹与“记住设备”参数。登录成功后签发：

- Access Token：JWT，默认有效期 2 小时，包含 `userId`、`username`、`roles`、`tenantId`、`jti`。
- Refresh Token：JWT，默认有效期 30 天，`type = refresh`，用于刷新 access token 和账号切换。
- 在线会话：由 `session-manager` 记录 tokenId、用户、租户、IP、归属地、浏览器、OS、登录与活跃时间。

`/api/auth/refresh` 一次性消费 Redis 中的 refresh 授权，重新校验用户状态、租户状态与租户到期时间后**轮换**签发新 `jti` 的 access token 与 refresh token（旧 `jti` 立即吊销，在线会话迁移到新 `jti`）。登出、强制下线、修改 / 重置密码都会撤销 refresh 授权，未过期的 refresh token 随之失效；客户端须用响应中的新 refresh token 覆盖本地保存。

### 多账号切换

前端账号切换器实现位于 `packages\web\src\lib\account-store.ts` 与 `AuthProvider.tsx`：

- 活跃账号凭证仍存放在 `TOKEN_KEY` / `REFRESH_TOKEN_KEY`。
- 停靠账号只保存资料快照与 refresh token，不保存 access token。
- 最多同时保留 `MAX_STORED_ACCOUNTS` 个账号，活跃账号占 1 个席位；停靠区按最近使用淘汰。
- 登录页支持 `?add_account=1` 添加账号模式：保留当前登录，成功后停靠原账号并切到新账号。
- 切换账号时通过 `/api/auth/refresh` 换发 access token 与新的 refresh token（旧 refresh token 随即失效），随后清理账号级本地状态并整页重载；跨标签页通过 `ACCOUNT_SWITCH_BROADCAST_KEY` 广播刷新。
- 退出当前账号会优先切到最近使用的停靠账号；注销停靠账号或退出全部账号会调用免登录接口 `POST /api/auth/logout-by-refresh` 注销对应 refresh token 会话。

### 安全策略

身份安全策略是运行时设置模块 `identitySecurity`（**租户作用域**：租户可覆盖平台值，未覆盖时继承；读写 `GET/PUT /api/settings/identity-security`，权限 `system:identity-security:manage`，管理页 `/system/identity-security`；机制见[运行时设置](../backend/settings.md)）：

| 字段 | 语义 |
| --- | --- |
| `password.minLength` | 密码最小长度，默认 6 |
| `password.requireUppercase` | 是否要求大写字母 |
| `password.requireSpecialChar` | 是否要求特殊字符 |
| `password.expiryEnabled` / `password.expiryDays` | 密码过期强制修改 |
| `lockout.maxAttempts` / `lockout.durationMinutes` | 登录失败锁定阈值与锁定时长，按用户所属租户解析 |
| `mfa.enabled` / `mfa.mode` | MFA 总开关与模式：`off`、`optional`、`required` |
| `mfa.rememberDeviceDays` | 可信设备免 MFA 天数 |
| `risk.enabled` / `risk.newDeviceAction` | 新设备风险策略；动作支持 `allow`、`challenge` |

密码规则（`password`）是匿名可见字段：登录 / 注册 / 改密页通过 `GET /api/settings/public` 与 `/api/settings/me` 读取并做前端提示。

MFA 当前落库类型包括 `totp`、`passkey`、`recovery_code`，接口实现覆盖 TOTP 绑定、确认、停用与登录验证。新设备触发挑战时写入 `login_risk_events`，风险等级为 `low`、`medium`、`high`，动作是 `allow`、`challenge`、`block`。

### 个人安全与审计接口

| 能力 | API |
| --- | --- |
| 个人资料/密码 | `GET /api/auth/me`、`PUT /api/auth/profile`、`PUT /api/auth/password`、`POST /api/auth/verify-password` |
| 登录与操作记录 | `GET /api/auth/my-login-logs`、`GET /api/auth/my-operation-logs` |
| 在线会话 | `GET /api/auth/my-sessions`、`DELETE /api/auth/my-sessions/others`、`DELETE /api/auth/my-sessions/{tokenId}` |
| 偏好与收藏菜单 | `GET/PUT /api/auth/preferences`、`GET/PUT /api/auth/favorite-menus` |
| MFA 与可信设备 | `GET /api/auth/mfa/factors`、`POST /api/auth/mfa/totp/setup`、`POST /api/auth/mfa/totp/verify`、`DELETE /api/auth/mfa/factors/{id}`、`GET /api/auth/trusted-devices`、`DELETE /api/auth/trusted-devices/{id}` |
| 个人 API Token | `GET /api/api-tokens`、`POST /api/api-tokens`、`DELETE /api/api-tokens/{id}`；完整 token 仅创建时返回，库中存 `token_hash` 与 `token_prefix` |

## 企业身份源与 OAuth

### OAuth 账号绑定

支持的第三方 OAuth provider 来自 `OAUTH_PROVIDERS`：`github`、`dingtalk`、`wechat_work`、`feishu`。

| 表 | 说明 |
| --- | --- |
| `oauth_configs` | provider、clientId、clientSecret、agentId、corpId、enabled、autoLinkByEmail |
| `user_oauth_accounts` | 用户与第三方账号绑定，唯一键为 `provider + openId` |

管理配置接口：`GET /api/oauth-config`、`PUT /api/oauth-config/{provider}`（多租户模式下仅平台管理员；它是平台级全局配置，登录时没有租户上下文）。个人 OAuth 接口：`GET /api/auth/oauth/providers`（公开，已启用的 provider 列表）、`GET /api/auth/oauth/accounts`、`GET /api/auth/oauth/{provider}`（登录授权链接）、`GET /api/auth/oauth/{provider}/bind`（绑定授权链接，需登录）、`POST /api/auth/oauth/{provider}/callback`、`POST /api/auth/oauth/bind`、`DELETE /api/auth/oauth/unbind/{provider}`。

安全边界：

- **`state` 双侧校验**：授权链接里的 `state` 由服务端签发并存入 Redis（10 分钟、单次消费，记录 provider / 意图 / 发起用户），前端在跳转前暂存于 sessionStorage；回调时 URL 里的 `state` 必须与暂存值一致，再由服务端消费比对。攻击者拿到合法 state 也无法让受害者浏览器完成登录（登录 CSRF），登录意图的 state 不能用于绑定，绑定意图的 state 只能由发起者本人完成。
- **绑定不替换会话**：个人中心「绑定」走独立的 bind 意图，回调经 `POST /api/auth/oauth/bind` 关联到当前登录用户，不会登录成第三方身份对应的其他账号。
- **不做隐式关联**：未绑定的第三方身份默认返回 `needBind`，需先用密码登录再在个人中心绑定。只有 provider 配置显式开启 `autoLinkByEmail`，且 provider 断言邮箱已验证（GitHub 取 `/user/emails` 的 `verified`，企业提供方以通讯录为准）、邮箱全库唯一命中、账号启用、且不持有平台超管角色，才会在登录时自动关联。
- **复用 MFA 决策**：第三方登录与密码登录、企业 SSO 共用 `completeLoginWithMfa`（MFA 策略 / 新设备风控 / 密码过期 / 登录日志），命中时返回 `mfaRequired` 挑战。

### 企业身份源

企业身份源类型为 `oidc`、`saml`、`ldap`、`ad`，配置保存在 `tenant_identity_providers`，外部身份与本地用户绑定在 `user_identity_accounts`。核心字段包括 OIDC discovery/授权/token/userinfo/JWKS 端点、SAML SSO URL/Entity ID/证书、LDAP URL/Base DN/Bind DN/搜索过滤器/同步过滤器、属性映射、JIT 开关、按邮箱自动关联开关（`autoLinkByEmail`）与默认角色。

安全边界（服务端强制，前端仅做展示裁剪）：

- **归属由调用者决定**：`tenantId` 只有平台管理员可以指定（`null` 为平台级）；租户管理员创建 / 更新的身份源与同步源一律落到自身租户，显式传入其他归属返回 403。列表、详情、更新、删除、测试连接、目录搜索与同步全部按调用者租户作用域过滤，越界返回 404。
- **默认角色不变式**：保存时校验默认角色归属目标租户且调用者可见；任何自动建号路径（SSO JIT、身份源同步、SCIM、通讯录同步）**永不授予平台保留角色**（`super_admin`），建号时再过滤一次已删除 / 禁用 / 越界 / 保留的角色。平台超管只能由平台管理员手动分配。
- **不做隐式账号关联**：外部身份首次出现时不再按用户名匹配本地账号。只有身份源显式开启 `autoLinkByEmail`，且邮箱在身份源租户内唯一命中、账号启用、OIDC 断言 `email_verified`，才会在登录时关联既有账号；持有平台超管角色的账号在任何自动路径（登录关联、管理员同步、SCIM、通讯录同步）中都不会被关联或接管。未命中且未开启 JIT 时返回 403，需管理员先同步或绑定。
- **同步覆盖邮箱受控**：管理员触发的目录同步允许按邮箱关联既有账号，但只有开启 `autoLinkByEmail` 的身份源才会用目录邮箱覆盖本地邮箱（邮箱是找回密码的凭证通道）。
- **SSO 复用 MFA 决策**：LDAP / OIDC / SAML 登录在签发 token 前执行与密码登录相同的 `shouldRequireMfa`，命中时返回 `mfaRequired` 挑战（SAML 通过一次性票据带回前端），由 `POST /api/auth/mfa/verify` 完成。

管理端接口：

- `GET /api/identity-providers`、`GET /api/identity-providers/{id}`
- `POST /api/identity-providers`、`PUT /api/identity-providers/{id}`、`DELETE /api/identity-providers/{id}`
- `POST /api/identity-providers/{id}/test`
- `GET /api/identity-providers/{id}/ldap/users`
- `POST /api/identity-providers/{id}/sync`

登录端接口：

- `GET /api/auth/enterprise/providers`
- `GET /api/auth/enterprise/{id}`
- `POST /api/auth/enterprise/callback`
- `POST /api/auth/enterprise/ldap/login`
- `POST /api/auth/enterprise/saml/acs`
- `POST /api/auth/enterprise/saml/exchange`

## 通讯录同步

通讯录同步支持 `ldap`、`dingtalk`、`wechat_work`、`feishu`、`scim` 五类源：

- 拉取型：`ldap`、`dingtalk`、`wechat_work`、`feishu`，支持手动、定时、预览差异与连接测试。
- 回调型：`dingtalk`、`wechat_work`、`feishu`，公开回调路径为 `/api/directory-sync/callbacks/{key}`，通过源配置中的 token/AES key 校验。
- 推送型：`scim`，路径为 `/api/directory-sync/scim/{key}/v2/...`，实现 `ServiceProviderConfig` 与 `Users` 的查询、创建、更新、Patch、删除。

同步源表 `directory_sync_sources` 记录匹配键、字段映射、范围配置、冲突策略、生命周期策略、是否同步部门、Cron、熔断阈值、回调随机路径段与最近同步状态。同步运行写 `directory_sync_runs` 与 `directory_sync_run_items`，冲突进入 `directory_sync_conflicts`，外部用户/部门与本地对象的绑定分别写 `directory_sync_user_links`、`directory_sync_dept_links`。

冲突策略：`source`（源覆盖本地）、`local`（保留本地）、`suspend`（挂起人工裁决）。运行状态：`running`、`success`、`partial`、`failed`、`aborted`。运行明细动作：`create`、`update`、`link`、`disable`、`skip`、`conflict`、`fail`。

## 组织对象

| 对象 | 表 | 能力 |
| --- | --- | --- |
| 部门 | `departments` | 树形结构，含负责人、电话、邮箱、排序、状态、租户；编码在租户内唯一 |
| 岗位 | `positions` | 分页/全量查询、CRUD、批量删除、成员读取与全量覆盖；编码在租户内唯一 |
| 用户组 | `user_groups` | 静态成员或动态规则成员；绑定角色后成员继承权限；支持规则预览与手动同步动态成员 |
| 租户 | `tenants` | 租户资料、状态、过期时间、最大用户数、套餐绑定、统计 |
| 租户套餐 | `tenant_packages`、`tenant_package_features` | 功能集合与配额；租户绑定套餐后影响菜单/权限解析 |

## 用户管理

用户管理接口统一在 `/api/users`：

| 方法 | 路径 | 说明 | 权限 |
| --- | --- | --- | --- |
| GET | `/api/users` | 分页列表，支持关键字、手机号、部门、状态、时间范围；按租户与数据权限过滤并做脱敏 | `system:user:list` |
| GET | `/api/users/all` | 下拉全量用户；与列表同口径过滤 | `system:user:list` |
| GET | `/api/users/alert-recipients` | 告警接收人下拉，返回是否有邮箱而不回传邮箱原文 | `alert:rule:create` 或 `alert:rule:update` |
| POST | `/api/users` | 创建用户，校验密码策略、部门、角色、岗位与租户席位 | `system:user:create` |
| PUT | `/api/users/{id}` | 更新用户基本资料、部门、角色、岗位 | `system:user:update` |
| DELETE | `/api/users/{id}`、`DELETE /api/users/batch` | 删除用户并吊销会话 | `system:user:delete` |
| PUT | `/api/users/{id}/password`、`PUT /api/users/batch-password` | 重置用户密码，校验密码策略 | `system:user:update` |
| PUT | `/api/users/batch-status` | 批量启用/禁用；禁用会吊销会话 | `system:user:update` |
| POST | `/api/users/{id}/unlock` | 清除登录锁定 | `system:user:update` |
| GET/POST | `/api/users/import-template`、`/api/users/import` | 下载 Excel 模板、导入用户 | `system:user:import` |
| GET/PUT | `/api/users/{id}/roles` | 分配用户角色 | `system:user:assign` |
| GET/PUT | `/api/users/{id}/menus` | 分配用户直接菜单权限 | `system:user:assign` |
| GET/PUT | `/api/users/{id}/data-permission` | 分配用户级数据权限与部门范围 | `system:user:assign` |
| GET | `/api/users/{id}/effective-permissions` | 查看用户最终有效权限 | `system:user:assign` |

用户导出接入统一导出中心，导出权限为 `system:user:export`，导出敏感明文字段需额外具备 `system:user:export-raw`。

## API 一览

| 根路径 | 主要能力 |
| --- | --- |
| `/api/auth` | 验证码、登录、注册、刷新、登出、按 refresh token 登出、个人资料、密码、MFA、可信设备、个人日志、个人会话、租户视角、偏好、收藏菜单 |
| `/api/users` | 用户列表、详情、创建、更新、删除、批量删除、批量状态、密码重置、解锁、导入、导入模板、授权、数据权限、有效权限 |
| `/api/roles` | 角色全量/分页/详情、创建、更新、删除、分配菜单、读取/设置角色用户 |
| `/api/menus` | 当前用户菜单、管理菜单树、平铺菜单、详情、创建、更新、删除 |
| `/api/departments` | 部门树、平铺列表、详情、创建、更新、删除 |
| `/api/positions` | 岗位全量/分页/详情、创建、更新、批量删除、成员读取与设置 |
| `/api/user-groups` | 用户组全量/分页/详情、创建、更新、批量删除、成员维护、角色绑定、动态规则预览与同步 |
| `/api/tenants` | 租户分页/全量/详情、创建、更新、删除、统计 |
| `/api/tenant-packages` | 套餐分页/全量/详情、创建、更新、分配功能、删除 |
| `/api/identity-security` | 身份安全策略、登录风险事件 |
| `/api/identity-providers` | 企业身份源 CRUD、LDAP/AD 测试、目录用户搜索、目录用户同步 |
| `/api/directory-sync` | 同步源、同步运行、运行明细、冲突裁决、回调、SCIM 端点 |
| `/api/sessions` | 在线会话列表、强制指定会话下线、强制指定用户全部会话下线；可见范围与用户管理对齐——平台超管平台视角看全部、租户视角只看该租户，租户管理员只看本租户，非平台超管看不到也不能踢掉平台超管会话（越界按 404 处理） |
| `/api/auth/oauth` | OAuth 授权、回调、绑定、解绑、账号列表 |
| `/api/auth/enterprise` | 企业身份源发现、授权 URL、OIDC 回调、LDAP/AD 登录、SAML ACS 与票据兑换 |
| `/api/oauth-config` | OAuth provider 配置读取与保存 |
| `/api/api-tokens` | 个人 API Token 列表、创建、删除 |

## 维护要求

- 权限码、菜单、按钮与页面入口以 `packages\shared\src\seed\menus` 为唯一种子来源。
- 权限/数据权限行为以 `permissions.ts`、`data-scope.ts`、`user-group-access.ts` 为准。
- 企业身份源与通讯录同步的字段、枚举、API 以 `packages\shared\src\identity` 与对应路由为准。
- 文档只描述当前状态，不记录版本演进。
