---
name: zenith
description: "Zenith Admin 项目专属开发辅助。Use when: 开发新模块、实现 CRUD 功能、新增页面、配置菜单权限、实现增删改查、新建后台功能模块、新增管理功能、发布新版本。包含 CRUD 完整代码生成流程与版本发布流程。"
argument-hint: "要开发的功能描述，例如：部门管理 CRUD、公告管理页面；或发布操作：发布 v0.2.0"
---

# Zenith Admin 开发辅助 Skill

## 已支持的工作流

| 场景 | 触发方式 | 参考文档 |
|------|---------|----------|
| CRUD 模块（增删改查） | 「实现 XXX 的 CRUD」「新增 XXX 模块」「开发 XXX 功能」 | [CRUD 流程](#crud-模块开发流程) |
| 发布新版本 | 「发布 vX.Y.Z」「准备发布」「release X.Y.Z」 | [references/release.md](references/release.md) |

---

## CRUD 模块开发流程

### Step 0：信息收集与澄清

**在生成任何代码之前，必须先向用户收集以下信息。对于未提供或不明确的项，通过问题向用户确认，不要擅自假设。**

#### 必须明确的信息

| 信息项 | 说明 | 若未提供，则提问 |
|--------|------|-----------------|
| **模块中文名** | 如「部门管理」 | 「请问这个模块的中文名称是什么？」 |
| **实体英文名**（单数首字母大写 + 小写） | 如 Department / department | 「实体的英文名是？（如 Department）」 |
| **API 路径前缀** | 如 `/api/departments` | 根据实体名推导，确认：「API 路径是 `/api/xxx` 吗？」 |
| **数据库表名** | 如 `departments` | 根据英文名复数推导，确认：「表名是 `xxx` 吗？」 |
| **权限前缀** | 如 `system:department` | 根据模块名推导，确认：「权限码前缀是 `system:xxx` 吗？」 |
| **主要字段列表** | 字段名、类型、是否必填、是否唯一 | 「请描述该模块需要哪些字段？（如：名称 string 必填、描述 string 可选）」 |
| **父菜单 ID** | 该菜单挂在哪个父菜单下 | 「该页面挂在哪个一级菜单下？（如系统管理 = id:2）」 |

#### 需要用户选择的可选项

以下选项**不要默认开启**，主动询问用户：

1. **是否需要 MSW Mock 数据？**（Demo 演示模式使用，若用户不提，询问：「是否需要同步添加 MSW Mock 数据以支持 Demo 演示模式？」）
2. **是否有状态字段？**（如 `status: active/disabled`，若有请确认使用现有 `statusEnum` 还是新建枚举）
3. **是否有关联实体？**（如外键关联部门、角色等，若有需了解关联方式：多对一 FK 还是多对多联表）
4. **是否需要数据导出（Excel）？**（若需要，后端需加 `/export` 端点）
5. **是否需要时间范围筛选？**（列表页搜索栏是否加时间范围）
6. **是否需要数据权限过滤？**（见下方「数据权限规范」）
7. **是否需要表格批量操作？**（见下方「批量操作规范」）
8. **是否需要租户隔离？**（多租户模式下的业务数据需添加 `tenant_id`，见下方「多租户感知规范」）

收集完所有信息后，向用户展示汇总确认，再开始实现。

---

### 数据权限规范（dataScope）

#### 何时需要过滤

| 模块类型 | 是否需要 | 说明 |
|----------|----------|------|
| **业务数据**（用户、员工、订单、申请单等） | ✅ 需要 | 按角色 dataScope 过滤可见范围 |
| **配置数据**（角色、菜单、字典、系统参数等） | ❌ 不需要 | 全局共享，不受数据权限约束 |
| **日志数据**（操作日志、登录日志） | 视需求而定 | 管理员可看全部，普通用户看自己 |

> **原则**：在 Step 0 信息收集时，若新模块属于"业务数据"，必须明确询问用户：「该模块是否需要按数据权限（部门/本人）过滤可见范围？」

#### 前提条件：业务实体表必须包含 `department_id` 字段

要支持 `dept`（本部门）过滤，业务实体的数据库表中必须有 `department_id` 外键字段：

```ts
// packages/server/src/db/schema.ts
export const xxxTable = pgTable('xxx', {
  // ...其他字段
  departmentId: integer('department_id').references(() => departments.id),
  // ...
});
```

> **设计原则**：`department_id` 在**创建记录时**从创建人的部门写入，之后不随人员部门变动而改变。这样即使创建人后来调岗，历史数据仍归属于原部门。因此过滤逻辑是 `WHERE data.department_id IN (我的部门及子部门)`，而非通过 `created_by` 反查创建人的当前部门。

**创建接口中需自动填入部门**（示例）：

```ts
// POST / 创建接口
const [creator] = await db.select({ departmentId: users.departmentId })
  .from(users).where(eq(users.id, currentUserId)).limit(1);

await db.insert(xxxTable).values({
  ...validatedData,
  departmentId: creator?.departmentId ?? null,  // 自动从创建人获取部门
});
```

#### 后端实现方式（使用公共工具函数）

**统一使用** `getDataScopeCondition`（位于 `packages/server/src/lib/data-scope.ts`），**不要在各路由中重复内联查询逻辑**。

```ts
import { getDataScopeCondition } from '../lib/data-scope';

// OpenAPIHono 实例使用 AuthEnv 运行时类型，才能正确推断 c.get('user') 的返回类型
const xxxRouter = new OpenAPIHono<AuthEnv>();

// 在 GET / 列表接口中追加 conditions：
const currentUserId = c.get('user').userId;
const scopeCondition = await getDataScopeCondition({
  currentUserId,
  deptColumn: xxxTable.departmentId,  // 目标表的 department_id 列
  ownerColumn: xxxTable.id,           // 用于 self 过滤的主键列
});
if (scopeCondition) conditions.push(scopeCondition);
```

工具函数内部逻辑（供理解，无需手动实现）：
1. 查询当前用户所有角色的 `dataScope` 和 `code`
2. 若是 `super_admin` 或含 `all` 角色 → 不过滤，返回 `undefined`
3. 若含 `dept` 角色 → `WHERE department_id = 当前用户departmentId`（无部门时降级为 self）
4. 否则（`self`）→ `WHERE ownerColumn = currentUserId`

> **注意**：`dept` 模式目前是精确匹配同一 `department_id`，未实现递归子部门查询。

#### dataScope 取值说明

| 值 | 含义 | 可见范围 |
|----|------|----------|
| `all` | 全部数据 | 所有记录（不过滤） |
| `dept` | 本部门 | 与当前用户同 `department_id` 的记录 |
| `self` | 仅本人 | 由 `created_by = currentUserId` 标识的记录 |

---

### 批量操作规范

#### 何时需要

- 用户需要对列表数据进行"批量删除"、"批量启用/禁用"等操作时添加。
- **不是所有列表都需要**，在 Step 0 信息收集时主动询问：「是否需要表格批量操作功能（如批量删除）？」

#### 前端实现模板

```tsx
// 1. 状态声明
const [selectedRowKeys, setSelectedRowKeys] = useState<number[]>([]);

// 2. 批量删除 handler
const handleBatchDelete = () => {
  Modal.confirm({
    title: `确认删除选中的 ${selectedRowKeys.length} 条记录？`,
    content: '删除后无法恢复，请谨慎操作。',
    okButtonProps: { type: 'danger', theme: 'solid' },
    onOk: async () => {
      const res = await request.delete<null>('/api/xxx/batch', { ids: selectedRowKeys });
      if (res.code === 0) {
        Toast.success('批量删除成功');
        setSelectedRowKeys([]);
        void fetchList();
      }
    },
  });
};

// 3. 工具栏中的批量按钮（仅选中时显示，放在 left 区域查询/重置按钮之后）
{selectedRowKeys.length > 0 && hasPermission('system:xxx:delete') && (
  <Button type="danger" theme="light" icon={<Trash2 size={14} />} onClick={handleBatchDelete}>
    批量删除 ({selectedRowKeys.length})
  </Button>
)}

// 4. Table 增加 rowSelection
<Table
  rowSelection={{
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys as number[]),
  }}
  ...
/>
```

#### 后端实现模板

**路由顺序关键**：`DELETE /batch` 必须注册在 `DELETE /:id` **之前**，否则 `/batch` 会被匹配为 `id = "batch"`。

```ts
// ✅ 正确顺序：/batch 在 /:id 之前
xxxRouter.delete('/batch', guard({ permission: 'system:xxx:delete', audit: { ... } }), async (c) => {
  const body = await c.req.json();
  const ids = body?.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ code: 400, message: '请选择要删除的记录', data: null }, 400);
  }
  const validIds = ids.filter((id): id is number => typeof id === 'number' && Number.isInteger(id));
  await db.delete(xxxTable).where(inArray(xxxTable.id, validIds));
  return c.json({ code: 0, message: `已删除 ${validIds.length} 条记录`, data: null });
});

xxxRouter.delete('/:id', ...); // /:id 必须在 /batch 之后
```

> `request.delete(url, body)` 支持传请求体（已在 `request.ts` 中实现）。

---

### 多租户感知规范（tenantScope）

> 仅当 `MULTI_TENANT_MODE=true` 时生效；关闭时工具函数返回 `undefined`，不添加任何过滤，与单实例行为完全兼容。

#### 何时需要隔离

| 模块类型 | 是否需要租户隔离 | 说明 |
|----------|----------------|------|
| **业务数据**（用户、订单、申请单等） | ✅ 需要 | 各租户数据互不可见 |
| **配置数据**（角色、菜单、字典、系统参数等） | ❌ 不需要 | 全局共享 |
| **平台级功能**（租户管理、系统监控等） | ❌ 不需要 | 仅平台超管可访问 |

#### Step 1：Schema 中添加 `tenant_id`

```ts
export const xxxTable = pgTable('xxx', {
  // ...其他字段
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
});
```

#### Step 5（路由）：查询时追加 tenantCondition

```ts
import { tenantCondition, getCreateTenantId } from '../lib/tenant';

// 列表接口
const tCond = tenantCondition(xxxTable, c.get('user'));
if (tCond) conditions.push(tCond);

// 创建接口
await db.insert(xxxTable).values({
  ...validatedData,
  tenantId: getCreateTenantId(c.get('user')),
});
```

#### 关键约束

- `tenantCondition` 在多租户关闭时返回 `undefined`，**无需** 在路由中额外 if 判断是否开启多租户
- 平台超管在「平台视角」时 `tenantCondition` 同样返回 `undefined`，可查看全量数据
- 超管切换至某租户视角后，`tenantCondition` 自动返回 `eq(table.tenantId, viewingTenantId)`
- `getCreateTenantId` 在多租户关闭时返回 `null`，不影响写入

---

### Step 1～10：实现步骤

收集完信息并用户确认后，按以下顺序实现（详细代码模板见对应 references 文件）：

#### 后端（参考 [crud-backend.md](./references/crud-backend.md)）

**Step 1** — `packages/server/src/db/schema.ts`：新增表定义
- 使用 `pgTable` 定义表结构
- 如有新枚举，使用 `pgEnum` 定义（三端必须同步）
- 导出 `XxxRow` 和 `NewXxx` infer 类型

**Step 2** — 生成并执行数据库迁移
```bash
npm run db:generate
npm run db:migrate
```

**Step 3** — `packages/shared/src/validation.ts`：新增 Zod Schema
- `createXxxSchema`：所有字段的验证规则
- `updateXxxSchema = createXxxSchema.partial()`（部分更新）
- 导出对应 `z.infer<>` 类型

**Step 4** — `packages/shared/src/types.ts`：新增 TypeScript Interface
- 包含所有前端展示所需的字段（含关联实体的冗余字段）
- 时间字段序列化为 `string`（ISO 格式）

**Step 5** — `packages/server/src/routes/xxx.ts`：创建 OpenAPIHono Router
- 使用 `new OpenAPIHono<AuthEnv>({ defaultHook: validationHook })` 初始化（`AuthEnv` 从 `'../middleware/auth'` 导入，`validationHook` 从 `'../lib/openapi-schemas'` 导入），确保 Zod 校验失败时返回标准 `{ code: 400, message, data: null }` 格式
- `use('*', authMiddleware)` 保护所有路由
- 使用 `OpenAPIHono + createRoute` 实现标准 5 个端点：`GET /`（list+分页）、`POST /`（create）、`PUT /{id}`（update）、`DELETE /{id}`（delete）、`GET /{id}`（可选，详情）
- 路径风格用 `/{id}` 而非 `/:id`（OpenAPI 规范）
- 每个写操作在 `middleware: [guard({ permission, audit })] as const` 中包裹
- Schema 可直接从 `@zenith/shared/src/validation.ts` 导入（shared 已升级至 Zod v4，与 `@hono/zod-openapi` 一致）；若需要 coerce 或特殊处理，可在路由文件内本地声明
- DTO 响应使用 `z.looseObject({}).openapi('XxxName')` 作为不透明类型

**Step 6** — `packages/server/src/index.ts`：注册路由
```ts
app.route('/api/xxx', xxxRoutes);
```

**Step 6b** — OpenAPI Spec 自动生成
`@hono/zod-openapi` 会从各路由的 `createRoute(...)` 定义自动汇总 OpenAPI spec，**无需手动维护** `src/openapi.ts`。新路由注册到 `app` 后刷新 `/api/openapi.json` 即可看到新接口，无需额外操作。

#### 前端（参考 [crud-frontend.md](./references/crud-frontend.md)）

**Step 7** — `packages/web/src/pages/xxx/XxxPage.tsx`：创建页面组件
- 遵循 AGENTS.md「页面布局规范」
- 搜索栏：使用 `SearchToolbar` 组件（参考 `UsersPage.tsx`）
- 表格：`<Table bordered>`，操作列 `fixed: 'right'`
- 弹窗：新增/编辑共用一个 `<Modal>` + `<Form>`

#### 菜单 & 权限（参考 [menu-seed.md](./references/menu-seed.md)）

**Step 8** — `packages/shared/src/seed-data.ts`：新增菜单和按钮权限条目
- `type: 'menu'`，`component` 字段 = 页面路径（相对 `src/pages/`）
- 为每个操作新增 `type: 'button'` 条目

**Step 9** — `packages/server/src/db/seed.ts`：新增初始数据
- 使用 `onConflictDoNothing()` 保证幂等

#### 可选：MSW Mock（参考 [crud-mock.md](./references/crud-mock.md)）

**Step 10**（仅当用户确认需要 Demo 演示模式时执行）
- `packages/web/src/mocks/data/xxx.ts`：静态数组 + nextId
- `packages/web/src/mocks/handlers/xxx.ts`：全量 handler
- `packages/web/src/mocks/handlers/index.ts`：注册 xxxHandlers

---

### 核心规范约束（每步必须遵守）

> 这些约束在 AGENTS.md 中有完整说明，实现时务必检查。

| 约束 | 规则 |
|------|------|
| **commonErrorResponses** | 所有路由的 `responses:` 块必须包含 `...commonErrorResponses`（涵盖 400/401/403/404/500），从 `'../lib/openapi-schemas'` 导入 |
| **枚举三端同步** | `pgEnum` / TS union type / Zod enum 保持完全一致 |
| **操作列固定** | 所有表格操作列必须 `fixed: 'right'` |
| **树形表格展开控制** | 凡是使用 `children` 字段渲染树形结构的 Table（如部门、菜单），必须在搜索栏添加「全部展开/全部折叠」切换按钮，并使用受控的 `expandedRowKeys` + `onExpandedRowsChange`。参考实现：`allRowKeys`（递归收集全部 key）、`isAllExpanded`（判断是否已全展开）、`toggleExpandAll`（切换）。按钮图标：已展开用 `ChevronsDownUp`，未展开用 `ChevronsUpDown`（来自 `lucide-react`）。 |
| **时间格式** | 时间显示统一使用 `formatDateTime()`，禁止原生 `toLocaleString()` 等 |
| **图标库** | 统一使用 `lucide-react`，禁止 `@douyinfe/semi-icons` |
| **操作按钮样式** | `theme="borderless" size="small"`，删除加 `type="danger"` |
| **无图标文字按钮** | 操作列按钮只用纯文字，不加图标 |
| **搜索栏布局** | 使用 `SearchToolbar` 组件（`components/SearchToolbar.tsx`），参考 `UsersPage.tsx` |
| **表格样式** | 统一 `<Table bordered>` |
| **响应码规范** | 成功 `{ code: 0 as const, message: 'ok', data: T }`（必须 `as const`），失败 `{ code: 400, message: '...', data: null }`，每个 `c.json(...)` 第二参数必须显式带状态码 `, 200)` |
| **分页格式** | 列表接口返回 `{ list, total, page, pageSize }` |
| **数据权限** | 业务数据模块在 Step 0 必须询问是否需要 dataScope 过滤；配置数据（角色/菜单/字典）无需过滤 |
| **多租户隔离** | 业务数据表添加 `tenantId` 字段，查询用 `tenantCondition(table, user)`，创建用 `getCreateTenantId(user)`；关闭多租户时两者均返回 `null`/`undefined`，无需额外判断 |
| **批量操作路由顺序** | `DELETE /batch` 必须注册在 `DELETE /:id` 之前，防止路由冲突 |
| **批量按钮显示时机** | 批量操作按钮仅在 `selectedRowKeys.length > 0` 时显示，放在查询/重置按钮之后 |

---

## 发布新版本流程

> 详细步骤请参阅 [references/release.md](references/release.md)。

触发时机：用户说「发布 vX.Y.Z」「准备发布」「release X.Y.Z」时，立即读取 `references/release.md` 并按步骤执行。
