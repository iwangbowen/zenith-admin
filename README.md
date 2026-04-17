# Zenith Admin

[![Version](https://img.shields.io/github/v/tag/iwangbowen/zenith-admin?label=version&color=blue)](https://github.com/iwangbowen/zenith-admin/releases)
[![Pages](https://github.com/iwangbowen/zenith-admin/actions/workflows/pages.yml/badge.svg)](https://github.com/iwangbowen/zenith-admin/actions/workflows/pages.yml)
[![Release](https://github.com/iwangbowen/zenith-admin/actions/workflows/release.yml/badge.svg)](https://github.com/iwangbowen/zenith-admin/actions/workflows/release.yml)
[![License](https://img.shields.io/github/license/iwangbowen/zenith-admin)](./LICENSE)

基于 **Hono v4 + React 19 + Semi Design v2 + Drizzle ORM** 的全栈后台管理系统。涵盖认证授权、组织架构、权限控制、系统配置、通知公告、日志审计、在线会话、定时任务、文件管理、缓存管理、工作流引擎、AI 对话、运行监控等完整后台场景，并内置可选的**多租户（Multi-Tenant）**支持。

项目采用 **npm monorepo** 结构：后端使用 Hono + PostgreSQL 提供 RESTful API，前端使用 React 19 + Vite + Semi Design v2 构建界面，`shared` 包统一维护前后端共享类型、常量与 Zod 校验 schema。

---

## 文档与演示

| | 地址 |
| --- | --- |
| 文档站 | <https://iwangbowen.github.io/zenith-admin/> |
| 演示站 | <https://iwangbowen.github.io/zenith-admin/demo/>（账号 `admin` / 密码 `123456`，无需后端） |

---

## 技术栈

| 层级 | 技术 |
| ---- | ---- |
| 后端框架 | [Hono](https://hono.dev/) v4 + Node.js |
| 前端框架 | [React](https://react.dev/) 19 + [Vite](https://vitejs.dev/) 6 |
| UI 组件库 | [Semi Design](https://semi.design/) v2 |
| 图标体系 | [lucide-react](https://lucide.dev/) |
| 数据库 ORM | [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL |
| 会话持久化 | [Redis](https://redis.io/)（ioredis） |
| 前端路由 | [React Router](https://reactrouter.com/) v7 |
| 参数验证 | [Zod](https://zod.dev/)（前后端共享） |
| 认证方案 | JWT Bearer Token + Refresh Token 自动续期 |
| 实时通信 | WebSocket |
| 文件存储 | 本地存储 / 阿里云 OSS / 腾讯云 COS / S3 兼容存储 |
| 包管理器 | npm（monorepo） |

---

## 功能模块

### 认证与账户安全

- **登录注册**：支持账号密码登录、图形验证码校验、注册开关全局控制
- **OAuth 第三方登录**：支持 GitHub、钉钉、企业微信一键登录与账号绑定
- **JWT 鉴权**：Access Token + Refresh Token 双 Token 机制，自动静默续期
- **密码策略**：复杂度规则（最小长度、大写字母、特殊字符）+ 密码过期强制修改
- **登录安全**：登录失败次数限制 + 账号自动锁定（基于 Redis 计数），管理员可解锁
- **API Token**：个人 API Token 创建与管理，用于第三方接口调用鉴权

### 权限与组织架构

- **用户管理**：CRUD、启停用、角色/部门/岗位分配、批量操作、Excel 批量导入（含模板下载）、管理员重置密码
- **角色管理**：CRUD、菜单权限树形分配
- **菜单管理**：目录 / 菜单 / 按钮三级能力模型，树形维护，支持全部展开/折叠
- **动态菜单路由**：前端根据用户角色自动注册可访问页面，实现路由级权限隔离
- **按钮级权限**：基于 `usePermission` Hook 的细粒度前端编程式权限控制
- **部门管理**：树形组织层级维护
- **岗位管理**：岗位信息维护与用户关联

### 系统配置与安全

- **系统配置**：验证码开关、密码策略、注册控制、登录失败锁定等核心行为动态配置
- **IP 访问控制**：白名单/黑名单双模式，支持 CIDR 网段，配置热更新缓存
- **邮件配置**：SMTP 服务器配置（主机、端口、加密方式）+ 发送测试
- **OAuth 配置**：第三方登录 Client ID/Secret 管理与开关控制
- **数据字典**：字典类型与字典项统一管理，前后端共用

### 通知与消息

- **通知公告**：富文本（wangEditor）编辑、发布/草稿状态控制、已读记录管理、批量操作
- **实时推送**：基于 WebSocket 的新通知实时推送，前端自动重连（指数退避）
- **通知中心**：用户收件箱、支持全部标记已读
- **消息模板**：邮件 / 短信 / 站内通知三类模板管理，支持变量占位符与启停控制

### 日志与审计

- **登录日志**：记录登录行为（IP、浏览器、地理位置、状态），支持全局与个人视图
- **操作日志**：记录关键业务操作轨迹，支持变更前后字段 Diff 对比
- **在线会话**：查看当前所有在线会话（Redis 持久化），支持强制下线并实时推送退出消息

### 文件与存储

- **文件管理**：文件上传、列表查询、下载、删除等基础能力
- **多存储后端**：支持本地文件系统、阿里云 OSS、腾讯云 COS、S3 兼容存储
- **默认存储切换**：通过存储配置页面一键切换当前默认存储策略

### 任务与运行维护

- **定时任务**：Cron 任务 CRUD、可视化 Cron 表达式构建器、手动立即执行、启停控制、执行历史日志
- **数据库备份**：基于 pg_dump 的手动备份，支持下载与删除，可结合定时任务自动化
- **缓存管理**：Redis 缓存可视化查看、按 Key 模式搜索、分类展示、支持单条/批量删除
- **系统监控**：服务器实时状态（CPU、内存、Node.js 版本、运行时长等）
- **健康检查**：`GET /api/health` 接口，用于 Docker / K8s 服务探活

### 工作流引擎（实验性）

- **流程定义**：工作流 CRUD、草稿/发布/禁用状态管理
- **可视化设计器**：基于节点的流程图设计器，支持条件分支配置
- **流程实例**：流程发起、运行状态跟踪、流程监控

### AI 对话

- **AI 聊天界面**：基于 Semi Design AIChatDialogue 组件的完整聊天界面
- **多会话管理**：侧边栏会话列表，支持多轮对话切换与历史记录
- **模型配置**：支持多语言切换（中文/英文/日文）与响应风格配置

### 个人中心

- **基本信息**：修改头像、昵称、手机、邮箱等个人资料
- **修改密码**：验证旧密码后更新
- **关联账号**：查看已绑定的第三方 OAuth 账号，支持解绑
- **API Token**：个人 Token 自助管理
- **登录记录** / **操作记录**：查看本账号历史行为日志

### 多租户（可选）

- **租户管理**：CRUD、状态管理、有效期控制、最大用户数限制，仅平台超管可操作
- **数据隔离**：开启后各业务表自动按 `tenant_id` 隔离，删除租户时级联清理
- **视角切换**：平台超管可在顶栏一键切换至任意租户视角进行排查
- **单租户兼容**：默认关闭，关闭时与普通单实例部署完全兼容

> 通过 `MULTI_TENANT_MODE=true`（后端）+ `VITE_MULTI_TENANT_MODE=true`（前端）开启，详见[多租户指南](https://iwangbowen.github.io/zenith-admin/backend/multi-tenant)。

### 基础数据

- **行政区划**：国家级 → 省 → 市 → 区 → 街道 五级查询，`RegionSelect` 组件支持级联懒加载
- **仪表盘**：用户总数、在线人数、今日登录/操作次数统计卡片 + 通知公告摘要

### 开发工具

- **Swagger UI**：内置 `/api/docs` 在线接口文档，支持 Bearer Token 授权调试
- **OpenAPI JSON**：`/api/openapi.json` 可直接导入 Postman / Apifox
- **Demo 模式**：`VITE_DEMO_MODE=true` 开启 MSW Mock，无需后端即可完整预览所有页面

---

## 原生 AI 友好

Zenith Admin 专为 AI 辅助开发场景设计，让 GitHub Copilot、Claude、Cursor 等工具在生成代码时能精准理解项目约定。

| 文件 / 目录 | 用途 |
| --- | --- |
| [`AGENTS.md`](./AGENTS.md) | AI 工具的"项目说明书"，包含架构约定、常用命令与注意事项 |
| [`.claude/skills/zenith/`](./.claude/skills/zenith/) | Zenith CRUD Skill：完整的模块开发工作流，一句话触发全流程自动化生成 |

在支持 Skills 的 AI 工具中描述需求，即可自动完成 **Schema → 迁移 → 类型 → 路由 → 前端页面 → Mock 数据** 的端到端生成。详见文档站：[AI 辅助开发](https://iwangbowen.github.io/zenith-admin/ai/)。

---

## 快速开始

**前置条件**：Node.js >= 18、PostgreSQL、Redis

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在 `packages/server/` 目录下创建 `.env` 文件（参考 `packages/server/.env.example`），最小配置如下：

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zenith_admin
JWT_SECRET=your-secret-key
REDIS_URL=redis://127.0.0.1:6379
```

前端默认请求 `http://localhost:3300`，如需修改，在 `packages/web/` 下创建 `.env` 并设置 `VITE_API_BASE_URL`。

### 3. 初始化数据库

```bash
npm run db:migrate   # 执行数据库迁移
npm run db:seed      # 填充初始数据（创建默认 admin 账号）
```

### 4. 启动开发服务器

```bash
npm run dev            # 同时启动前端 + 后端（推荐）

npm run dev:server     # 仅启动后端，地址：http://localhost:3300
npm run dev:web        # 仅启动前端，地址：http://localhost:5373
```

默认账号：`admin` / 密码：`123456`

### 5. 生产构建

```bash
npm run build          # 顺序构建：shared → server → web
```

构建产物：后端 `packages/server/dist/`，前端 `packages/web/dist/`。

> 完整部署说明（Docker、Nginx 反代等）参见文档站：[快速开始](https://iwangbowen.github.io/zenith-admin/guide/getting-started)。

---

## License

本项目采用 [MIT License](./LICENSE)。
