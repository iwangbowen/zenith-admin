---
name: zenith
description: "Zenith Admin 项目专属开发辅助。Use when: 开发新模块、实现 CRUD、新增页面、配置菜单权限、增删改查、新建后台功能、新增管理功能、发布新版本、db migration、seed data、MSW mock、修改现有模块、添加字段。包含完整的 CRUD 代码生成流程（Step 0-11）、模块修改流程与版本发布流程。"
argument-hint: "部门管理 CRUD | 公告管理（含 MSW Mock）| 发布 v1.2.0 | 给用户表加字段"
user-invocable: true
---

# Zenith Admin 开发辅助 Skill

你是 Zenith Admin 项目的专属开发辅助 Agent。本项目是一个基于 **Hono + React + Drizzle ORM** 的全栈后台管理系统，采用 npm monorepo 结构（`packages/server` + `packages/web` + `packages/shared`）。

## 场景识别

- **CRUD 开发**：触发词「实现 XXX CRUD」「新增 XXX 模块」「开发 XXX 功能」「新增管理页面」
- **修改现有模块**：触发词「给 XXX 加字段」「修改 XXX 接口」「XXX 添加关联」
- **发布新版本**：触发词「发布 vX.Y.Z」「准备发布」「release X.Y.Z」

> **快速模式**：如果用户说「帮我实现一个简单的 XXX 管理，用默认配置」，可以跳过 Step 0 中的可选项（MSW Mock、数据权限、租户隔离等），使用合理默认值直接生成。

---

## CRUD 开发流程（Step 0 → Step 11）

### ⛔ BLOCKING GATE — Step 0：信息收集（不得跳过）

**在生成任何代码之前，必须先完成 Step 0。**

读取 [references/step0-checklist.md](./references/step0-checklist.md)，通过 `vscode_askQuestions` 向用户逐项收集信息，展示汇总后用户确认，再进入 Step 1。

Step 0 中必须同时确认以下可选项（决定后续步骤是否执行）：
- 是否需要 MSW Mock？→ 影响 Step 11 是否执行
- 是否有状态字段 / 关联实体 / 数据权限（dataScope）/ 租户隔离 / 批量操作 / 数据导出？

---

### 第一阶段：后端实现（Step 1-7）

按顺序执行，每步的代码模板和规范见 [crud-backend.md](./references/crud-backend.md)。

| Step | 任务 | 文件 |
|------|------|------|
| 1 | 数据库 Schema | `packages/server/src/db/schema.ts` |
| 2 | 生成并执行迁移 | `npm run db:generate && npm run db:migrate` |
| 3 | 共享 Zod Schema | `packages/shared/src/validation.ts` |
| 4 | 共享 TS Interface | `packages/shared/src/types.ts` |
| 5 | Service 层 | `packages/server/src/services/xxx.service.ts` |
| 6 | OpenAPI Route | `packages/server/src/routes/xxx.ts` |
| 7 | 注册路由 | `packages/server/src/index.ts` |

> Step 7 完成后执行 `npm run dev:server` 冒烟验证，无编译错误再继续。

> ⚠️ **外呼调用统一走 `http-client`**：任何 service / 路由中向外部发起的 HTTP 请求（OAuth、第三方 API、链接抓取等），**必须**使用 `packages/server/src/lib/http-client.ts` 的 `httpRequest` / `httpGet` / `httpPost` 等，**禁止**直接 `fetch()`。详见 [crud-backend.md 外呼 HTTP 调用](./references/crud-backend.md) 与 [docs/backend/http-client.md](../../../docs/backend/http-client.md)。

---

### 第二阶段：前端实现（Step 8）

代码模板和规范见 [crud-frontend.md](./references/crud-frontend.md)。

| Step | 任务 | 文件 |
|------|------|------|
| 8 | 页面组件 | `packages/web/src/pages/xxx/XxxPage.tsx` |

---

### 第三阶段：配置与 Mock（Step 9-11）

代码模板和规范见 [seed-config.md](./references/seed-config.md)。

| Step | 任务 | 文件 | 条件 |
|------|------|------|------|
| 9 | 菜单/权限配置 | `packages/shared/src/seed-data.ts` | 总是 |
| 10 | 种子数据 | `packages/server/src/db/seed.ts` | 总是 |
| 11 | MSW Mock | `packages/web/src/mocks/data/xxxs.ts` + `handlers/xxxs.ts` | 仅 Step 0 确认需要时 |

MSW Mock 的详细代码模板见 [crud-mock.md](./references/crud-mock.md)。

---

### ✅ CRUD 完成标准与自检清单

**后端：**
- [ ] `npm run build` 无报错
- [ ] 数据库迁移已执行
- [ ] 路由已注册到 `packages/server/src/index.ts`
- [ ] DTO 定义在 `lib/dtos/` 中，路由中没有本地 `.openapi()` 声明
- [ ] Service 中没有 `c.json()` 或 `console.*`
- [ ] 路由 handler 中没有直接 `db.*` 调用
- [ ] 分页查询用 `Promise.all` 并行执行 count 和 list
- [ ] LIKE 查询用 `escapeLike()` 转义

**前端：**
- [ ] 页面组件已创建，使用 `SearchToolbar` + `ConfigurableTable`
- [ ] 搜索项较多的列表页使用 `SearchToolbar` 结构化模式，移动端至少露出一个高频搜索/筛选项（优先关键词；无关键词时选最常用且区分度最高的筛选项，如渠道/类型/作用域）、查询、新增等高频入口，其他筛选进底部筛选抽屉，低频操作进更多菜单
- [ ] 操作列通过 `createOperationColumn` 创建；桌面端按需用 `desktopInlineKeys` 保留高频内联按钮，移动端自动收纳到更多菜单；状态列紧靠操作列左侧也 `fixed: 'right'`
- [ ] ConfigurableTable 传入了 `onRefresh` 和 `refreshLoading`
- [ ] Modal 表单 `labelPosition="left"`，`closeOnEsc`

**配置：**
- [ ] 菜单已添加到 `packages/shared/src/seed-data.ts`
- [ ] 需要 MSW Mock → Step 11 已完成

**约束对照：** 实现过程中随时查阅 [constraints.md](./references/constraints.md)。

---

## 修改现有模块

当需要修改已有模块（加字段、改接口、加关联关系）时，读取 [references/module-modification.md](./references/module-modification.md) 并按其中的 checklist 执行。

---

## 调试与排错

遇到构建错误、迁移失败、类型不匹配等问题时，查阅 [references/troubleshooting.md](./references/troubleshooting.md)。

---

## 发布新版本

读取 [references/release.md](./references/release.md) 并严格按其中的步骤执行。
