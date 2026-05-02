# Changelog

> 按版本倒序记录 Zenith Admin 的功能更新与变更历史。

---

## v0.12.0 - 2026-05-02

### Added

#### 在线会话管理增强

- 在线用户列表标识当前浏览器会话（蓝色「当前会话」Tag），精确到 JWT tokenId 级别
- 强制下线新增模式选择弹窗：「仅下线此会话」或「下线该用户全部会话」
- 新增 `DELETE /api/sessions/user/{id}` 接口，支持一键踢出指定用户的所有在线会话

#### 文件管理增强

- 新增文件网格视图，支持图片预览、文件卡片交互
- 文件网格视图支持全选当前页、批量操作
- 新增文件操作下拉菜单（下载、详情、复制链接、删除）
- 新增批量下载功能（使用 fflate 打包为 zip）
- 新增文件类型筛选

#### 登录页面

- 实现登录重定向功能，未登录时保存来源路径，登录后自动跳回

### Fixed

- 修复 WebSocket 强制下线只踢出单个 session 而影响同用户其他连接的问题（改用 tokenId 精确管理）
- 修复用户管理选中行键类型转换问题
- 修复文件管理操作下拉菜单路由顺序问题

---

## v0.11.0 - 2026-04-30

### Added

#### 监控模块 SSE 实时推送

- 实现 SSE 差量推送机制，仅传输变化的指标数据，减少带宽占用
- 新增连接状态指示灯（连接中 / 已连接 / 断开），支持脉冲动画效果提升用户体验
- 监控页面新增趋势折线图（CPU、内存、网络），可视化历史指标变化
- 新增慢查询与慢日志展示表格

#### 文件管理增强

- 支持多文件同时上传，新增单文件上传 API 接口
- 新增批量删除文件功能，支持勾选后一键删除
- 根据文件类型动态渲染对应图标（图片、文档、压缩包等）
- 新增文件大小格式化工具函数（`formatFileSize`）
- 文件名称支持悬浮 Tooltip 提示，防止长名称截断无法识别

#### 登录页面优化

- 全面重构登录页视觉风格，更新背景色、Eyebrow 徽标、特性标签展示区域
- 调整底部间距与标题样式，提升整体美观度

### Changed

- 登录速率限制从「15 分钟内最多 10 次」调整为「3 分钟内最多 20 次」，优化登录频率控制策略
- 修正文件 URL 拼接逻辑，确保本地存储与对象存储场景下 URL 均正确生成

---

## v0.10.0 - 2026-04-30

### Added

#### 主题管理

- 新增 `ThemeProvider` 组件，支持「亮色 / 暗色 / 跟随系统」三种主题模式的切换与持久化
- 主题模式与主题色偏好存储于用户偏好，刷新后自动恢复
- 富文本编辑器新增暗色模式适配样式（`RichTextEditor.css`）

#### 审批时间线组件

- 将审批时间线逻辑提取为独立组件 `ApprovalTimeline`，在「我的申请」「工作流监控」「待我审批」三个页面中复用

### Changed

#### 错误处理统一

- 将 `AppError` 自定义错误类替换为 Hono 原生 `HTTPException`，统一全局错误处理链路，减少依赖层次

#### 分页规范完善

- SQL-builder 分页统一使用 `withPagination(query.$dynamic(), page, pageSize)`
- RQB 分页统一使用 `pageOffset(page, pageSize)`，全库完成迁移

#### 审计日志请求体解析

- 重构 `setAuditBeforeData` 函数，新增 `resolveAuditRequestBody` 以正确处理 multipart/JSON 等不同请求体格式

### Fixed

#### 客户端真实 IP 获取

- 修正 `getClientIP` 逻辑：优先读取 `x-forwarded-for` / `x-real-ip` 头，无反代时回退到 `getConnInfo` 获取直连 IP，解决反代场景下 IP 记录错误问题

#### 压缩中间件误压缩流式响应

