# AGENTS.md

`AGENTS.md` 位于仓库根目录，是 AI 编程工具进入项目时优先读取的项目导航文件。

## 定位

`AGENTS.md` 只维护稳定事实：系统边界、工作区职责、依赖方向、运行时链路、业务域组织、文档入口与常用命令。它不承载代码模板，也不复述硬约束正文。

## 当前内容结构

| 章节 | 内容 |
| --- | --- |
| 文档定位 | 说明 AGENTS.md 的边界，并指向 `constraints.md` / `constraints-frontend.md` 与 Zenith Skill |
| 系统上下文 | 客户端、Web、SDK、Server、PostgreSQL、Redis、文件存储、外部平台之间的关系 |
| 核心边界 | Web、Server、Shared、数据库、Redis、Worker / Subscriber 的职责 |
| 主要目录职责与依赖 | `packages/server`、`packages/web`、`packages/shared`、`packages/analytics-sdk`、`packages/electron`、`docs` |
| 业务域组织 | shared、server routes、server services、db schema、web hooks/pages、seed、mock 的纵向切分方式 |
| 后端分层与运行时 | `src/index.ts`、`src/bootstrap/`、`src/app.ts`、middleware、routes、services、db、lib |
| 前端运行时 | 多入口、TanStack Query、Request Adapter、管理员/会员认证隔离、Demo 模式 |
| 跨领域架构 | 契约一致性、身份隔离、事务、异步任务、通知、AI、外部集成、可观测性 |
| 权威入口 | 文档站与 skill reference 的索引 |
| 常用命令 | dev、build、lint、test、db、docs 命令 |

## 与 Zenith Skill 的分工

| 问题 | 入口 |
| --- | --- |
| 项目有哪些包、目录和业务域？ | `AGENTS.md` |
| 常用命令怎么跑？ | `AGENTS.md` 与 [本地开发](/guide/development) |
| 新增后端契约、路由、Service 怎么写？ | `.agents/skills/zenith/references/constraints.md` + `crud-backend.md` |
| 新增页面、hooks、表格、弹窗怎么写？ | `.agents/skills/zenith/references/constraints-frontend.md` + `query-cache.md` + `crud-frontend.md` |
| 完整 CRUD 模块怎么落地？ | `.agents/skills/zenith/SKILL.md` Step 0-11 |
| 异步任务、通知、模块修改、发版怎么处理？ | 对应 reference 文件 |

## 维护约定

- 目录、工作区、命令或业务域变化时同步更新 `AGENTS.md`。
- 编码规范变化时更新 `.agents/skills/zenith/references/`，不要复制到 `AGENTS.md`。
- 新增权威入口或文档入口时，再更新 `AGENTS.md` 的索引。
- 文档站本页只描述结构和分工，具体条目以仓库根目录 `AGENTS.md` 为准。
