# 项目结构

Zenith Admin 采用 npm monorepo 结构，核心目录如下：

```text
zenith-admin/
├── docs/                 # VitePress 文档站
├── packages/
│   ├── server/           # Hono 后端服务
│   ├── shared/           # 共享类型、常量、Zod schema
│   └── web/              # React 管理后台
├── package.json          # 根脚本与工作区配置
└── README.md
```

## `packages/server`

后端基于 **Hono v4**，通过 `@hono/node-server` 在 Node.js 中运行。

关注这些目录：

- `src/routes/`：API 路由（认证、用户、部门、岗位、角色、菜单、字典、通知、日志、监控、会话、定时任务等）
- `src/db/`：Drizzle schema、迁移与 seed
- `src/middleware/`：认证（`auth.ts`）、IP 访问控制（`ip-access.ts`）、权限守卫（`guard.ts`）、请求日志（`logger.ts`）
- `src/lib/`：通用能力封装，详见下方列表
- `drizzle/`：生成的迁移文件

`src/lib/` 主要模块：

| 文件 | 说明 |
|------|------|
| `session-manager.ts` | Redis 会话管理（在线会话 + 黑名单）|
| `redis.ts` | ioredis 客户端单例与工具 |
| `oauth/` | OAuth 提供方抽象（GitHub / 钉钉 / 企业微信）|
| `cron-scheduler.ts` | 定时任务调度器（基于 node-cron）|
| `db-backup.ts` | 基于 pg_dump 的数据库备份 |
| `file-storage.ts` | 文件存储抽象（本地 / 阿里云 OSS）|
| `email.ts` | SMTP 邮件发送 |
| `password-policy.ts` | 密码复杂度校验与过期策略 |
| `system-config.ts` | 系统配置读取封装 |
| `tenant.ts` | 多租户数据隔离工具 |
| `data-scope.ts` | 数据权限过滤（全部 / 部门 / 本人）|
| `permissions.ts` | 菜单与按钮权限判断 |
| `excel-export.ts` | Excel 导出工具 |
| `captcha.ts` | 图形验证码生成 |
| `sanitize.ts` | XSS 输入清洗 |
| `ws-manager.ts` | WebSocket 连接管理 |
| `logger.ts` | 日志工具（基于 pino）|

## `packages/web`

前端基于 **React 19 + Vite + Semi Design**。

关注这些目录：

- `src/pages/`：页面级组件
- `src/layouts/`：后台主布局
- `src/components/`：公共组件
- `src/hooks/`：认证、主题等逻辑
- `src/utils/`：请求封装、日期处理等工具

## `packages/shared`

共享层用于减少前后端重复定义：

- `types.ts`：实体类型、分页类型、接口响应类型
- `validation.ts`：Zod 校验 schema
- `constants.ts`：常量与枚举

## `docs`

文档站使用 **VitePress** 构建，当前按以下思路组织：

- `index.md`：Landing Page
- `guide/`：快速开始、开发、结构、部署
- `product/`：产品概览与功能模块
- `backend/`：接口规范、数据库说明
- `frontend/`：UI 规范、认证与请求
- `ai/`：AI 开发辅助说明（AGENTS.md 、Zenith Skill）
- `changelog/`：版本更新历史

## 为什么这样分层

这样的结构适合后台项目长期演进：

- **业务边界清晰**：前后端职责明确
- **复用成本低**：共享类型和校验只维护一份
- **协作效率高**：文档、代码、脚本都在根仓库统一管理