- SSE 实时推送和文件下载等路由不再经过 `compress` 中间件，修复 SSE 事件流被截断的问题

#### SideSheet 内表格样式

- 修正侧边抽屉 `SideSheet` 内表格行/表头背景色，使用半透明背景色适配抽屉层级

#### 地区管理表格

- 启用虚拟滚动（`virtualized`）并设置垂直滚动高度，解决大量地区数据渲染卡顿问题

#### 工作流实例关键词搜索

- 工作流实例关键词过滤使用 `escapeLike` 转义，防止 SQL 通配符注入

---

## v0.9.0 - 2026-04-26

### Added

#### 操作日志前态快照（beforeData）

- 为所有主要业务模块的修改/删除操作补全 `beforeData` 快照注入，覆盖 20+ 路由文件中的 53 个审计操作点
- 新增 `getXxxBeforeAudit()` 辅助函数到所有 service 文件（users、roles、menus、departments、positions、dicts、notices、cron-jobs、system-configs、regions、message-templates、file-storage-configs、workflow-definitions、email-config、tenants、oauth-config、cache、sessions、files、db-backups、workflow-instances），使操作日志详情页的数据变更 diff 功能完整生效
- 敏感字段自动脱敏：`emailConfig.smtpPassword` 和 `oauthConfig.clientSecret` 在快照中替换为 `******`

#### 操作日志详情页增强

- 操作日志详情弹窗新增标签页布局，分为「基础信息」「请求详情」「数据变更」三个标签页，提升可读性

#### 日志文件关键词搜索

- 日志文件内容支持关键词过滤，前端和后端 API 同步支持 `keyword` 参数

### Fixed

#### 审计日志日期格式不一致

- 修复 `beforeData` 显示 ISO 8601 格式（`2026-04-25T10:00:00.000Z`）而 `afterData` 显示 `YYYY-MM-DD HH:mm:ss` 的不一致问题，所有快照现在统一通过 `mapXxx()` 格式化

#### LIKE 通配符注入防护

- 所有 `keyword` 模糊搜索参数通过 `escapeLike()` helper 转义 `%`/`_`，防止恶意 LIKE 注入

#### 跨租户数据泄露

- 修复 dicts、files、departments、importUsers、operation-logs 模块的跨租户过滤缺失问题

### Changed

#### 工作流实例状态值统一

- 工作流实例相关状态值从 `active` 统一改为 `enabled`，与系统其他模块状态枚举保持一致

---

## v0.8.0 - 2026-04-25

### Added

#### 区域选择缓存

- `RegionSelect` 组件新增缓存层（`RegionSelect.cache.ts`），区域数据首次加载后缓存，避免重复请求

#### Excel 导出

- 新增 `okExcel` / `excelBody` 响应辅助函数，多个模块支持导出 Excel 文件，日期时间统一使用 `dayjs` 格式化

### Changed

#### 时间格式规范统一

- 系统内所有日期时间字符串统一为 `YYYY-MM-DD HH:mm:ss` 格式
- 前端新增 `formatDateTime` / `formatDateTimeForApi` / `formatDateForApi` 工具函数（`packages/web/src/utils/date.ts`）
- 后端新增 `formatDateTime` / `formatNullableDateTime` / `formatDate` / `formatFileTimestamp` / `parseDateTimeInput` 等工具函数（`packages/server/src/lib/datetime.ts`）
- 禁止在业务代码中直接调用 `toISOString()` 等原生时间格式化方法

#### 响应体构造规范

- 统一使用 `okBody(data, msg?)` / `errBody(msg, code?)` 构造响应体，废弃内联字面量对象写法
- 所有路由文件完成规范迁移

#### 请求工具优化

- 下载文件错误处理增强，新增网络请求失败提示，401 状态自动尝试刷新 token

#### 监控页面

- Redis 命令总执行数使用 `Intl.NumberFormat` 格式化，符合中文数字展示习惯
- 修正进度条颜色样式选择器

