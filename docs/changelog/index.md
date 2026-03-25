# Changelog

> 按版本倒序记录 Zenith Admin 的功能更新与变更历史。

---

## v0.1.2 - 2026-03-25

### Added

#### 后端

- 集成 Swagger UI，新增两个无需认证的端点：
  - `GET /api/docs` — Swagger UI 交互界面
  - `GET /api/openapi.json` — OpenAPI 3.0 JSON Spec（可导入 Postman / Apifox）
- 新增 `packages/server/src/openapi.ts`，以 TypeScript 对象维护 OpenAPI 3.0 Spec，覆盖全部 API 分组

#### 操作日志

- 操作日志列表新增 **IP 地址**搜索筛选条件，支持模糊匹配

#### 文档站点

- 新增「Swagger / OpenAPI」章节，说明文档访问、鉴权、导入及 Spec 维护方式
- 新增「系统内置配置」章节，说明 5 个内置配置项的用途、类型、默认值及使用方式
- 新增「操作日志与变更记录」章节，说明 Diff 机制架构及如何为新路由添加变更快照
- 更新「Zenith Skill」章节，新增后端路由规范与前端页面规范说明

### Fixed

- 修复 CronJobsPage 使用不存在的 `Drawer` 组件导致的运行时错误（改为 `SideSheet`）
- 修复 CronJobsPage `cronExprValue` 和 `handlers` 状态变量未声明的运行时错误

---

## v0.1.1 - 2026-03-25

### Added

#### 通知管理

- 通知内容编辑器升级为富文本编辑器（基于 wangEditor），支持格式化文本与图片插入
- 富文本编辑器支持图片上传，通过 Authorization 头上传图片并自动插入到编辑器
- 通知列表支持 HTML 内容渲染（`dangerouslySetInnerHTML`），展示富文本内容
- 通知编辑界面改用 SideSheet 侧边抽屉，提升编辑体验
- 通知内容字段类型从 `varchar` 升级为 `text`，支持长文本存储
- 通知管理添加批量删除功能，后端新增 `DELETE /api/notices/batch` 接口

#### 组件与前端

- 新增省市区三级联动选择组件（`RegionSelect`），基于 Semi Design Cascader 封装，支持动态加载
- 组件示例页面新增省市区联动选择演示

### Changed

- WebSocket 连接管理优化：添加自动重连机制，使用 Map 记录最近通知时间戳，避免重复推送通知
- 岗位管理添加批量删除功能，后端新增 `DELETE /api/positions/batch` 接口

### Fixed

- 修复个人资料页密码更新接口路径错误（`/auth/password` → `/api/auth/password`）
- 修复超级管理员和普通用户角色的数据范围字段缺失问题

### Docs

- 重构部署文档，新增贡献指南与维护说明
- 更新首页文档，补充 Semi Design v2 和 lucide-react 技术栈说明

---

## v0.1.0 - 2026-03-25

首个正式版本，包含完整的后台管理基础框架。

### Added

#### 认证与账户

- 用户登录 / 登出，JWT Bearer Token 鉴权（7 天有效期）
- Access Token + Refresh Token 自动续期机制
- 登录验证码校验，降低暴力尝试风险
- 个人中心：基本资料维护、头像上传、密码修改

#### 权限体系

- 用户管理：用户 CRUD、启停用、角色分配
- 角色管理：角色 CRUD、菜单权限配置
- 菜单管理：目录 / 菜单 / 按钮三级能力模型
- 动态菜单路由：前端根据当前用户角色自动注册可访问页面

#### 组织与基础资料

- 部门管理：树形组织层级维护
- 岗位管理：岗位信息维护
- 数据字典：字典类型与字典项统一管理
- 系统配置：系统运行相关配置项维护

#### 通知、审计与安全

- 通知公告：发布、查看、已读状态管理，WebSocket 实时推送
- 登录日志：登录行为记录与安全审计
- 操作日志：关键业务操作轨迹记录
- 在线会话：查看当前在线会话，支持强制下线

#### 文件与存储

- 文件管理：上传、列表查询、下载等基础能力
- 存储配置：本地文件系统 / 阿里云 OSS 双模式，支持切换默认存储

#### 任务与运维

- 定时任务：Cron 任务管理与服务端调度执行
- 系统监控：运行状态相关信息查看
- WebSocket：支持实时通知与会话下线消息推送
- 健康检查：`/api/health` 接口，用于服务探活

#### 基础设施与工程

- npm monorepo 结构（`server` / `web` / `shared` 三包）
- Redis 会话持久化（ioredis），支持 URL 与逐项两种配置方式
- Drizzle ORM + PostgreSQL，迁移文件版本化管理
- Demo 演示模式（MSW Mock Service Worker），无需后端即可完整运行
- VitePress 文档站，自动部署到 GitHub Pages
- GitHub Actions Release 工作流：推送 tag 自动构建并发布产物
- AI 友好：`AGENTS.md` + Zenith CRUD Skill，支持 AI 辅助开发
