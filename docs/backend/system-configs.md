# 系统内置配置

系统配置模块（`system_configs` 表）用于在运行时动态调整系统行为，无需修改代码或环境变量。管理员可通过后台管理界面随时读写配置项。

---

## 内置配置项参考

以下是系统预置的 24 个配置项（由 `db:seed` 初始化，源文件：`packages/shared/src/seed-data.ts`）。

---

### 站点基础

#### `site_name`

| 属性 | 值 |
|------|----|
| 类型 | `string` |
| 默认值 | `Zenith Admin` |
| 说明 | 站点名称，显示在浏览器标签页标题中。可通过 `GET /api/system-configs/public/site_name` 公开读取。 |

---

### 登录与账号安全

#### `captcha_enabled`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `false` |
| 说明 | 是否开启登录验证码。设为 `true` 后，登录页会显示图形验证码输入框，后端会校验验证码正确性。 |

#### `captcha_complexity`

| 属性 | 值 |
|------|----|
| 类型 | `string` |
| 默认值 | `medium` |
| 说明 | 验证码复杂度，控制干扰强度与识别难度，仅在 `captcha_enabled` 开启后生效。可选值：`low`（干扰线少、运算简单，易于人眼识别）、`medium`（默认，均衡）、`high`（干扰线多、运算范围大，防机器识别能力更强）。填写其他值时按 `medium` 处理。 |

#### `login_max_attempts`

| 属性 | 值 |
|------|----|
| 类型 | `number` |
| 默认值 | `10` |
| 说明 | 登录失败允许的最大次数。连续失败达到此阈值后，账号将被自动锁定（锁定时长由 `login_lock_duration_minutes` 控制）。失败计数使用 Redis 持久化，服务重启后不重置。 |

#### `login_lock_duration_minutes`

| 属性 | 值 |
|------|----|
| 类型 | `number` |
| 默认值 | `30` |
| 说明 | 账号锁定的持续时长，单位：分钟。锁定期间用户无法登录，到期后自动解除。管理员也可通过「用户管理 → 解除锁定」手动提前解锁。 |

#### `allow_registration`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `false` |
| 说明 | 是否允许新用户在登录页自助注册账号。关闭时注册入口隐藏，只有管理员可在后台创建用户。 |

#### `forgot_password_enabled`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `false` |
| 说明 | 是否开启忘记密码功能。开启后登录页显示「忘记密码」链接，用户可通过邮件接收重置链接。依赖邮件配置（`系统设置 → 邮件配置`）正常可用。 |

---

### 密码策略

#### `user_default_password`

| 属性 | 值 |
|------|----|
| 类型 | `string` |
| 默认值 | `123456` |
| 说明 | 系统预置的默认密码配置项，可在后台配置页面维护。用户管理创建接口的密码以请求参数为准。**建议在生产环境维护为高强度密码。** |

#### `password_min_length`

| 属性 | 值 |
|------|----|
| 类型 | `number` |
| 默认值 | `6` |
| 说明 | 密码的最小长度限制。后端用户管理的创建用户、管理员修改指定用户密码、批量重置密码、导入用户等场景会校验此规则；前端会读取策略并展示输入提示。 |

#### `password_require_uppercase`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `false` |
| 说明 | 密码是否必须包含至少一个大写字母（A–Z）。 |

#### `password_require_special_char`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `false` |
| 说明 | 密码是否必须包含至少一个特殊字符（如 `!@#$%^&*`）。 |

#### `password_expiry_enabled`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `false` |
| 说明 | 是否开启密码过期强制重置。开启后，当用户密码超过 `password_expiry_days` 天未修改，登录响应会携带 `requirePasswordChange: true`，前端据此弹出强制修改密码弹窗。 |

#### `password_expiry_days`

| 属性 | 值 |
|------|----|
| 类型 | `number` |
| 默认值 | `90` |
| 说明 | 密码有效期（天）。仅在 `password_expiry_enabled` 为 `true` 时生效。 |

---

### 页面水印

#### `watermark_enabled`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `false` |
| 说明 | 是否开启页面水印。开启后，所有后台页面（AdminLayout 内）均会显示水印层，用于防截图泄漏。水印层通过 `pointer-events: none` 实现，不影响正常交互。 |

#### `watermark_content`

| 属性 | 值 |
|------|----|
| 类型 | `string` |
| 默认值 | `（空）` |
| 说明 | 水印显示的文本内容。**留空时自动回退为当前登录用户的昵称（nickname）或账号（username）**，推荐留空以实现可追溯的个性化水印。 |

