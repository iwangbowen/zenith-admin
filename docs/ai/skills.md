# Zenith Skill

Zenith Skill 位于 `.agents/skills/zenith/`，是本项目开发流程、代码模板与硬约束的权威入口。

## 触发场景

| 场景 | 入口 |
| --- | --- |
| 新增 CRUD / 后台功能 / 管理页面 | `SKILL.md` Step 0-11 |
| 修改已有模块、加字段、改枚举、改接口 | `references/module-modification.md` |
| 大批量、长耗时、需进度 / 重试 / 取消 | `references/async-tasks.md` |
| 通知事件、消息提醒、通知中心接入 | `references/notifications.md` |
| 发布版本 | `references/release.md` |
| 构建、迁移、缓存、启动等报错排查 | `references/troubleshooting.md` |

## 渐进式披露结构

入口 `SKILL.md` 只负责识别场景、编排步骤和定义完成标准；具体规则按任务加载。

| 文件 | 职责 | 读取时机 |
| --- | --- | --- |
| `SKILL.md` | 场景路由、Step 0-11 编排、完成标准 | 命中 Zenith 开发任务时 |
| `references/constraints.md` | 后端、菜单、Mock 与全局硬约束 | 改动对应层前后 |
| `references/constraints-frontend.md` | 前端硬约束 | 改前端前后 |
| `references/crud-intake.md` | CRUD Step 0 信息收集 | 从零开发 CRUD 时 |
| `references/crud-backend.md` | Step 1-7 后端主链路模板 | 写后端时 |
| `references/backend-patterns.md` | 数据权限、多租户、审计 diff、附件、外呼 HTTP、重依赖懒加载 | 用到对应能力时 |
| `references/query-cache.md` | 数据获取、缓存一致性与 query key | 写域 hooks 时 |
| `references/crud-frontend.md` | Step 8 标准列表页模板 | 写前端时 |
| `references/ui-patterns.md` | 多 Tab、左右分栏、统计卡、栅格、虚拟化表格 | 页面结构超出标准列表页时 |
| `references/seed-config.md` | Step 9-10 页面读权限、操作权限与种子数据 | 配菜单 / 权限 / seed 时 |
| `references/crud-mock.md` | Step 11 MSW Mock | 需要 Demo 模式时 |
| `references/async-tasks.md` | 任务中心接入与设施选型 | 大数据量、长耗时或需进度 / 重试 / 取消时 |
| `references/notifications.md` | 通知中心接入、事件注册与 `notify()` 调用 | 发送通知或新增通知事件时 |
| `references/module-modification.md` | 修改现有模块的步骤序列 | 加字段、改接口、改关联、改枚举或删字段时 |
| `references/troubleshooting.md` | 按症状排查并指回规范 | 报错时 |
| `references/release.md` | 版本发布流程 | 发版时 |

## 单一事实来源

- 后端与全局约束：`references/constraints.md`
- 前端约束：`references/constraints-frontend.md`
- CRUD 编排：`SKILL.md` + `crud-*` reference
- 异步任务：`async-tasks.md`
- 通知中心：`notifications.md`
- 发布：`release.md`

本页不复制约束正文，避免与 skill 源文件分叉。AI 工具执行任务时应读取仓库内文件。

## 维护约定

- 一条规范只保留一个正文。
- 硬约束写入对应 `constraints*.md`，代码模板写入对应主题 reference。
- 新增 reference 文件时，同时更新 `SKILL.md` 与本页表格。
- 单个 reference 文件保持可一次读入；内容过大时按职责拆分。
