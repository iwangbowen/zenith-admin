---
name: zenith
description: "Zenith Admin 项目专属开发辅助。Use when: 开发新模块、实现 CRUD 功能、新增页面、配置菜单权限、实现增删改查、新建后台功能模块、新增管理功能、发布新版本。包含 CRUD 完整代码生成流程与版本发布流程。"
argument-hint: "部门管理 CRUD | 公告管理（含 MSW Mock）| 发布 v1.2.0"
context: fork
---

# Zenith Admin 开发辅助 Skill

## 场景识别

- **CRUD 增删改查**：触发词「实现 XXX CRUD」「新增 XXX 模块」「开发 XXX 功能」「新增管理页面」
- **发布新版本**：触发词「发布 vX.Y.Z」「准备发布」「release X.Y.Z」

---

## CRUD 开发流程

### ⛔ BLOCKING GATE — Step 0：信息收集（不得跳过）

**在生成任何代码之前，必须先完成 Step 0。**

读取 [references/step0-checklist.md](./references/step0-checklist.md)，通过 `vscode_askQuestions` 向用户逐项收集信息，展示汇总后用户确认，再进入 Step 1。

Step 0 中必须同时确认以下可选项（决定后续步骤是否执行）：
- 是否需要 MSW Mock？→ 影响 Step 11 是否执行
- 是否有状态字段 / 关联实体 / 数据权限（dataScope）/ 租户隔离 / 批量操作 / 数据导出？

---

### Step 1–11：实现顺序

按顺序执行，每步的代码模板和规范见对应参考文档。

**后端（Step 1–7）** → 详见 [crud-backend.md](./references/crud-backend.md)

- Step 1：Schema — `packages/server/src/db/schema.ts`
- Step 2：迁移 — `npm run db:generate && npm run db:migrate`
- Step 3：Zod Schema — `packages/shared/src/validation.ts`
- Step 4：TS Interface — `packages/shared/src/types.ts`
- Step 5：Service — `packages/server/src/services/xxx.service.ts`
- Step 6：Route — `packages/server/src/routes/xxx.ts`
- Step 7：注册路由 — `packages/server/src/index.ts`

> Step 7 完成后执行 `npm run dev:server` 冒烟验证，无编译错误再继续。

**前端（Step 8）** → 详见 [crud-frontend.md](./references/crud-frontend.md)

- Step 8：页面 — `packages/web/src/pages/xxx/XxxPage.tsx`

**配置 & 种子数据（Step 9–10）** → 详见 [seed-config.md](./references/seed-config.md)

- Step 9：菜单/权限 — `packages/shared/src/seed-data.ts`
- Step 10：种子数据 — `packages/server/src/db/seed.ts`

**Demo 演示 Mock（Step 11，仅 Step 0 确认需要时执行）** → 详见 [crud-mock.md](./references/crud-mock.md)

- Step 11：MSW Mock — `packages/web/src/mocks/data/xxxs.ts` + `handlers/xxxs.ts` + `handlers/index.ts`

**约束检查** → 详见 [constraints.md](./references/constraints.md)，实现过程中随时对照。

---

### ✅ CRUD 完成标准

- [ ] `npm run build` 无报错
- [ ] 数据库迁移已执行
- [ ] 路由已注册到 `packages/server/src/index.ts`
- [ ] 菜单已添加到 `packages/shared/src/seed-data.ts`
- [ ] 需要 MSW Mock → Step 11 已完成

---

## 发布新版本

读取 [references/release.md](./references/release.md) 并按步骤执行（共 7 步）：

1. 确认语义化版本号（查看 `git log <上一tag>..HEAD --oneline`）
2. 同步更新根 + 3 个子包的 `package.json` 版本字段
3. `npm install --package-lock-only` 更新 lock 文件
4. `npm run build` 本地验证（失败须修复后再继续）
5. 在 `docs/changelog/index.md` 顶部追加当前版本记录
6. `git commit` → `git tag vX.Y.Z` → `git push origin master --tags`
7. 等待 `release.yml` 自动发布 GitHub Release
