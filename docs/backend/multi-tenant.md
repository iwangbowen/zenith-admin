# 多租户指南

Zenith Admin 内置了可选的多租户（Multi-Tenant）能力，默认关闭。开启后，各业务表按 `tenant_id` 自动隔离数据，适用于 SaaS 场景。

---

## 核心概念

| 概念 | 说明 |
| --- | --- |
| **租户（Tenant）** | 独立的业务单元，拥有各自的用户、数据与配置 |
| **平台超管** | `super_admin` 角色且 `tenantId = null` 的用户，可管理所有租户 |
| **租户管理员** | 属于某个租户的普通管理员，只能看到本租户数据 |
| **多租户模式** | 通过环境变量开关控制，关闭时与单实例模式完全兼容 |

---

## 快速启用

### 第一步：后端 `.env`

```env
MULTI_TENANT_MODE=true
```

### 第二步：前端 `.env`

```env
VITE_MULTI_TENANT_MODE=true
```

两端都需要设置，开关**必须保持一致**。设置完成后重启服务即可生效。

> 关闭时（默认），系统与以前完全兼容，所有数据均无 `tenant_id` 过滤。

---

## 租户表结构

```sql
CREATE TABLE tenants (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  code        VARCHAR(50)  NOT NULL UNIQUE,   -- 租户唯一编码，登录时作为路由凭证
  logo        VARCHAR(500),
  contact_name  VARCHAR(50),
  contact_phone VARCHAR(20),
  status      status_enum  NOT NULL DEFAULT 'active',
  expire_at   TIMESTAMPTZ,                    -- 到期时间（NULL = 永不到期）
  max_users   INTEGER,                        -- 最大用户数限制（NULL = 不限）
  remark      TEXT,
  created_at  TIMESTAMP    NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP    NOT NULL DEFAULT NOW()
);
```

租户编码（`code`）是登录时定向进入指定租户的凭证，建议使用简短英文标识，如 `acme`、`demo`。

---

## 数据隔离机制

多租户模式下，以下业务表均增加了 `tenant_id` 字段（外键关联 `tenants.id`，`ON DELETE CASCADE`）：

- `departments`（部门）
- `positions`（岗位）
- `users`（用户）
- 其他后续新增的业务表（参见「为新模块添加租户隔离」章节）

删除租户时，所有关联的业务数据将**级联删除**。

### 过滤工具函数

`packages/server/src/lib/tenant.ts` 提供三个公共函数：

```ts
// 判断当前用户是否为平台超管
isPlatformAdmin(user: JwtPayload): boolean

// 获取当前有效的租户 ID（超管切换视角后返回切换的目标 tenantId）
getEffectiveTenantId(user: JwtPayload): number | null

// 构建查询时的 WHERE 过滤条件
tenantCondition(table, user): SQL | undefined
```

在路由中使用示例：

```ts
import { tenantCondition } from '../lib/tenant';

tenantsRoute.get('/', async (c) => {
  const user = c.get('user');
  const cond = tenantCondition(someBusinessTable, user);
  const rows = await db.select()
    .from(someBusinessTable)
    .where(cond ? and(cond, ...otherConditions) : and(...otherConditions));
  // ...
});
```

---

## 登录流程（多租户模式）

登录接口 `POST /api/auth/login` 新增可选字段 `tenantCode`：

```json
{
  "username": "alice",
  "password": "password123",
  "tenantCode": "acme"
}
```

后端逻辑：

1. 解析 `tenantCode`，查询 `tenants` 表获取租户 ID
2. 检查租户状态（`disabled` → 返回 403）
3. 检查租户有效期（`expire_at` 已过 → 返回 403）
4. 验证用户名密码，要求用户的 `tenant_id` 与租户 ID 一致
5. 将 `tenantId` 签入 JWT，后续所有请求自动携带

> 不传 `tenantCode` 时，系统不进行租户过滤，平台超管可直接以平台身份登录。

### 前端登录页

当 `VITE_MULTI_TENANT_MODE=true` 时，登录表单自动显示「租户编码」输入框。

---

## 平台超管视角切换

平台超管（`super_admin` 且本人无 `tenantId`）可在管理后台顶栏的下拉框切换至任意租户的视角：

- 切换会重新签发包含 `viewingTenantId` 的 Token
- 切换后各业务列表、用户管理等页面均以目标租户视角过滤
- 可随时切回「平台视角」（`viewingTenantId = null`），查看全量数据

切换接口：`POST /api/auth/switch-tenant`，Body：`{ "tenantId": 1 }` 或 `{ "tenantId": null }`（切回平台）。

