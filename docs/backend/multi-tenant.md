# 多租户指南

多租户开关由环境变量 `MULTI_TENANT_MODE` 解析为 `config.multiTenantMode`，不是系统配置项。租户、套餐、权限过滤和数据隔离主要位于 `packages/server/src/lib/tenant.ts`、`packages/server/src/lib/context.ts`、`packages/server/src/lib/permissions.ts` 与 identity 服务。

## 租户模型

| 表 | 说明 |
| --- | --- |
| `tenants` | 租户主表：名称、编码、状态、到期时间、用户上限、套餐、联系人 |
| `tenant_packages` | 套餐主表：名称、状态、配额 JSON、备注 |
| `tenant_package_features` | 套餐功能集合：`package_id` + `feature_key` |
| `menus.feature_key` | 菜单归属功能。`null` 表示核心能力，不受套餐关闭 |

租户管理接口位于 `/api/tenants`，租户套餐接口位于 `/api/tenant-packages`。两组接口均只允许平台管理员访问。

## 平台管理员与租户视角

平台超管判定：`roles` 包含 `super_admin` 且 `tenantId === null`。

JWT 可携带 `viewingTenantId`。平台超管未指定租户视角时可以查看全局数据；指定 `viewingTenantId` 时按该租户执行租户过滤与创建归属。

## 数据隔离工具

常用工具函数：

| 函数 | 用途 |
| --- | --- |
| `isPlatformAdmin(user)` | 判定平台超管 |
| `getEffectiveTenantId(user)` | 返回生效租户：优先 `viewingTenantId`，否则 `tenantId` |
| `tenantCondition(table, user)` | 为带 `tenantId` 的表生成查询条件；平台超管全局视角返回 `undefined` |
| `getCreateTenantId(user)` | 写入数据时计算 `tenantId` |
| `tenantScope(table)` | 基于 `currentUser()` 的零参上下文生成查询条件 |
| `currentCreateTenantId()` | 基于 `currentUser()` 的零参上下文计算创建租户 |

Service、导出定义和后台任务应优先复用这些工具，避免手写 `tenant_id` 过滤。

## 创建和查询语义

- 非平台租户用户只能访问自身 `tenantId` 数据。
- 平台超管全局视角读取不附加租户条件。
- 平台超管切换到某租户视角后，读取和创建都使用 `viewingTenantId`。
- 多租户模式下新建带租户字段的数据，会通过 `getCreateTenantId(user)` 写入归属；租户作用域的运行时设置（身份安全、支付风控）同样按此解析写入租户，未覆盖时继承平台值，见[运行时设置](./settings.md)。

## 套餐与菜单

套餐保存的是 feature key 集合，不保存菜单 ID 白名单。权限加载流程会读取 `menus.feature_key`：

- `featureKey === null` 的菜单属于核心能力，始终可见；
- 有 `featureKey` 的菜单只有在租户套餐包含该功能时可见；
- 套餐禁用时功能集为空，按 fail-closed 处理；
- 用户、角色分配菜单时会校验菜单功能是否在租户套餐范围内。

## 用户席位与 License

租户创建、用户启用等场景会调用 `reserveTenantSeats(tx, tenantId, adding)`。该函数在事务中使用 advisory lock，并同时检查：

- 部署 License 的 `maxUsers`；
- 租户自身 `maxUsers`；
- 租户套餐配额 `quotas.maxUsers`。

实际可用席位取上述限制中的最小有效值。

## 开发要求

1. 新增带租户归属的表时使用 `tenantId` 字段并引用 `tenants.id`。
2. 列表、详情、更新、删除必须通过租户条件过滤。
3. 创建数据时使用 `getCreateTenantId()` 或 `currentCreateTenantId()`。
4. 平台管理接口使用 `platformAdminOnly()`。
5. 套餐控制菜单可见性时使用 feature key，不引入菜单 ID 白名单模型。