#### `watermark_font_size`

| 属性 | 值 |
|------|----|
| 类型 | `number` |
| 默认值 | `14` |
| 说明 | 水印文字的字体大小，单位 px。 |

#### `watermark_opacity`

| 属性 | 值 |
|------|----|
| 类型 | `number` |
| 默认值 | `15` |
| 说明 | 水印透明度，取值范围 1–100，实际 CSS opacity = 值 ÷ 100。默认 `15` 对应 `opacity: 0.15`，视觉上若隐若现不影响内容阅读。 |

---

### 功能开关

#### `quick_chat_enabled`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `false` |
| 说明 | 是否显示快捷聊天悬浮按钮（全局开关）。关闭后，用户偏好设置中的相关选项也同步隐藏，所有用户均看不到该入口。 |

#### `ai_allow_user_custom_key`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `false` |
| 说明 | 是否允许用户配置自己的 AI API Key。`false`（默认）时所有用户仅能使用系统管理员在 AI 服务商配置中设置的模型，聊天页面不显示"我的 AI 配置"入口；设为 `true` 后，用户可在聊天页面点击设置按钮添加自己的 API Key 和模型，优先级高于系统配置。 |

---

### 文件上传安全

#### `file_upload_validate_type`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `true` |
| 说明 | 上传文件时是否基于 magic bytes 校验真实文件类型，防止伪造 MIME type 绕过校验。 |

#### `file_upload_allowed_types`

| 属性 | 值 |
|------|----|
| 类型 | `string` |
| 默认值 | `image/*,video/*,audio/*,application/pdf,text/plain,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/msword,application/vnd.ms-powerpoint` |
| 说明 | 允许上传的文件 MIME 类型，逗号分隔，支持通配符（如 `image/*`）；设为 `*/*` 或 `*` 则允许所有类型。 |

---

### Web 终端录屏

#### `terminal_recording_enabled`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `false` |
| 说明 | 是否启用 Web 终端录屏。关闭后终端操作不再自动录制。 |

#### `terminal_recording_retain_days`

| 属性 | 值 |
|------|----|
| 类型 | `number` |
| 默认值 | `30` |
| 说明 | 终端录屏保留天数，超过此天数的录屏将在每日清理任务中删除；`0` 表示不按天数清理。 |

#### `terminal_recording_max_size_mb`

| 属性 | 值 |
|------|----|
| 类型 | `number` |
| 默认值 | `500` |
| 说明 | 终端录屏总容量上限，单位 MB。超出上限后按时间从旧到新删除；`0` 表示不限制容量。 |

---

## 如何在代码中读取配置

后端路由/服务层中通过项目封装的专用 helper 读取配置项，无需手写 Drizzle 查询：

```typescript
import { getConfigValue, getConfigBoolean, getConfigNumber } from '../lib/system-config';

// string 配置
const siteName = await getConfigValue('site_name', 'Zenith Admin');
// boolean 配置
const watermarkEnabled = await getConfigBoolean('watermark_enabled', false);
// number 配置
const maxAttempts = await getConfigNumber('login_max_attempts', 10);
```

三个 helper 均位于 `packages/server/src/lib/system-config.ts`，签名：

| Helper | 返回类型 | 说明 |
|--------|----------|------|
| `getConfigValue(key, defaultValue, tenantId?)` | `Promise<string>` | 原始字符串值，不存在时返回 `defaultValue` |
| `getConfigBoolean(key, defaultValue, tenantId?)` | `Promise<boolean>` | 自动将 `'true'` 转为 `true` |
| `getConfigNumber(key, defaultValue, tenantId?)` | `Promise<number>` | 自动 `Number()` 转换，转换失败时返回 `defaultValue` |

> **注意**：所有 helper 均支持可选的 `tenantId` 参数，用于多租户场景。单租户场景省略即可。

---

## 如何新增内置配置

1. 在 `packages/shared/src/seed-data.ts` 的 `SEED_SYSTEM_CONFIGS` 数组中追加记录：

```typescript
{ id: 24, configKey: 'your_key', configValue: 'default', configType: 'string', description: '配置项说明', createdAt: SEED_DATE, updatedAt: SEED_DATE },
```

2. 在后端需要读取该配置的路由/中间件中调用 `getConfigValue('your_key')`。

3. 重新执行 `npm run db:seed`（种子写入已做幂等处理，仅插入缺失 key，不会覆盖已有值）。

> **注意**：`id` 字段需全局唯一，沿用已有最大值 +1 递增。
