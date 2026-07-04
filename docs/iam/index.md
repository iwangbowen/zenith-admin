# 权限与组织

权限与组织（IAM）覆盖后台管理员用户、角色、菜单权限、部门、岗位与用户组。系统以菜单权限码为核心做 RBAC 鉴权，以部门树和数据权限范围做数据访问约束，并与在线会话、账号锁定、审计日志、多租户隔离等后端能力联动。

---

## 能力总览

| 模块 | 核心表 | 权限码 | 当前能力 |
|------|--------|--------|----------|
| 用户管理 | `users`、`user_roles`、`user_positions`、`user_menus`、`user_dept_scopes` | `system:user:list`、`system:user:create`、`system:user:update`、`system:user:delete`、`system:user:import`、`system:user:assign` | 用户 CRUD、角色/岗位/部门分配、用户级菜单权限、用户级数据权限、批量删除、批量启停、批量重置密码、Excel 导入、Excel/CSV 导出、账号解锁、在线状态标记 |
| 角色管理 | `roles`、`role_menus`、`role_dept_scopes`、`user_roles` | `system:role:list`、`system:role:create`、`system:role:update`、`system:role:delete`、`system:role:assign` | 角色 CRUD、菜单权限分配、关联用户分配、数据权限范围与指定部门范围 |
| 菜单管理 | `menus`、`role_menus`、`user_menus` | `system:menu:list`、`system:menu:create`、`system:menu:update`、`system:menu:delete` | 目录 / 菜单 / 按钮三级模型、树形维护、权限码、可见性、排序、外链与查询参数 |
| 部门管理 | `departments`、`users` | `system:department:list`、`system:department:create`、`system:department:update`、`system:department:delete` | 部门树、负责人、部门类别、联系方式、成员数量与成员预览、Excel/CSV 导出 |
| 岗位管理 | `positions`、`user_positions` | `system:position:list`、`system:position:create`、`system:position:update`、`system:position:delete` | 岗位 CRUD、批量删除、成员查看、成员全量设置、Excel/CSV 导出 |
| 用户组 | `user_groups`、`user_group_members` | `system:user-groups:list`、`system:user-groups:create`、`system:user-groups:update`、`system:user-groups:delete`、`system:user-groups:assign` | 用户组 CRUD、负责人、所属部门、成员数量与预览、成员全量设置、批量添加、批量移除、批量删除 |