### Fixed

- 修复 SonarLint 安全告警
- 修复用户管理中角色/岗位编码映射的空值安全问题
- 修复历史遗留测试失败（data-scope / auth / system-config）
- 修复工作流设计器高级设置面板重构后的编译错误

---

## v0.7.0 - 2026-04-24

### Added

#### Service 层全量提取

- 后端所有路由（21 个业务模块）完成 Service 层提取，业务逻辑从 route handler 迁移至 `packages/server/src/services/` 下独立的 `xxx.service.ts` 文件
- 新增 `AppError`（`packages/server/src/lib/errors.ts`），由全局 `onError` 统一转为标准 JSON 错误响应，route handler 不再需要手动捕获业务错误
- 数据映射函数统一以 `mapXxx` 命名（纯函数），前置校验函数统一以 `ensureXxx` 命名（抛 `AppError`）

#### 日志文件管理

- 新增「日志文件」页面（系统管理菜单下），支持日志文件列表、内容读取（最后 N 行）、实时追踪（SSE）、下载及删除
- 后端新增 `/api/log-files` 路由，含路径穿越安全防护
- 支持 `.log` 与 `.log.gz` 压缩日志文件的读取

#### 菜单搜索

- 顶部 Header 新增菜单搜索框，支持按菜单名称或面包屑路径模糊搜索，选中后自动跳转
- 偏好设置新增「显示菜单搜索框」和「显示全屏按钮」开关，可按需隐藏

### Changed

#### UI 规范统一

- 所有列表页面的状态列移至操作列左侧并设为固定列（`fixed: 'right'`），涉及：用户管理、部门管理、岗位管理、菜单管理、角色管理、字典管理、地区管理、文件存储配置、工作流、定时任务、数据库备份、消息模板、租户管理等 10+ 个页面

---

## v0.6.0 - 2026-04-23

### Added

#### 可观测性支持（OpenTelemetry + Prometheus）

- 集成 OpenTelemetry SDK，支持分布式追踪（通过环境变量 `OTEL_*` 配置）
- 集成 Prometheus 指标暴露，新增 `/metrics` 端点
- 更新 API 文档，补充健康检查与指标端点说明

### Changed

#### 数据库查询规范化

- 分页列表的 `total` 与 `list` 统一使用 `Promise.all` 并行执行，禁止串行 `await`
- 计数查询统一使用 `db.$count(table, where)` 工具方法，覆盖仪表盘统计、定时任务、通知、消息模板、角色管理等多个路由
- 新增 `pageOffset(page, pageSize)` 工具函数（`src/lib/pagination.ts`），统一分页偏移量计算，禁止手写 `(page - 1) * pageSize`
- `updatedAt` 字段通过 `.$onUpdate(() => new Date())` 自动维护，`db.update().set()` 中禁止手动传入 `updatedAt`

#### 关联查询优化

- 推荐使用 Drizzle RQB（`db.query.*`）替代手写 `LEFT JOIN`，用户角色查询、用户管理等路由已迁移

#### 事务原子性增强

- 通知接收者保存、角色菜单分配、角色用户分配、API Token 相关多步写操作统一使用 `db.transaction()` 确保原子性

---

## v0.5.0 - 2026-04-22

### Added

#### 实体 DTO 中心化架构

- 所有响应实体 DTO 按业务域拆分至 `packages/server/src/lib/dtos/`（`iam` / `auth` / `dict` / `files` / `logs` / `notices` / `system` / `workflow` / `dashboard` / `region` / `messages`）
- 通过 `src/lib/openapi-dtos.ts` 统一 re-export，各路由通过 `import { XxxDTO } from '../lib/openapi-dtos'` 导入，禁止路由内本地声明 `.openapi('EntityName')` 的 DTO

#### 统一路由定义模式

