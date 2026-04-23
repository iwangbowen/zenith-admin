---
name: zenith
description: "Zenith Admin 项目专属开发辅助。Use when: 开发新模块、实现 CRUD 功能、新增页面、配置菜单权限、实现增删改查、新建后台功能模块、新增管理功能、发布新版本。包含 CRUD 完整代码生成流程与版本发布流程。"
argument-hint: "要开发的功能描述，例如：部门管理 CRUD、公告管理页面；或发布操作：发布 v0.2.0"
---

# Zenith Admin 开发辅助 Skill

## 工作流

| 场景 | 触发关键词 |
| --- | --- |
| CRUD 增删改查 | 「实现 XXX CRUD」「新增 XXX 模块」「开发 XXX 功能」 |
| 发布新版本 | 「发布 vX.Y.Z」「准备发布」「release X.Y.Z」 |

---

## CRUD 开发流程

### Step 0：信息收集

**开始写任何代码之前**，先读取并按照 [references/step0-checklist.md](./references/step0-checklist.md) 中的问卷向用户收集信息，汇总确认后再实现。

### Step 1-10：实现顺序

| 步骤 | 文件 | 参考 |
| --- | --- | --- |
| 1. Schema | `packages/server/src/db/schema.ts` | [crud-backend.md](./references/crud-backend.md) |
| 2. 迁移 | 终端：`npm run db:generate && npm run db:migrate` | — |
| 3. Zod Schema | `packages/shared/src/validation.ts` | [crud-backend.md](./references/crud-backend.md) |
| 4. TS Interface | `packages/shared/src/types.ts` | [crud-backend.md](./references/crud-backend.md) |
| 5. Route | `packages/server/src/routes/xxx.ts` | [crud-backend.md](./references/crud-backend.md) |
| 6. 注册路由 | `packages/server/src/index.ts` | [crud-backend.md](./references/crud-backend.md) |
| 7. 页面 | `packages/web/src/pages/xxx/XxxPage.tsx` | [crud-frontend.md](./references/crud-frontend.md) |
| 8. 菜单/权限 | `packages/shared/src/seed-data.ts` | [menu-seed.md](./references/menu-seed.md) |
| 9. 种子数据 | `packages/server/src/db/seed.ts` | [menu-seed.md](./references/menu-seed.md) |
| 10. MSW Mock | `packages/web/src/mocks/` | [crud-mock.md](./references/crud-mock.md)（仅需 Demo 时） |

### 核心约束

**每步实现完毕后**，对照 [references/constraints.md](./references/constraints.md) 检查是否违反任何约束。

---

## 发布新版本

读取 [references/release.md](./references/release.md) 并按步骤执行。