> 管理后台用户与前台会员是两套独立账号体系。本文仅描述后台管理员 IAM；会员体系见[功能模块](../product/features.md#会员中心)。

---

## RBAC 权限模型

### 模型组成

| 层级 | 表 / 字段 | 说明 |
|------|-----------|------|
| 用户 | `users.id`、`users.username`、`users.status` | 后台管理员账号，状态枚举为 `enabled` / `disabled` |
| 角色 | `roles.code`、`roles.status`、`roles.data_scope` | 角色编码参与 JWT `roles` 与超管判断；`data_scope` 控制数据权限 |
| 用户-角色 | `user_roles.user_id`、`user_roles.role_id` | 用户与角色多对多 |
| 菜单 | `menus.type`、`menus.permission`、`menus.visible` | `type` 枚举为 `directory` / `menu` / `button`；按钮通常只承载权限码 |
| 角色-菜单 | `role_menus.role_id`、`role_menus.menu_id` | 角色继承的菜单与按钮权限 |
| 用户-菜单 | `user_menus.user_id`、`user_menus.menu_id` | 用户直接授权的菜单与按钮权限 |

### 权限校验

所有受保护接口通过 `authMiddleware` 注入管理员 JWT Payload，再由 `guard({ permission })` 做权限判断：

```ts
guard({ permission: 'system:user:update' })
```

校验规则：

1. JWT `roles` 包含 `super_admin` 时直接放行。
2. 非超管通过 `getUserPermissions(userId)` 查询用户有效权限。
3. 有效权限由角色菜单 `role_menus` 与用户直接菜单 `user_menus` 合并而成。
4. 仅采集 `menus.permission` 非空字符串作为权限码。
5. 权限缓存按用户维度保存 5 分钟；角色菜单、用户角色、用户菜单变更时清理缓存。

> `guard({ permission })` 的权限码以路由文件实参为准。菜单种子中的按钮权限用于前端按钮展示控制，后端仍以路由守卫为最终准入点。

### 菜单权限与动态菜单

菜单实体字段包括 `parentId`、`title`、`name`、`path`、`component`、`icon`、`type`、`permission`、`query`、`isExternal`、`sort`、`status`、`visible`。

| 接口 | 行为 |
|------|------|
| `GET /api/menus/user` | 当前登录用户菜单树。超管返回全部菜单；普通用户根据角色菜单与用户直接菜单计算，并补齐父级菜单 |
| `GET /api/menus` | 管理用菜单树，需登录 |
| `GET /api/menus/flat` | 平铺菜单列表，需 `system:menu:list` |

种子菜单中，IAM 页面位于「系统管理」下：

| 页面 | 前端路由 | 组件 | 菜单权限码 |
|------|----------|------|------------|
| 用户管理 | `/system/users` | `users/UsersPage` | `system:user:list` |
| 部门管理 | `/system/departments` | `system/departments/DepartmentsPage` | `system:department:list` |
| 岗位管理 | `/system/positions` | `system/positions/PositionsPage` | `system:position:list` |
| 用户组 | `/system/user-groups` | `system/user-groups/UserGroupsPage` | `system:user-groups:list` |
| 菜单管理 | `/system/menus` | `system/menus/MenusPage` | `system:menu:list` |
| 角色管理 | `/system/roles` | `system/roles/RolesPage` | `system:role:list` |

内置角色：

| 角色 | `code` | `dataScope` | 菜单范围 |
|------|--------|-------------|----------|
| 超级管理员 | `super_admin` | `all` | `SEED_MENUS` 全部菜单 |
| 普通用户 | `user` | `all` | `menuIds: [1, 202, 203, 310]` |

---

## 数据权限范围（dataScope）

数据权限枚举定义在数据库枚举 `data_scope` 与共享类型 `DataScope` 中：

| 值 | 前端文案 | 过滤含义 |
|----|----------|----------|
| `all` | 全部数据权限 | 不追加数据权限过滤条件 |
| `custom` | 指定部门数据权限 | 按指定部门 ID 过滤；角色使用 `role_dept_scopes`，用户直接设置使用 `user_dept_scopes` |
| `dept_only` | 本部门数据权限 | 仅匹配当前用户所在部门 |
| `dept` | 本部门及以下数据权限 | 匹配当前用户部门及全部子部门 |
| `self` | 仅本人数据权限 | 匹配数据归属人字段为当前用户 ID |

### 角色级数据权限

角色表 `roles.data_scope` 默认值为 `all`。角色创建与更新支持：

- `dataScope`: `all` / `custom` / `dept_only` / `dept` / `self`
- `deptScopeIds`: 指定部门 ID 列表，仅 `custom` 需要配置

角色详情接口返回 `menuIds` 与 `deptScopeIds`，用于角色编辑、菜单权限面板和数据权限面板。

### 用户级数据权限

用户表 `users.user_data_scope` 可为空。为空时表示不单独设置，前端文案为「跟随角色（不单独设置）」。

| 字段 | 来源 | 说明 |
|------|------|------|
| `userDataScope` | `users.user_data_scope` | 用户直接数据权限，`null` 表示未设置 |
| `deptScopeIds` | `user_dept_scopes.dept_id` | 用户直接指定部门 |
| `roleDataScope` | 用户角色中的 `roles.data_scope` | 角色侧最宽松数据权限 |
| `roleDeptScopeIds` | `role_dept_scopes.dept_id` | 角色侧指定部门 |

`GET /api/users/{id}/effective-permissions` 返回最终预览：

- `directMenuIds`：用户直接菜单 ID
- `roleMenuIds`：角色继承菜单 ID
- `effectiveMenuIds`：直接菜单与角色菜单并集
- `userDataScope`、`roleDataScope`、`effectiveDataScope`
- `userDeptScopeIds`、`roleDeptScopeIds`、`effectiveDeptScopeIds`

### 过滤规则

`getDataScopeCondition()` 接收业务表的 `deptColumn` 与 `ownerColumn`：

```ts
await getDataScopeCondition({
  currentUserId,
  deptColumn: users.departmentId,
  ownerColumn: users.id,
});
```

- `super_admin` 或命中 `all`：返回 `undefined`，调用方不追加 `WHERE` 条件。
- `dept`：按当前用户部门及子部门过滤；用户无部门时降级为本人。
- `custom`：合并角色指定部门与用户直接指定部门；未配置指定部门时降级为本人。
- `dept_only`：仅当前用户部门；用户无部门时降级为本人。
- `self`：按 `ownerColumn = currentUserId` 过滤。
- 未传 `deptColumn` 时，部门类范围无法生效并降级到本人逻辑。

> 用户列表 `GET /api/users` 已接入数据权限过滤，使用 `users.departmentId` 作为部门列、`users.id` 作为本人列。

---

## 组织架构

### 部门树

部门表 `departments` 通过 `parent_id` 形成树结构，`parent_id = 0` 表示根节点。主要字段：

| 字段 | 说明 |
|------|------|
| `name`、`code` | 部门名称与编码；`code` 在租户维度唯一 |
| `category` | 部门类别，支持 `group` / `company` / `department` |
| `leader_id` | 部门负责人，引用 `users.id` |
| `phone`、`email` | 联系方式 |
| `sort`、`status` | 排序与状态 |
| `tenant_id` | 多租户隔离字段 |

部门服务保证：

- 上级部门必须存在。
- 上级部门不能选择自身或自身子部门。
- 删除部门前检查是否存在子部门或关联用户。
- 部门树返回 `userCount` 与最多 5 个 `userPreview`。

### 岗位

岗位表 `positions` 保存岗位基础信息，用户通过 `user_positions` 与岗位多对多关联。

| 字段 | 说明 |
|------|------|
| `name`、`code` | 岗位名称与编码；`code` 在租户维度唯一 |
| `sort`、`status` | 排序与状态 |
| `remark` | 备注 |
| `tenant_id` | 多租户隔离字段 |

岗位删除前会检查 `user_positions` 是否存在关联用户；存在关联用户时返回业务错误。岗位列表返回 `userCount` 与最多 5 个 `userPreview`，成员管理接口支持全量覆盖岗位成员。

### 用户组

用户组表 `user_groups` 用于将用户按业务协作关系分组，成员通过 `user_group_members` 维护。

| 字段 | 说明 |
|------|------|
| `name`、`code` | 用户组名称与编码；`code` 在租户维度唯一 |
| `description` | 描述 |
| `owner_id` | 负责人，引用 `users.id` |
| `department_id` | 所属部门，引用 `departments.id` |
| `status` | `enabled` / `disabled` |
| `tenant_id` | 多租户隔离字段 |

用户组支持成员查看、全量设置、批量添加、批量移除。删除用户组时，`user_group_members` 通过外键级联清理。

---

## 用户管理能力

### 用户字段

用户 DTO 与表字段覆盖以下核心信息：

| 字段 | 说明 |
|------|------|
| `username`、`nickname`、`email`、`phone`、`gender`、`avatar` | 基础资料 |
| `departmentId`、`departmentName` | 所属部门 |
| `positionIds`、`positions` | 岗位分配 |
| `roles` | 角色分配 |
| `status` | `enabled` / `disabled` |
| `passwordUpdatedAt` | 密码更新时间 |
| `lastLoginAt` | 最后登录时间 |
| `isLocked` | 登录失败锁定状态 |
| `isOnline` | 在线会话状态 |

用户列表支持 `keyword`、`phone`、`departmentId`、`status`、`startTime`、`endTime` 查询条件。其中 `keyword` 匹配 `username`、`nickname`、`email`，时间参数使用 `YYYY-MM-DD HH:mm:ss` 格式。

### 创建与更新

创建用户字段：

```json
{
  "username": "zhangsan",
  "nickname": "张三",
  "email": "zhangsan@example.com",
  "password": "StrongPassword1",
  "phone": "13800138000",
  "gender": "male",
  "departmentId": 1,
  "positionIds": [1],
  "roleIds": [2],
  "status": "enabled"
}
```

服务层会校验：

- 密码复杂度策略。
- 部门、角色、岗位 ID 是否存在且在可访问租户范围内。
- 同一租户下 `username` 与 `email` 不重复。
- `admin` 用户不允许删除、禁用或参与批量重置密码。

### 批量与导入

| 能力 | 接口 | 说明 |
|------|------|------|
| 批量删除 | `DELETE /api/users/batch` | 请求体 `ids` |
| 批量启停 | `PUT /api/users/batch-status` | 请求体 `ids`、`status` |
| 批量重置密码 | `PUT /api/users/batch-password` | 请求体 `ids`、`password` |
| 下载导入模板 | `GET /api/users/import-template` | 返回 `user_import_template.xlsx` |
| 导入用户 | `POST /api/users/import` | `multipart/form-data` 上传 `file` |

导入模板列：

| 列 | 说明 |
|----|------|
| `用户名*`、`昵称*`、`邮箱*`、`密码*` | 必填 |
| `部门编码` | 匹配 `departments.code` |
| `岗位编码(逗号分隔)` | 匹配 `positions.code` |
| `角色编码(逗号分隔)` | 匹配 `roles.code` |
| `状态(enabled/disabled)` | 留空默认 `enabled` |

导入结果返回 `total`、`success`、`failed`、`errors`，其中 `errors` 包含 `row` 与 `message`。

### 账号解锁与在线状态

- `POST /api/users/{id}/unlock` 根据用户 ID 找到 `username`，清理登录锁定状态。
- 用户列表通过在线会话数据计算 `isOnline`。
- 前端用户列表在用户在线且具备 `system:session:forceLogout` 时，可调用 `DELETE /api/sessions/user/{id}` 强制该用户所有会话下线。
- 在线会话独立接口还支持 `GET /api/sessions`、`DELETE /api/sessions/{tokenId}`。

---

## 接口一览

> 以下路径均已包含 `/api` 前缀；所有接口均要求 Bearer Token。权限列为「仅登录」表示该路由未配置具体权限码。

### 用户

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| `GET` | `/api/users/all` | 全量用户，下拉框使用 | `system:user:list` |
| `GET` | `/api/users` | 用户分页列表 | `system:user:list` |
| `POST` | `/api/users` | 创建用户 | `system:user:create` |
| `DELETE` | `/api/users/batch` | 批量删除用户 | `system:user:delete` |
| `PUT` | `/api/users/batch-password` | 批量重置用户密码 | `system:user:update` |
| `PUT` | `/api/users/batch-status` | 批量修改用户状态 | `system:user:update` |
| `GET` | `/api/users/import-template` | 下载导入模板 | `system:user:import` |
| `POST` | `/api/users/import` | 导入用户 | `system:user:import` |
| `PUT` | `/api/users/{id}/password` | 修改指定用户密码 | `system:user:update` |
| `POST` | `/api/users/{id}/unlock` | 解锁账号 | `system:user:update` |
| `GET` | `/api/users/{id}` | 用户详情 | `system:user:list` |
| `PUT` | `/api/users/{id}` | 更新用户 | `system:user:update` |
| `DELETE` | `/api/users/{id}` | 删除用户 | `system:user:delete` |
| `PUT` | `/api/users/{id}/roles` | 分配用户角色 | `system:user:assign` |
| `GET` | `/api/users/{id}/menus` | 获取用户菜单权限 | `system:user:assign` |
| `PUT` | `/api/users/{id}/menus` | 分配用户直接菜单权限 | `system:user:assign` |
| `GET` | `/api/users/{id}/data-permission` | 获取用户数据权限 | `system:user:assign` |
| `PUT` | `/api/users/{id}/data-permission` | 设置用户数据权限 | `system:user:assign` |
| `GET` | `/api/users/{id}/effective-permissions` | 获取最终有效权限 | `system:user:assign` |

### 角色

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| `GET` | `/api/roles/all` | 全量角色，下拉框使用 | `system:role:list` |
| `GET` | `/api/roles` | 角色分页列表 | `system:role:list` |
| `GET` | `/api/roles/{id}` | 角色详情，含 `menuIds`、`deptScopeIds` | `system:role:list` |
| `POST` | `/api/roles` | 创建角色 | `system:role:create` |
| `PUT` | `/api/roles/{id}` | 更新角色 | `system:role:update` |
| `DELETE` | `/api/roles/{id}` | 删除角色 | `system:role:delete` |
| `PUT` | `/api/roles/{id}/menus` | 分配角色菜单 | `system:role:assign` |
| `GET` | `/api/roles/{id}/users` | 获取角色关联用户 | `system:role:list` |
| `PUT` | `/api/roles/{id}/users` | 分配角色用户 | `system:role:assign` |

### 菜单

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| `GET` | `/api/menus/user` | 当前用户可见菜单树 | 仅登录 |
| `GET` | `/api/menus` | 管理用全量菜单树 | 仅登录 |
| `GET` | `/api/menus/flat` | 平铺菜单列表 | `system:menu:list` |
| `GET` | `/api/menus/{id}` | 菜单详情 | `system:menu:list` |
| `POST` | `/api/menus` | 创建菜单 | `system:menu:create` |
| `PUT` | `/api/menus/{id}` | 更新菜单 | `system:menu:update` |
| `DELETE` | `/api/menus/{id}` | 删除菜单及子菜单 | `system:menu:delete` |

### 部门

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| `GET` | `/api/departments` | 部门树 | `system:department:list` |
| `GET` | `/api/departments/flat` | 部门扁平列表 | `system:department:list` |
| `GET` | `/api/departments/{id}` | 部门详情 | `system:department:list` |
| `POST` | `/api/departments` | 创建部门 | `system:department:create` |
| `PUT` | `/api/departments/{id}` | 更新部门 | `system:department:update` |
| `DELETE` | `/api/departments/{id}` | 删除部门 | `system:department:delete` |

### 岗位

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| `GET` | `/api/positions/all` | 全量岗位，下拉框使用 | `system:position:list` |
| `GET` | `/api/positions` | 岗位分页列表 | `system:position:list` |
| `GET` | `/api/positions/{id}` | 岗位详情 | `system:position:list` |
| `POST` | `/api/positions` | 创建岗位 | `system:position:create` |
| `PUT` | `/api/positions/{id}` | 更新岗位 | `system:position:update` |
| `DELETE` | `/api/positions/batch` | 批量删除岗位 | `system:position:delete` |
| `DELETE` | `/api/positions/{id}` | 删除岗位 | `system:position:delete` |
| `GET` | `/api/positions/{id}/members` | 获取岗位成员 | `system:position:list` |
| `PUT` | `/api/positions/{id}/members` | 设置岗位成员 | `system:position:update` |

### 用户组

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| `GET` | `/api/user-groups/all` | 全量用户组，下拉框使用 | `system:user-groups:list` |
| `GET` | `/api/user-groups` | 用户组分页列表 | `system:user-groups:list` |
| `GET` | `/api/user-groups/{id}` | 用户组详情 | `system:user-groups:list` |
| `POST` | `/api/user-groups` | 创建用户组 | `system:user-groups:create` |
| `PUT` | `/api/user-groups/{id}` | 更新用户组 | `system:user-groups:update` |
| `DELETE` | `/api/user-groups/batch` | 批量删除用户组 | `system:user-groups:delete` |
| `DELETE` | `/api/user-groups/{id}` | 删除用户组 | `system:user-groups:delete` |
| `GET` | `/api/user-groups/{id}/members` | 获取用户组成员 | `system:user-groups:list` |
| `PUT` | `/api/user-groups/{id}/members` | 设置用户组成员 | `system:user-groups:assign` |
| `POST` | `/api/user-groups/{id}/members` | 添加用户组成员 | `system:user-groups:assign` |
| `DELETE` | `/api/user-groups/{id}/members` | 移除用户组成员 | `system:user-groups:assign` |

### 在线会话联动

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| `GET` | `/api/sessions` | 在线会话列表 | `system:session:list` |
| `DELETE` | `/api/sessions/{tokenId}` | 强制指定会话下线 | `system:session:forceLogout` |
| `DELETE` | `/api/sessions/user/{id}` | 强制指定用户所有会话下线 | `system:session:forceLogout` |

---

## 前端页面

| 页面 | 路由 | 主要交互 |
|------|------|----------|
| 用户管理 | `/system/users` | 部门主从布局、用户列表、创建/编辑、头像、角色/岗位/部门分配、批量删除、批量启停、批量重置密码、导入导出、解锁、强制下线入口 |
| 用户菜单权限弹窗 | 用户管理弹窗 | 读取 `/api/menus` 与 `/api/users/{id}/effective-permissions`，展示角色继承、用户直接授权与最终菜单权限 |
| 用户数据权限弹窗 | 用户管理弹窗 | 读取和保存 `/api/users/{id}/data-permission`，支持用户级 `dataScope` 与指定部门 |
| 角色管理 | `/system/roles` | 角色列表、创建/编辑、状态切换、菜单权限分配、数据权限设置、关联用户分配、导出 |
| 菜单管理 | `/system/menus` | 菜单树维护、目录/菜单/按钮类型、状态切换、可见性、权限码 |
| 部门管理 | `/system/departments` | 部门树、负责人、部门成员预览、创建/编辑/删除、状态切换、导出 |
| 岗位管理 | `/system/positions` | 岗位列表、成员管理、批量删除、状态切换、导出 |
| 用户组管理 | `/system/user-groups` | 用户组列表、负责人/部门、成员管理、批量删除、状态切换 |

前端按钮展示通过 `usePermission()` 读取当前用户权限码控制，例如 `system:user:create` 控制用户创建按钮，`system:role:assign` 控制角色菜单权限与关联用户操作。后端路由守卫仍是最终权限校验来源。

---

## 相关文档

- [安全体系](../backend/security.md)：账号锁定、密码策略、验证码、CSRF、限流等安全能力。
- [请求上下文与当前用户工具](../backend/request-context.md)：`currentUser()`、JWT Payload 与管理员/会员上下文隔离。
- [多租户指南](../backend/multi-tenant.md)：`tenant_id` 隔离与租户视角。
- [API 约定](../backend/api-conventions.md)：统一响应结构、分页、OpenAPI 与校验规范。
- [操作日志变更记录](../backend/audit-log-changes.md)：配置了 `audit` 的 IAM 变更接口会写入操作日志。
- [功能模块](../product/features.md)：产品能力全景。
