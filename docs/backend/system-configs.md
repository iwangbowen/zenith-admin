# 系统内置配置

系统配置模块（`system_configs` 表）用于在运行时动态调整系统行为，无需修改代码或环境变量。管理员可通过后台管理界面随时读写配置项。

---

## 内置配置项参考

以下是系统预置的 5 个配置项（由 `db:seed` 初始化）：

### `captcha_enabled`

| 属性 | 值 |
|------|----|
| 类型 | `boolean` |
| 默认值 | `false` |
| 说明 | 是否开启登录验证码。设为 `true` 后，登录页会显示图形验证码输入框，后端会校验验证码正确性。 |

---

### `site_name`

| 属性 | 值 |
|------|----|
| 类型 | `string` |
| 默认值 | `Zenith Admin` |
| 说明 | 站点名称，显示在浏览器标签页标题中。前端通过 `GET /api/system-configs/public` 读取并更新页面 `<title>`。 |

---

### `user_default_password`

| 属性 | 值 |
|------|----|
| 类型 | `string` |
| 默认值 | `123456` |
| 说明 | 新增用户时系统自动设置的初始密码。后端在创建用户时读取此配置，经 bcrypt 加密后存入数据库。建议在生产环境修改为高强度密码。 |

---

### `login_max_attempts`

| 属性 | 值 |
|------|----|
| 类型 | `number` |
| 默认值 | `10` |
| 说明 | 登录失败允许的最大次数。连续失败达到此阈值后，账号将被自动锁定（锁定时长由 `login_lock_duration_minutes` 控制）。失败计数使用 Redis 持久化，服务重启后不重置。 |

---

### `login_lock_duration_minutes`

| 属性 | 值 |
|------|----|
| 类型 | `number` |
| 默认值 | `30` |
| 说明 | 账号锁定的持续时长，单位：分钟。锁定期间用户无法登录，到期后自动解除。管理员也可通过「用户管理 → 解除锁定」手动提前解锁。 |

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

// 使用示例
const maxAttempts = Number(await getConfigValue('login_max_attempts')) || 10;
```

> **注意**：配置项从数据库读取，是字符串类型，使用时需根据 `configType` 做类型转换（`Number()`、`=== 'true'` 等）。

---

## 如何新增自定义配置

1. 通过后台「系统配置」页面点击「新增」按钮
2. 填写 `configKey`（约定使用 snake_case）、`configValue`、`configType`、`description`
3. 在后端代码中通过 `getConfigValue('your_key')` 读取

如果该配置是种子数据（随每次部署初始化），同步在 `packages/shared/src/seed-data.ts` 的 `SEED_SYSTEM_CONFIGS` 数组中添加一条记录：

```typescript
// packages/shared/src/seed-data.ts
export const SEED_SYSTEM_CONFIGS = [
  // ... 现有配置
  {
    id: 6,
    configKey: 'your_key',
    configValue: 'default_value',
    configType: 'string',
    description: '配置项说明',
  },
];
```