---

## 租户管理页面（CRUD）

菜单路径：**系统管理 → 租户管理**（菜单权限：`system:tenant:list`）

| 字段 | 说明 |
| --- | --- |
| 租户名称 | 租户显示名，如「ACME 公司」 |
| 租户编码 | 唯一标识（全局唯一），登录时使用 |
| 状态 | `active` / `disabled` |
| 到期时间 | 为空则永不过期 |
| 最大用户数 | 为空则不限 |
| 联系人 / 联系电话 | 选填 |

**仅平台超管可访问此页面**，普通租户管理员无权操作。

权限点：

| 权限码 | 说明 |
| --- | --- |
| `system:tenant:list` | 查看列表 |
| `system:tenant:create` | 新增租户 |
| `system:tenant:update` | 编辑租户 |
| `system:tenant:delete` | 删除租户 |

---

## 为新业务模块添加租户隔离

在实现新的 CRUD 模块（可参考 [Zenith Skill](../ai/skills)）时，若该模块需要租户隔离，按以下步骤操作：

### 1. Schema 中添加 `tenant_id` 字段

```ts
// packages/server/src/db/schema.ts
export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  // ... 其他字段
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
```

### 2. 列表查询中追加过滤条件

```ts
import { tenantCondition } from '../lib/tenant';

ordersRoute.get('/', async (c) => {
  const user = c.get('user');
  const conditions: SQL[] = [];

  // 多租户过滤
  const tCond = tenantCondition(orders, user);
  if (tCond) conditions.push(tCond);

  // 其他业务过滤条件
  if (keyword) conditions.push(like(orders.name, `%${keyword}%`));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rows = await db.select().from(orders).where(where);
  // ...
});
```

### 3. 创建时写入 `tenantId`

```ts
import { getCreateTenantId } from '../lib/tenant';

ordersRoute.post('/', async (c) => {
  const user = c.get('user');
  // ...
  await db.insert(orders).values({
    ...validatedData,
    tenantId: getCreateTenantId(user),  // 自动从当前用户（或超管视角）获取
  });
});
```

### 注意事项

- `tenantCondition` 在多租户模式关闭时返回 `undefined`，不添加任何过滤，与旧逻辑完全兼容
- 平台超管在「平台视角」（`viewingTenantId = null`）时，`tenantCondition` 同样返回 `undefined`，可查看全量数据
- 超管切换至某租户视角后，`tenantCondition` 返回 `eq(table.tenantId, viewingTenantId)`
- **配置类数据**（角色、菜单、字典等）通常无需租户隔离，保持全局共享
- **业务数据**（用户、部门、订单等）需要隔离，在 Step 0 信息收集时明确确认

---

## 架构图

```text
请求进入
  │
  ▼
authMiddleware（解析 JWT，写入 user payload）
  │   user.tenantId          ← 用户本身所属租户
  │   user.viewingTenantId   ← 超管切换视角后的目标租户（可选）
  │
  ▼
业务路由
  │
  ├─ tenantCondition(table, user)
  │      多租户关闭  → undefined（不过滤）
  │      超管平台视角 → undefined（看所有）
  │      超管租户视角 → eq(tenantId, viewingTenantId)
  │      普通用户    → eq(tenantId, user.tenantId)
  │
  ▼
数据库查询
```

---

## 常见问题

**Q：已有项目如何从单实例迁移到多租户？**

1. 运行 `npm run db:migrate`（迁移已包含 `tenants` 表及各业务表的 `tenant_id` 字段）
2. 创建平台超管账号（`tenantId = null`，角色含 `super_admin`）
3. 在租户管理页创建租户，为现有用户分配 `tenant_id`
4. 设置 `MULTI_TENANT_MODE=true` 并重启

**Q：如何控制单个租户的用户上限？**

在租户记录的「最大用户数」（`maxUsers`）字段填入数值。目前该字段为信息字段，如需强制约束，在用户创建路由中加入检测逻辑（查询当前租户下的用户数量，超出则拒绝）。

**Q：租户之间的数据是否完全物理隔离？**

当前使用行级隔离（`tenant_id` 过滤）而非独立数据库。数据存储在同一 PostgreSQL 实例中，通过查询条件隔离。若需物理隔离，需自行扩展为多数据库方案。

**Q：关闭多租户模式后，`tenant_id` 字段的数据怎么处理？**

关闭多租户模式后，`tenantCondition` 返回 `undefined`，查询不再过滤 `tenant_id`，所有数据对所有用户可见。字段本身不会被删除，不影响数据结构。
