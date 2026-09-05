---
name: zenith
description: "Zenith Admin 项目专属开发辅助。Use when: 开发新模块、实现 CRUD、新增页面、配置菜单权限、增删改查、新建后台功能、新增管理功能、异步任务、批量操作、任务进度、发通知、通知事件、消息提醒、订阅通知、发布新版本、db migration、seed data、MSW mock、修改现有模块、添加字段、系统设置、运行时设置、加开关、加配置项、新增设置模块。包含完整的 CRUD 代码生成流程（Step 0-11）、异步任务接入、通知中心接入、运行时设置接入、模块修改流程与版本发布流程。"
argument-hint: "部门管理 CRUD | 公告管理（含 MSW Mock）| 发布 v1.2.0 | 给用户表加字段"
user-invocable: true
---

# Zenith Admin 开发辅助 Skill

Zenith Admin 是基于 **Hono + React + Drizzle ORM** 的全栈后台管理系统，npm monorepo 结构
（`packages/server` + `packages/web` + `packages/shared`）。
前后端与 Mock 的 API 契约（路径、入参、响应形状）统一定义在 `packages/shared/src/{业务域}/contracts/`，
服务端路由、前端 hooks、MSW handler 与 OpenAPI 文档都由契约派生。

## 怎么用这个 skill

1. 按下表识别场景，进入对应流程。
2. **动手改代码前先读硬约束**：后端与全局看 [constraints.md](./references/constraints.md)，
   前端看 [constraints-frontend.md](./references/constraints-frontend.md)；改完按同一份清单核对本次涉及的层。
3. 其余参考文件**按需读取**，不要预先全部加载。

| 场景 | 触发词 | 流程 |
| --- | --- | --- |
| CRUD 开发 | 实现 XXX CRUD、新增 XXX 模块、开发 XXX 功能、新增管理页面 | 本文件 Step 0 → Step 11 |
| 修改已有模块 | 给 XXX 加字段、修改 XXX 接口、XXX 添加关联、改枚举、删字段 | [module-modification.md](./references/module-modification.md) |
| 发送通知 / 新增通知事件 | 发通知、通知用户、订阅提醒、接入通知中心、加通知事件 | [notifications.md](./references/notifications.md) |
| 异步任务 / 大批量作业 | 批量导入、大数据量处理、后台任务、任务进度、长耗时操作 | [async-tasks.md](./references/async-tasks.md) |
| 运行时设置 / 系统开关 | 加一个开关、可配置阈值、系统设置项、新增设置模块、读取系统设置 | [settings.md](./references/settings.md) |
| 发布新版本 | 发布 vX.Y.Z、准备发布、release X.Y.Z | [release.md](./references/release.md) |
| 报错排查 | 构建失败、迁移失败、类型不匹配、缓存不刷新、启动缓慢 | [troubleshooting.md](./references/troubleshooting.md) |

## 参考文件

| 文件 | 里面有什么 | 什么时候读 |
| --- | --- | --- |
| [constraints.md](./references/constraints.md) | 后端与全局硬约束：一句话可核对的「必须 / 禁止」 | 改后端 / 种子 / Mock 前、完成后核对 |
| [constraints-frontend.md](./references/constraints-frontend.md) | 前端硬约束 | 改前端前、完成后核对 |
| [crud-intake.md](./references/crud-intake.md) | Step 0 必填信息、可选能力与提问方式 | 从零开发 CRUD 模块时 |
| [crud-backend.md](./references/crud-backend.md) | Step 1-7 后端主链路模板 | 写后端时 |
| [backend-patterns.md](./references/backend-patterns.md) | 数据权限、多租户、审计 diff、附件、外呼 HTTP、重依赖懒加载 | 用到对应能力时 |
| [query-cache.md](./references/query-cache.md) | 前端数据获取架构、缓存一致性契约、query key 结构 | 写域 hooks / 定失效策略时 |
| [crud-frontend.md](./references/crud-frontend.md) | Step 8 域 hooks 与列表页模板 | 写前端时 |
| [ui-patterns.md](./references/ui-patterns.md) | 多 Tab、左右分栏、平铺列表、List 分页、统计卡、栅格、虚拟化表格 | 页面结构超出标准列表页时 |
| [seed-config.md](./references/seed-config.md) | Step 9-10 菜单权限与种子数据 | 配菜单 / 种子时 |
| [crud-mock.md](./references/crud-mock.md) | Step 11 MSW Mock 模板 | 需要 Demo 模式时 |
| [async-tasks.md](./references/async-tasks.md) | 任务中心接入与选型对照 | 大数据量、长耗时或需进度 / 重试 / 取消时 |
| [settings.md](./references/settings.md) | 运行时设置接入：加字段 / 新模块 / 服务端读取 / 前端读取 / Mock | 任何「后台可改、影响系统行为」的开关或阈值 |
| [notifications.md](./references/notifications.md) | 通知中心接入：事件注册、notify() 调用、渠道策略 | 任何「发生某事 → 通知相关人」的功能 |
| [module-modification.md](./references/module-modification.md) | 加字段 / 改接口 / 加关联 / 改枚举 / 删字段的步骤序列 | 改已有模块时 |
| [troubleshooting.md](./references/troubleshooting.md) | 症状 → 定位 → 指回规范 | 报错时 |
| [release.md](./references/release.md) | 版本发布流程 | 发版时 |

