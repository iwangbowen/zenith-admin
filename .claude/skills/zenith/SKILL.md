---
name: zenith
description: "Zenith Admin 项目专属开发辅助。Use when: 开发新模块、实现 CRUD 功能、新增页面、配置菜单权限、实现增删改查、新建后台功能模块、新增管理功能。包含 CRUD 完整代码生成流程，后续支持更多工作流扩展。"
argument-hint: "要开发的功能描述，例如：部门管理 CRUD、公告管理页面"
---

# Zenith Admin 开发辅助 Skill

## 已支持的工作流

| 场景 | 触发方式 | 参考文档 |
|------|---------|---------|
| CRUD 模块（增删改查） | 「实现 XXX 的 CRUD」「新增 XXX 模块」「开发 XXX 功能」 | [CRUD 流程](#crud-模块开发流程) |
| （后续扩展，如数据统计页、导入导出等） | — | — |

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

收集完所有信息后，向用户展示汇总确认，再开始实现。

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

**Step 5** — `packages/server/src/routes/xxx.ts`：创建 Hono Router
- `use('*', authMiddleware)` 保护所有路由
- 实现标准 5 个端点：`GET /`（list+分页）、`POST /`（create）、`PUT /:id`（update）、`DELETE /:id`（delete）、`GET /:id`（可选，详情）
- 每个写操作用 `guard({ permission, audit })` 包裹

**Step 6** — `packages/server/src/index.ts`：注册路由
```ts
app.route('/api/xxx', xxxRoutes);
```

#### 前端（参考 [crud-frontend.md](./references/crud-frontend.md)）

**Step 7** — `packages/web/src/pages/xxx/XxxPage.tsx`：创建页面组件
- 遵循 AGENTS.md「页面布局规范」
- 搜索栏：左搜右操作，`<div className="search-area">`
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
| **枚举三端同步** | `pgEnum` / TS union type / Zod enum 保持完全一致 |
| **操作列固定** | 所有表格操作列必须 `fixed: 'right'` |
| **时间格式** | 时间显示统一使用 `formatDateTime()`，禁止原生 `toLocaleString()` 等 |
| **图标库** | 统一使用 `lucide-react`，禁止 `@douyinfe/semi-icons` |
| **操作按钮样式** | `theme="borderless" size="small"`，删除加 `type="danger"` |
| **无图标文字按钮** | 操作列按钮只用纯文字，不加图标 |
| **搜索栏布局** | `<div className="search-area">`，内部 flex + `justifyContent: 'space-between'`，搜索在左，新增在右 |
| **表格样式** | 统一 `<Table bordered>` |
| **响应码规范** | 成功 `{ code: 0, message: 'ok', data: T }`，失败 `{ code: 400, message: '...', data: null }` |
| **分页格式** | 列表接口返回 `{ list, total, page, pageSize }` |
