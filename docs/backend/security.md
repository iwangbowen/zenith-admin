# 安全体系

Zenith Admin 内置了多层安全防护能力，涵盖 IP 访问控制、账号锁定、密码策略、验证码及注册开关，均可通过系统配置页面在运行时动态调整。

---

## IP 访问控制

通过 `ipAccessMiddleware` 对所有 `/api/*` 请求进行 IP 过滤，支持**白名单**与**黑名单**两种模式（可同时启用，黑名单优先执行）。

### 配置项

在后台「系统设置 → IP 访问控制」页面配置（对应 `system_configs` 表中的以下 key）：

| 配置 Key | 类型 | 说明 |
|----------|------|------|
| `ip_whitelist_enabled` | `boolean` | 是否启用白名单。启用后只有名单内的 IP 可访问 |
| `ip_whitelist` | `string` (JSON 数组) | 白名单 IP 列表，如 `["192.168.1.0/24", "10.0.0.1"]` |
| `ip_blacklist_enabled` | `boolean` | 是否启用黑名单。启用后名单内 IP 访问将收到 403 |
| `ip_blacklist` | `string` (JSON 数组) | 黑名单 IP 列表，支持单 IP 与 CIDR 网段 |

### 工作机制

```
请求进入 /api/*
  │
  ├── 免检路径（直接放行）：
  │   /api/auth/login、/api/auth/captcha、/api/auth/register
  │   /api/auth/refresh、/api/oauth/*
  │
  ├── 两者均未启用 → 直接放行
  │
  ├── 黑名单已启用 → 命中则 403
  │
  └── 白名单已启用 → 未命中则 403
```

- IP 来源优先从 `X-Forwarded-For` 请求头中读取（取第一个值），其次读取 `X-Real-IP`
- 支持 CIDR 网段匹配（如 `192.168.1.0/24`），基于 `ip-range-check` 库实现
- 配置缓存 **30 秒**，修改后台配置后最多延迟 30 秒生效

> **Nginx 反代注意**：确保 Nginx 已正确设置 `X-Real-IP` 或 `X-Forwarded-For`，否则后端收到的将是内网 IP。

---

## 账号锁定

连续登录失败超过阈值后，账号会被自动锁定一段时间，有效防止暴力破解。

### 相关配置项

| 配置 Key | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `login_max_attempts` | `number` | `10` | 最大失败次数，超过后自动锁定 |
| `login_lock_duration_minutes` | `number` | `30` | 锁定持续时长（分钟） |

### 工作机制

- 失败计数以 `loginAttempts:{username}` 为 key 存储于 **Redis**，服务重启后不重置
- 锁定到期后自动解除
- 管理员可在「用户管理」列表中点击「解除锁定」按钮，提前解除指定账号的锁定状态（调用 `POST /api/users/:id/unlock`）

---

## 密码策略

从 v0.1.4 起，支持通过系统配置控制密码复杂度要求与过期策略。

### 复杂度配置项

| 配置 Key | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `password_min_length` | `number` | `6` | 密码最小长度 |
| `password_require_uppercase` | `boolean` | `false` | 是否必须包含大写字母 |
| `password_require_special` | `boolean` | `false` | 是否必须包含特殊字符（`!@#$%^&*` 等）|

密码复杂度在以下场景触发校验：
- 用户创建（管理员操作）
- 用户修改个人密码
- 重置密码

### 密码过期

| 配置 Key | 类型 | 默认值 | 说明 |
|----------|------|--------|------|
| `password_expiry_days` | `number` | `0` | 密码有效期天数，`0` 表示永不过期 |

**过期流程**：

1. 用户登录时，后端计算 `passwordUpdatedAt + expiry_days` 是否小于当前时间
2. 若已过期，登录接口不返回 token，而是返回特殊 code（`password_expired`）和临时 token
3. 前端检测到特殊 code 后，弹出「强制修改密码」弹窗
4. 用户通过临时 token 完成密码修改后，方可正常使用系统

---

## 登录验证码

| 配置 Key | 类型 | 默认值 |
|----------|------|--------|
| `captcha_enabled` | `boolean` | `false` |

启用后，登录页自动显示图形验证码输入框。验证码通过 `GET /api/auth/captcha` 获取（返回 Base64 图片 + captchaId），登录时需同时提交 `captchaId` 和用户输入的验证码文本，后端校验后自动失效。

---

## 注册开关

| 配置 Key | 类型 | 默认值 |
|----------|------|--------|
| `allow_registration` | `boolean` | `false` |

- `false`：登录页不显示「注册」入口，`POST /api/auth/register` 返回 403
- `true`：开放注册，登录页显示「注册账号」链接

> **生产建议**：如非公开注册场景，建议保持 `allow_registration = false`。

---

## 安全相关接口速查

| 接口 | 说明 |
|------|------|
| `GET /api/auth/captcha` | 获取验证码（返回 Base64 图片 + captchaId）|
| `POST /api/auth/register` | 开放注册（受 `allow_registration` 控制）|
| `POST /api/users/:id/unlock` | 管理员解除账号锁定 |
| `PUT /api/auth/password` | 当前用户修改密码 |
| `PUT /api/auth/password/reset-expired` | 通过临时 token 重置过期密码 |
| `POST /api/users/:id/reset-password` | 管理员重置指定用户密码 |
