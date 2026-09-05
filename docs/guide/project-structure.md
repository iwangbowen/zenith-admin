# 项目结构

Zenith Admin 是 npm workspaces monorepo。后端是模块化单体，前端提供多入口应用，共享层维护前后端契约。

```text
zenith-admin/
├── .agents/              # AI 辅助开发资产（Zenith Skill）
├── .github/workflows/    # CI、Pages、Release 工作流
├── docs/                 # VitePress 文档站
├── docker/               # Nginx、entrypoint、Mastra Studio 构建脚本
├── packages/
│   ├── server/           # Hono API、CMS SSR/静态化、后台运行时
│   ├── web/              # React 管理后台、会员前台、移动审批、Demo
│   ├── shared/           # 类型、常量、Zod schema、seed
│   ├── analytics-sdk/    # 浏览器埋点与错误采集 SDK
│   └── electron/         # Electron 主进程、preload、桌面更新
├── Dockerfile
├── docker-compose.yml
├── docker-compose.dev.yml
├── package.json
└── README.md
```

## `packages/server`

后端基于 **Hono v4** 与 `@hono/zod-openapi`，通过 Node.js 运行。

| 目录 / 文件 | 职责 |
| --- | --- |
| `src/app.ts` | 创建 Hono 应用、装配中间件、领域路由、OpenAPI、CMS 兜底与全局错误处理 |
| `src/index.ts` | 进程启动、监听、worker / subscriber 注册、遥测与优雅停机 |
| `src/bootstrap/` | 后台 worker 与事件订阅者注册 |
| `src/routes/` | HTTP 协议边界，当前 18 个领域目录见下方清单 |
| `src/services/` | 业务规则、事务、数据映射、前置校验 |
| `src/db/` | Drizzle schema、迁移、seed、数据库封装 |
| `src/middleware/` | 认证、权限、限流、幂等、CSRF、维护模式、开放平台网关、HTTP 日志等 |
| `src/lib/` | 契约路由适配（`contract-route.ts`）、运行时设置（`settings/`）与跨实例失效总线（`invalidation-bus.ts`）、时间、JWT、Redis、文件存储、任务中心、通知 outbox、HTTP 客户端、日志等通用能力 |
| `drizzle/` | Drizzle 生成的迁移文件 |

`packages/server/src/routes/` 当前领域目录：

```text
ai, analytics, biz-demo, chat, cms, drive, files, identity, member,
messaging, mp, open-platform, ops, payment, platform, report,
tasks, wiki, workflow
```

## `packages/web`

前端基于 **React 19 + Vite 8 + Semi Design v2**。Vite 多入口：

| 入口 | 说明 |
| --- | --- |
| `index.html` | 后台管理主应用 |
| `member.html` | C 端会员前台 SPA |
| `approval.html` | 移动审批轻页 |

关键目录：

| 目录 | 职责 |
| --- | --- |
| `src/pages/` | 后台页面，按业务域拆分（含 `rules`、`wiki`、`drive`、`open-platform`、`system/app-releases` 等） |
| `src/member/` | 会员前台独立应用 |
| `src/approval/` | 移动审批入口 |
| `src/layouts/` | 后台主布局、偏好面板、多账号切换、Electron 标题栏承载 |
| `src/components/` | 公共组件（含 `settings/` 的 schema 驱动设置表单） |
| `src/hooks/queries/` | TanStack Query v5 域 hooks（由 `lib/contract-query.ts` 按契约派生） |
| `src/lib/` | 契约调用层（`contract-query.ts`）、请求、账号停靠、主题色等封装 |
| `src/mocks/` | MSW Demo 数据、handlers、测试与工具 |
| `src/webrtc/` | Chat 音视频通话管理 |
| `src/styles/` | 全局样式与响应式规则 |

## `packages/shared`

共享层按业务域拆分并通过 package exports 暴露子路径。当前目录：

```text
ai, analytics, biz, chat, cms, core, drive, identity, licensing, member,
messaging, mp, open-platform, ops, payment, platform, report,
rules, seed, settings, tasks, wiki, workflow
```

每个业务域通常包含 `contracts/`（实体 schema 与操作契约，前后端与 Mock 的唯一真相）、`validation.ts`、`constants.ts`、`types.ts`（无法由 schema 推导的类型）、`index.ts`。`settings` 是横切域：`modules/` 下每个文件是一个运行时设置模块（带默认值的 Zod 文档 + 治理元数据），`registry.ts` 汇总为注册表，服务端读取、前端表单、Mock 与 OpenAPI 都由它派生，见[运行时设置](../backend/settings.md)。业务代码使用域子路径导入，例如：

```ts
import type { User } from '@zenith/shared/identity';
import { createPaymentOrderSchema } from '@zenith/shared/payment';
import { SEED_MENUS } from '@zenith/shared/seed';
```

## `packages/analytics-sdk`

浏览器端 SDK，负责页面访问、行为事件、Web Vitals 与前端错误采集，上报到后端分析域。根 `npm run build` 会在 `web` 之前构建该包。

## `packages/electron`

Electron 桌面客户端：

- `src/main.ts`：窗口创建、外链打开、生命周期与 IPC 窗口控制
- `src/preload.ts`：通过 `contextBridge` 暴露受限 API
- `src/updater.ts`：连接服务端「应用版本管理」公开 API，支持 Web 热更新与壳全量更新
- `src/safe-unzip.ts`：热更包安全解压（替代存在越界写入漏洞的 extract-zip）
- `package.json` / `electron-builder.config.js`：打包配置与平台产物定义

## `docs`

| 目录 | 内容 |
| --- | --- |
| `guide/` | 快速开始、开发、结构、部署、Docker、PWA、Electron、Demo、维护 |
| `product/` | 产品概览与功能全景 |
| `backend/` | API、安全、数据库、任务中心、支付、Mastra 等后端专题 |
| `frontend/` | UI、认证、数据获取等前端专题 |
| `ai/` | AGENTS.md 与 Zenith Skill 协作说明 |
| 业务专题目录 | [平台基础能力](/platform/)、[文件与存储](/storage/)（`files` 路由领域）、[企业网盘](/drive/)，以及 `/rules/`、`/wiki/`、`/open-platform/`、`/workflow/`、`/payment/`、`/cms/` 等 |
| `changelog/` | 版本更新记录 |

## 分层原则

- `shared` 是契约底座，不依赖 `server` 或 `web`。
- `server` 是业务权威边界，负责认证授权、事务、任务、通知、CMS 渲染和外部集成。
- `web` 是交互边界，只通过 HTTP / WebSocket / SSE 与后端协作。
- `electron` 封装 Web 产物，不承载后端业务逻辑。
- Demo 模式通过 MSW 替换 API 边界，继续复用真实契约与 seed。
