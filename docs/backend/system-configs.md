# 系统内置配置

系统配置模块（`system_configs` 表）用于在运行时动态调整系统行为，无需修改代码或环境变量。管理员可通过后台管理界面随时读写配置项。

---

## 内置配置项参考

以下是系统预置的 16 个配置项（由 `db:seed` 初始化，源文件：`packages/shared/src/seed-data.ts`）。

---

### 站点基础

#### `site_name`

| 属性 | 值 |
|------|----|
| 类型 | `string` |
| 默认值 | `Zenith Admin` |
| 说明 | 站点名称，显示在浏览器标签页标题中。前端通过 `GET /api/system-configs/public` 读取并更新页面 `<title>`。 |

---

### 登录与账号安全

#### `captcha_enabled`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `false` |
| 说明 | 是否开启登录验证码。设为 `true` 后，登录页会显示图形验证码输入框，后端会校验验证码正确性。 |

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
| 说明 | 新增用户时系统自动设置的初始密码。后端在创建用户时读取此配置，经 bcrypt 加密后存入数据库。**建议在生产环境修改为高强度密码。** |

#### `password_min_length`

| 属性 | 值 |
|------|----|
| 类型 | `number` |
| 默认值 | `6` |
| 说明 | 密码的最小长度限制。修改密码或重置密码时，前后端均会校验此规则。 |

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
| 说明 | 是否开启密码过期强制重置。开启后，当用户密码超过 `password_expiry_days` 天未修改，登录时会被强制跳转至修改密码页。 |

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

## 如何在代码中读取配置

后端路由中通过以下方式读取配置项：

```typescript
import { db } from '../db/index';
import { systemConfigs } from '../db/schema';
import { eq } from 'drizzle-orm';

async function getConfigValue(key: string): Promise<string | null> {
  const [config] = await db
    .select()
    .from(systemConfigs)
    .where(eq(systemConfigs.configKey, key))
    .limit(1);
  return config?.configValue ?? null;
}

// boolean 配置
const watermarkEnabled = (await getConfigValue('watermark_enabled')) === 'true';
// number 配置
const maxAttempts = Number(await getConfigValue('login_max_attempts')) || 10;
// string 配置
const siteName = (await getConfigValue('site_name')) ?? 'Zenith Admin';
```

> **注意**：配置项从数据库读取，统一为字符串类型，使用时需根据 `configType` 做类型转换（`Number()`、`=== 'true'` 等）。

---

## 如何新增内置配置

1. 在 `packages/shared/src/seed-data.ts` 的 `SEED_SYSTEM_CONFIGS` 数组中追加记录：

```typescript
{ id: 17, configKey: 'your_key', configValue: 'default', configType: 'string', description: '配置项说明', createdAt: SEED_DATE, updatedAt: SEED_DATE },
```

2. 在后端需要读取该配置的路由/中间件中调用 `getConfigValue('your_key')`。

3. 重新执行 `npm run db:seed`（种子写入已做幂等处理，仅插入缺失 key，不会覆盖已有值）。

> **注意**：`id` 字段需全局唯一，沿用已有最大值 +1 递增。