> 规则只在归属文件里写一遍：约束正文在两个 `constraints*.md`，代码写法与展开说明在对应主题文件。
> 需要引用时给指针，**不要把内容抄到第二处**。

> **占位符约定**（全库通用）：`xxx` = 小写（表名、API 路径、文件名）；`Xxx` = 大驼峰（TypeScript 类型、组件名）。

---

## ⛔ Step 0：信息收集（BLOCKING GATE，不得跳过）

读取 [crud-intake.md](./references/crud-intake.md)，只补齐用户尚未提供的信息。
使用当前环境可用的交互式提问能力，完成汇总确认后再进入 Step 1。

---

## 第一阶段：后端（Step 1-7）

按顺序执行，模板见 [crud-backend.md](./references/crud-backend.md)。

| Step | 任务 | 文件 |
| --- | --- | --- |
| 1 | 数据库 Schema | `packages/server/src/db/schema/{业务域}.ts`（relations 写在 `db/schema/relations.ts`） |
| 2 | 生成并执行迁移 | `npm run db:generate && npm run db:migrate` |
| 3 | 共享 Zod 校验 Schema | `packages/shared/src/{业务域}/validation.ts`（枚举常量放同域 `constants.ts`） |
| 4 | 共享契约（实体 schema + 操作） | `packages/shared/src/{业务域}/contracts/xxxs.ts`（在 `contracts/index.ts` 登记） |
| 5 | Service 层 | `packages/server/src/services/{业务域}/xxx.service.ts` |
| 6 | 路由（`defineContractRoute`） | `packages/server/src/routes/{业务域}/xxx.ts` |
| 7 | 注册路由 | `packages/server/src/routes/{业务域}/index.ts`（挂载路径取 `xxxContract.basePath`；新增域需同步 `routes/index.ts`） |

> Step 7 完成后执行 `npm run dev:server` 冒烟验证，无编译错误再继续。
> 实现过程中按本次涉及的章节对照 [constraints.md](./references/constraints.md)，不要在入口文件复制约束正文。

## 第二阶段：前端（Step 8）

先读 [query-cache.md](./references/query-cache.md) 定下失效策略，再按 [crud-frontend.md](./references/crud-frontend.md) 写代码，
并对照 [constraints-frontend.md](./references/constraints-frontend.md)。
服务端状态统一走 **TanStack Query v5**，hooks 由契约派生（`createResourceQueries` / `useApiQuery` / `useApiMutation`），
禁止手写 `loading` / `fetchXxx` / `useEffect` 拉取模式，也禁止书写 `/api/...` 路径字面量。

| Step | 任务 | 文件 |
| --- | --- | --- |
| 8a | 域 hooks（查询 / 变更） | `packages/web/src/hooks/queries/xxxs.ts` |
| 8b | 页面组件 | `packages/web/src/pages/xxx/XxxPage.tsx` |

页面结构超出标准列表页（多 Tab、左右分栏、统计卡、虚拟化表格）时读 [ui-patterns.md](./references/ui-patterns.md)。

## 第三阶段：配置与 Mock（Step 9-11）

| Step | 任务 | 文件 | 条件 |
| --- | --- | --- | --- |
| 9 | 菜单 / 权限配置 | `packages/shared/src/seed/menus/{段}.ts` | 总是 |
| 10 | 种子数据 | `packages/shared/src/seed/{业务域}.ts` + `packages/server/src/db/seed.ts` | 总是 |
| 11 | MSW Mock（`mock(op, resolver)`） | `packages/web/src/mocks/data/xxxs.ts` + `handlers/xxxs.ts` | 仅 Step 0 确认需要时 |

模板见 [seed-config.md](./references/seed-config.md)（Step 9-10）与 [crud-mock.md](./references/crud-mock.md)（Step 11）。

---

## ✅ CRUD 完成标准

全部通过才算完成：

- [ ] `npm run db:generate && npm run db:migrate` 已执行，迁移文件已提交
- [ ] `npm run build` 无报错
- [ ] `npm run dev:server` 冒烟通过，新接口在 `/api/docs` 中可见且可调用
- [ ] `npm run lint` 通过（web 含 ESLint 与 stylelint；server 含契约编译期检查）
- [ ] `npm run test -w @zenith/shared` 通过（契约 DSL 与类型推导）
- [ ] `npm run test -w @zenith/web` 通过；域 hooks 的失效行为测试已补充
- [ ] 页面实测：查询 / 重置 / 新增 / 编辑 / 删除 / 导出，确认操作后相关列、统计与面板都刷新
      （欠失效比多失效更危险），移动端窄屏同样走一遍
- [ ] Step 0 确认需要 MSW Mock 时，Demo 模式（`VITE_DEMO_MODE=true`）下页面功能完整
- [ ] 打开 [constraints.md](./references/constraints.md) 与 [constraints-frontend.md](./references/constraints-frontend.md)，
      按本次改动涉及的层逐组对照（约束条目本身即核对项）