- 全面迁移至 `defineOpenAPIRoute` + `router.openapiRoutes()` 模式
- 移除 `<AuthEnv>` 泛型和全局 `router.use('*', authMiddleware)`，每个受保护路由在 `createRoute.middleware` 中显式声明鉴权
- 覆盖用户、角色、工作流实例/定义、会话管理、租户管理等核心路由

#### 统一验证失败响应（validationHook）

- 新增 `validationHook`，所有 `OpenAPIHono` 实例通过 `defaultHook: validationHook` 将 Zod 校验失败统一转为 `{ code: 400, message, data: null }` 标准格式

#### 安全防护增强

- 新增 CSRF 防护（`hono/csrf`）：通过 `ALLOWED_ORIGINS` 环境变量配置白名单
- 新增接口限流（`hono-rate-limiter` + Redis）：对高危认证接口限制请求频率，超限返回 `code: 429`

#### OpenAPI 文档升级至 3.1.0

- 使用 `app.doc31` 替代 `app.doc`，输出 OpenAPI 3.1.0 规范

#### 全量数据接口

- 用户、岗位、角色模块新增 `/get/all` 接口，支持不分页的全量数据获取

#### 服务端分页扩展

- 字典、角色、文件存储配置、操作日志、岗位、会话列表等模块支持服务端分页
- 前端对应页面新增 `pageSize` 状态，支持用户动态调整每页条目数

### Changed

- 共享层 `@zenith/shared` 升级至 Zod v4（`^4.3.6`），与 `@hono/zod-openapi@1.x` 保持一致
- 认证中间件重构：使用 Hono 官方 JWT 中间件替代自定义 JWT 验证逻辑
- 上下文管理优化：使用 `tryGetContext` 替代 `getCtx`，简化错误处理
- 路由中间件统一改用 `hono/factory` 的 `createMiddleware`

### Fixed

- 修复通知模块发布时间（`publishTime`）字段类型验证逻辑
- 修复文件存储配置更新时合并逻辑，确保状态字段正确保留
- 修复数据库备份时间戳格式化（冒号/点号替换）导致的文件名错误
- 修复邮件配置测试发送时的邮箱与 SMTP 信息校验条件

---

## v0.4.0 - 2026-04-22

### Added

#### OpenAPI 自动生成支持

- 全面迁移后端路由至 `@hono/zod-openapi`（`OpenAPIHono`），路由定义自动汇总生成 OpenAPI Spec
- 所有请求参数通过 `createRoute` + Zod schema 声明，支持请求验证与响应格式化
- 涵盖路由管理、工作流实例、缓存管理等模块的 OpenAPIHono 重构

#### 全局请求上下文存储

- 引入 `hono/context-storage` 中间件，提供 `currentUser()` / `getCtx()` 零参取值函数
- 辅助函数无需层层透传 `c` 参数，简化请求上下文访问

#### 请求防护

- 新增请求体大小限制（`REQUEST_BODY_LIMIT`）和请求超时（`REQUEST_TIMEOUT_MS`）环境变量配置
- 默认不启用，超出限制分别返回 `code: 413` / `code: 408`

#### 性能分析

- 新增 `Server-Timing` 响应头支持，可通过环境变量 `ENABLE_SERVER_TIMING` 开启

### Changed

- 切换 JWT 实现为 Hono 官方库（`hono/jwt`），移除 `jsonwebtoken` 依赖
- 参数校验统一改用 `zValidate` 中间件（`@hono/zod-validator`），覆盖用户、角色、通知、OAuth、岗位、地区、系统配置、租户、工作流等模块
- 日志中间件重构：替换自定义 `httpLogger` 为 Hono 官方 `logger`，并去除日志中的 ANSI 控制字符

---

## v0.3.2 - 2026-04-21

### Added

#### 菜单管理

- 搜索栏新增「菜单名称」文本筛选与「状态」下拉筛选，支持客户端递归过滤树形数据

#### 字典管理

