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
- `src/middleware/`：认证、日志等中间件
- `src/lib/`：通用能力封装（文件存储、权限过滤、Redis 会话、定时调度、Excel 导出、验证码等）
- `drizzle/`：生成的迁移文件

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