- 搜索栏新增「状态」下拉筛选和「创建时间」日期范围筛选
- 字典列表新增「描述」列
- 字典项侧边抽屉加宽（700 → 900），顶部新增标签/键值文本搜索与状态下拉筛选（客户端实时过滤）

---

## v0.3.1 - 2026-05-03

### Added

#### 定时任务增强

- 定时任务配置新增「重试次数」「重试间隔（ms）」「监控超时时间（ms）」字段，支持任务失败后自动重试
- 执行日志新增「第几次执行」列，记录每次触发的累计执行次数
- 执行日志抽屉加宽，输出列固定宽度，内容不再被挤压

### Changed

- 登录页表单输入框去掉标签，改为纯 placeholder 风格，界面更简洁
- 定时任务列表「上次执行」状态由英文（success/fail/running）改为中文显示（成功/失败/运行中）
- 定时任务列表描述列固定宽度 200px，避免过窄

### Fixed

- 修复手动创建 Drizzle 迁移文件不注册到 journal 导致迁移不执行的问题

---

## v0.3.0 - 2026-04-20

### Added

#### 工作流模块

- 新增工作流设计器：基于 React Flow 的可视化流程图设计，支持节点拖拽、连接与属性配置
- 新增多种节点类型：发起人节点、审批节点、抄送节点、分支条件节点，配置各节点的审批人策略、超时处理、拒绝策略等高级设置
- 新增表单权限与操作权限配置：流程节点可独立配置字段可见性与按钮权限
- 新增飞书风格审批时间线组件，替代原 Steps 展示审批记录
- 新增「我的申请」页面：用户可发起流程申请，查看申请列表与审批详情
- 新增「待审批」页面：展示待办任务，支持审批通过/驳回并填写意见
- 新增全局流程监控页面（管理员视角）：查看所有流程实例状态及统计信息

#### AI 助手

- 新增 AI 智能助手功能，包含独立对话页面（AIChatPage）与侧边栏入口（AISidebarPage）
- 支持富文本消息内容、演示模式切换及 MCP 工具配置

#### 用户管理增强

- 用户表新增手机号码字段，支持手机号的录入、展示与搜索过滤
- 列表页左侧新增部门树面板，可点击部门节点快速筛选该部门下的用户

#### 消息模板

- 新增消息模板管理模块：支持模板的增删改查与内容预览

#### 定时任务

- 定时任务列表新增「执行日志」入口，支持以抽屉形式查看全部执行记录

#### 表单设计器

- 新增分栏（row）、分割线（divider）、分组（group）三种布局类型字段

#### 测试覆盖

- 新增多模块单元测试：权限管理、数据范围、认证中间件、认证 Hook、权限 Hook、密码策略、工作流引擎、区域选择组件等

### Changed

#### 搜索工具栏重构

- `SearchToolbar` 组件 API 简化：移除 `left`/`right` 独立区域概念，统一使用 `children` 作为工具栏内容，由 `<Space wrap>` 自动换行排列
- 全站所有列表页同步更新为新 API，搜索输入框与操作按钮统一放置在同一行

#### 表单体验优化

- 批量为各模块表单的 Select / Input 补充 `placeholder`，提升空状态引导体验
- 用户、部门管理的新增/编辑弹窗改为 Row/Col 双列布局，节省垂直空间

#### 其他

- 仪表盘新增骨架屏（Skeleton）替换原 Spin，消除空白加载态
- 侧边栏与卡片样式改用 CSS 变量，提升主题切换一致性
- 标签（Tab）支持拖拽排序

### Fixed

- 修复仪表盘饼图标签显示异常（名称与百分比渲染错误）
- 修复文件存储配置页面提供者标签颜色映射错误
- 修复用户编辑接口中日期字段格式化与头像字段处理逻辑

---

## v0.2.0 - 2026-03-31

### Added

#### 安全与访问控制

- 新增忘记密码功能：用户可通过邮件找回密码，后端生成带时效重置 Token 并发送重置邮件
- 新增 IP 访问控制：支持配置 IP 白名单与黑名单，中间件自动拦截非法请求

#### 水印功能

- 新增页面水印功能，企业后台防截图泄漏
- 水印作为系统配置项管理（`watermark_enabled`/`watermark_content`/`watermark_font_size`/`watermark_opacity`），默认关闭
- 水印内容留空时自动回退为当前登录用户的 nickname/username

#### 文件存储扩展

- 文件存储支持扩展至三种模式：本地（local）、阿里云 OSS、**AWS S3**、**腾讯云 COS**
- 更新数据库结构，新增 `provider` 枚举字段及相关配置字段

#### 通知公告增强

- 新增通知收件人机制：发布通知时可指定目标类型（全体/指定用户/指定角色/指定部门）
- 新增已读统计功能（管理员视角）：列表页展示已读人数，点击可查看详细已读/未读用户列表
- 通知详情弹窗：通知列表与铃铛入口均支持点击查看完整内容
- 通知内容展示安全优化：新增 `stripHtml` 处理，列表预览不再 `dangerouslySetInnerHTML`

#### 仪表盘图表

- 仪表盘新增三类统计图表：登录趋势折线图、操作类型分布饼图、用户活跃度排行图

#### 缓存管理

- 新增缓存管理页面，支持查看全部缓存键值、按分类删除缓存、一键清空所有缓存

#### 监控页面优化

- 系统监控页面重构为 Tabs 标签页布局，分类展示 CPU/内存/磁盘/进程等信息
- 加载阶段使用 Skeleton 骨架屏替换 Spin，提升视觉体验

#### 文档完善

- 新增多篇技术文档：定时任务与数据库备份、OAuth 第三方登录、安全体系、公共组件指南、前端路由与菜单、演示模式、项目结构等

### Changed

- 登录页视觉优化：调整品牌区背景与装饰元素，功能特性列表展示更清晰
- 系统配置种子数据写入改为幂等逻辑（先查询现有 key，仅插入缺失项，避免重复执行报错）
- 多租户模式下密码重置与用户查询逻辑优化，确保租户隔离正确性

### Fixed

- 修复系统配置中 IP 白名单/黑名单配置项结构冗余问题，简化配置管理逻辑

---

## v0.1.5 - 2026-03-27

### Added

#### 多租户支持

- 新增多租户架构支持（`MULTI_TENANT_MODE=true`），实现租户数据隔离（`tenant_id` 字段 + `tenantCondition` 查询工具函数）
- 新增租户管理 CRUD 页面（`/system/tenants`），支持租户的增删改查
- 支持超管切换租户视角，切换后系统自动过滤对应租户数据
- 新增多租户部署指南文档

#### 个人中心

- 新增 API Token 管理 Tab：支持创建、查看、删除个人 API Token，用于第三方接口调用鉴权

#### 布局与交互

- 顶部工具栏新增全屏切换按钮，支持一键全屏
- 新增面包屑导航，显示当前页面层级路径（位于标签栏下方）
- 偏好设置新增主题色选择器和标签页切换动画开关

#### 菜单管理

- 新增「全部展开 / 全部折叠」按钮，方便快速浏览多层级菜单树

#### 地区管理

- 省市选择升级为级联选择器（Cascader），交互更直观

#### 系统配置

- 新增配置类型字典（`system_config_type`），列表页支持按类型筛选配置项
- 系统管理菜单拆分为「系统管理」和「系统设置」两个独立一级菜单

#### 搜索工具栏组件

- 新增 `SearchToolbar` 公共组件，统一搜索区域布局（左侧搜索条件、右侧操作按钮），全站 CRUD 列表页面全面迁移使用

### Changed

- 路由加载方式升级为 `React.lazy` + `Suspense`，减少首屏加载体积
- 新增 `@` 路径别名（指向 `src/`），全站模块导入统一使用短路径
- 全面类型安全优化：所有页面 `Form` 的 `getFormApi` 回调统一使用 `FormApi` 类型替代 `any`

### Fixed

- 修复菜单管理页面 `onExpandedRowsChange` 回调中行数据类型不一致导致的运行时错误
- 修复用户更新接口错误写入 `passwordUpdatedAt` 的问题
- 修复管理员默认账号在重复执行 seed 时触发唯一约束冲突的问题

---

## v0.1.4 - 2026-03-26

### Added

#### 密码策略与安全

- 新增密码复杂度配置项（最小长度、是否必须大写字母/特殊字符），用户创建和密码修改接口自动校验
- 新增密码过期功能：可设置密码有效期天数，过期后登录触发强制修改密码弹窗
- 新增注册功能开关（`allow_registration`）：支持全站启停开放注册，登录页入口动态显示

#### 用户批量导入

- 新增 Excel 导入接口，支持按部门/岗位/角色编码自动关联，逐行报告失败原因
- 用户管理页新增「导入」按钮，支持模板下载、文件上传与导入结果展示

#### 邮件配置

- 新增 `email_configs` 数据库表及 SMTP 配置读写接口（支持发送测试邮件）
- 新增「邮件配置」菜单页面，涵盖 SMTP 主机、端口、加密方式、授权密码等配置

#### OAuth 第三方登录

- 支持 GitHub、钉钉、企业微信三种 OAuth 提供方，登录后自动创建或绑定账号
- 新增 OAuth 配置管理页面（`/system/oauth-config`），可配置各提供方的 Client ID / Secret
- 个人中心新增「关联账号」Tab，可查看已绑定的第三方账号

#### 数据库备份管理

- 新增数据库备份功能（基于 pg_dump），支持手动触发、下载及删除备份文件
- 新增「数据库备份」菜单页面（`/system/db-backups`）

#### 其他

- 顶部标签栏新增右键上下文菜单（关闭当前/其他/左侧/右侧/全部标签）
- 新增 Vitest 单元测试配置，覆盖密码策略、输入净化、验证码、日期格式化等工具函数

### Changed

- 侧边栏菜单支持独立滚动，滚动条改为极窄样式，子菜单添加最大高度限制
- 登录页第三方登录图标替换为 `@iconify/react` 组件
- OpenAPI Spec 补充邮件配置、用户导入、密码策略、OAuth 登录、数据库备份接口文档

---

## v0.1.3 - 2026-03-26

### Added

#### 仪表盘

- 新增仪表盘统计接口（`GET /api/dashboard/stats`），提供用户总数、在线人数、今日登录次数、今日操作次数等统计数据
- 新增仪表盘前端页面，展示系统概况卡片、通知公告列表及技术架构信息
- 通知公告区域新增「查看更多」按钮，点击跳转至通知公告管理页面

#### 用户管理

- 新增**用户解锁**功能，支持解除登录锁定状态（`POST /api/users/:id/unlock`）
- 新增**批量删除用户**接口（`DELETE /api/users/batch`）
- 新增**批量更新用户状态**接口（`PUT /api/users/batch-status`），支持批量启用 / 禁用
- 新增**重置用户密码**接口，允许管理员重置指定用户的登录密码

#### 通知中心

- 新增通知收件箱功能，用户可查看自己收到的通知列表（含分页）
- 新增「全部标记为已读」接口，一键将所有未读通知设为已读状态

#### 菜单管理

- 新增**个人中心**与**通知中心**两个系统内置隐藏菜单，支持导航路由但不显示在侧边栏

#### 个人资料页

- 新增「我的登录记录」Tab，展示当前用户的历史登录记录
- 新增「我的操作记录」Tab，展示当前用户的历史操作日志

### Changed

- 仪表盘技术架构展示区域重构，使用 List 组件替代原有列表，提升可读性
- 通知中心界面布局优化，合并重复代码，组件结构更简洁

### Fixed

- 修复顶部导航品牌区域缺少点击跳转首页功能

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
