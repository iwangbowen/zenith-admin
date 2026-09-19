# Zenith Admin

[![Version](https://img.shields.io/github/v/tag/iwangbowen/zenith-admin?label=version&color=blue)](https://github.com/iwangbowen/zenith-admin/releases)
[![Pages](https://github.com/iwangbowen/zenith-admin/actions/workflows/pages.yml/badge.svg)](https://github.com/iwangbowen/zenith-admin/actions/workflows/pages.yml)
[![Release](https://github.com/iwangbowen/zenith-admin/actions/workflows/release.yml/badge.svg)](https://github.com/iwangbowen/zenith-admin/actions/workflows/release.yml)
[![License](https://img.shields.io/github/license/iwangbowen/zenith-admin)](./LICENSE)

基于 **Hono v4 + React 19 + Semi Design v2 + Drizzle ORM** 的全栈后台管理系统。涵盖认证授权（OAuth / 企业 SSO）、组织架构（含通讯录同步）、权限控制、运行时设置、通知中心（事件驱动多渠道触达）、会话中心（IM / 音视频通话）、日志审计、告警中心、在线会话、定时任务、文件存储、企业网盘、缓存管理、低代码工作流、规则引擎、智能助手（Mastra 驱动的 AI 对话 / 智能体 / RAG 知识库）、全局搜索、数据分析、报表中心（BI）、支付中心（含对账）、会员体系（含 C 端门户）、公众号管理、增长运营（短链 / 营销）、开放平台、CMS 内容管理、知识中心（Wiki）、物联网（IoT）、服务器运维（Web 终端 / SSH / Docker）等完整业务场景，并内置可选的 **多租户（Multi-Tenant）** 与 **License 授权** 支持。

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
| 前端框架 | [React](https://react.dev/) 19 + [Vite](https://vitejs.dev/) 8 |
| UI 组件库 | [Semi Design](https://semi.design/) v2 |
| 图标体系 | [lucide-react](https://lucide.dev/) |
| 数据库 ORM | [Drizzle ORM](https://orm.drizzle.team/) + PostgreSQL |
| 会话 / 缓存 | [Redis](https://redis.io/)（ioredis） |
| 任务调度 | [pg-boss](https://github.com/timgit/pg-boss)（PostgreSQL 任务队列）；后端按 `ZENITH_ROLES` 拆为 api（接入）/ worker（执行）两种进程角色，可独立扩缩 |
| 前端路由 | [React Router](https://reactrouter.com/) v7 |
| 参数验证 | [Zod](https://zod.dev/)（前后端共享） |
| 认证方案 | JWT（Access + Refresh Token 自动续期）+ OAuth2 + 企业 SSO（OIDC / SAML / LDAP / AD） |
| AI 框架 | [Mastra](https://mastra.ai/)（模型目录 / Memory / RAG / 评测 / Studio） |
| 实时通信 | WebSocket（经 Redis pub/sub 跨进程扇出）+ WebRTC（音视频通话） |
| 流程 / 终端 | [React Flow](https://reactflow.dev/)（@xyflow/react）+ [xterm.js](https://xtermjs.org/) |
| 图表 / 编辑器 | [VChart](https://www.visactor.io/vchart) + [Univer](https://univer.ai/)（打印报表）+ [Monaco Editor](https://microsoft.github.io/monaco-editor/)（SQL 控制台）+ [wangEditor](https://www.wangeditor.com/)（富文本） |
| 可观测性 | OpenTelemetry + Prometheus |
| 文件存储 | 本地 / 阿里云 OSS / 腾讯云 COS / 华为云 OBS / 七牛云 Kodo / 百度云 BOS / Azure Blob / S3 兼容 / SFTP |
| 桌面客户端 | [Electron](https://www.electronjs.org/)（Windows / macOS / Linux） |
| 包管理器 | npm（monorepo） |

---

## 功能模块

### 认证与账户安全

- **登录与安全**：账号密码 + 图形验证码、注册开关、邮箱找回；JWT 双 Token 静默续期、TOTP 多因素认证、会话并发控制；密码策略、登录锁定与风险事件
- **统一登录**：GitHub / 钉钉 / 企微 / 飞书一键登录绑定；内置 OAuth2 授权服务；OIDC / SAML / LDAP / AD 企业身份源（JIT 建号）；个人 API Token

### 权限与组织架构

- **用户与授权**：用户 CRUD、启停用、批量导入、直接授权与有效权限预览、模拟登录排查；角色菜单树形授权（父子不联动），目录 / 菜单 / 按钮三级模型、按钮级权限、接口目录；全部 / 自定义 / 本部门（含以下）/ 仅本人数据范围
- **组织与同步**：部门树、岗位、用户组（含动态组）；LDAP/AD、钉钉、企微、飞书通讯录同步与 SCIM 推送

### 系统设置与安全

- **运行时设置**：验证码、密码、注册、登录锁定、水印、上传等 schema 驱动设置，租户级覆盖、多实例即时生效；邮件 / 短信 / OAuth 服务商配置与发送测试；数据字典、标签、反馈
- **安全防护**：IP 黑白名单、接口限流、数据脱敏、维护模式，关键资金接口业务幂等键

### 通知与消息

- **通知中心**：事件目录 + `notify()` 统一派发，站内信 / 邮件 / 短信 / 推送 / Webhook / 聊天卡片六通道，Outbox 可靠投递；订阅偏好、免打扰与定时摘要
- **群发与推送**：公告与「我的消息」收件箱；系统号 / 运营号图文群发；面向全体用户 / 会员的运营群发；App 推送配置与送达回执
- **会话中心（IM）**：单聊 / 群聊、音视频通话、投票、转发、@、表情回应、卡片消息、搜索收藏；Webhook 机器人；WebSocket 实时推送

### 日志与审计

- **日志审计**：登录 / 操作日志（IP、字段 Diff、检索统计）；服务端日志查看下载与实时追踪；在线会话强制下线

### 文件与存储

- **文件与存储**：上传下载统计，九种存储后端一键切换；存储配置内嵌目录浏览与预览

### 企业网盘

- **企业网盘**：个人 / 部门 / 协作空间与细粒度授权、版本回滚；密码 / 有效期 / IP 白名单外链分享与免登录收集；回收站、配额扩容审批、空间 / 外链 / 合规治理与审计

### 任务与运行维护

- **任务调度**：Cron 可视化管理；统一异步任务（进度推送、断点续跑、自动重试）；调度面板、导入 / 导出中心、数据保留策略
- **数据与监控**：只读 SQL 控制台、表编辑、ER 图、SQL 监控；Redis 键值管理；服务状态趋势、探活、Prometheus / OTel / 全链路追踪

### 告警中心

- **告警中心**：六类 33 项指标，超阈触发、自动恢复、静默期；邮件 / Webhook / 站内信触达；事件认领闭环与态势看板

### 服务器运维（DevOps）

- **服务器运维**：Web 终端（多标签 / 分屏 / 录屏）、SSH / SFTP、主机（进程 / Docker / 防火墙 / Nginx / 证书）、文件管理器、应用发布（多机滚动发布与自动回滚）、日志实时跟踪

> 运维能力依赖宿主机环境（node-pty、ssh2、dockerode 等），建议在受控的服务器环境启用。

### 低代码工作流引擎

- **审批与设计**：发起工作台、待办（通过 / 驳回 / 转办 / 委派 / 加减签 / 协办 / 退回 / 撤回 / 催办 / 批量 / 签名）、审批代理；可视化设计器（审批 / 办理 / 抄送、四种分支、延迟 / 触发 / 子流程、异常捕获补偿）；拖拽表单三种接入
- **自动化与监控**：条件规则、Cron 定时发起、事件订阅、连接器、外部回调与 Saga 补偿；实例 / 任务 / 作业 / 补偿多视角监控、健康巡检；移动审批轻页

> 详见文档站：[工作流引擎](https://iwangbowen.github.io/zenith-admin/workflow/)。

### 规则中心

- **规则中心**：决策表 / 决策流 / 评分卡可视化编排，命中策略、灰度发布与审批、影子对比、执行追溯；黑 / 白 / 灰名单库

### 智能助手（AI · Mastra 驱动）

- **模型与对话**：Mastra 模型目录（约 170+ 家）与私有网关、降级链；多会话流式对话、思维链、图片与语音消息、竞技场、分支对比、公开分享
- **知识与治理**：Memory 记忆画像、RAG 知识库；智能体与 HTTP 工具；异步评测（5 种打分器）、调用链审计、Studio 独立调试；提示词模板、用量统计与反馈闭环

### 数据分析

- **数据分析**：概览 / 实时大盘，事件、漏斗、留存、路径、归因分析；用户分群与多通道触达、A/B 实验；事件字典与质量看板；前后端错误监控与会话回放

### 报表中心（BI）

- **报表中心**：多源接入与可视化 SQL 建模；拖拽仪表盘（网格 / 画布 / 大屏轮播、联动钻取）、订阅与分享嵌入；打印与填报（含审核流）；指标、质量、预警、资源治理与资产目录；自然语言问数

### 支付中心

- **渠道与资金**：微信 / 支付宝 / 云闪付，生产 / 沙箱应用绑定商户配置；退款 / 转账 / 预授权 / 代扣；免登录公开收银台；台账、结算、分账、风控、交易投诉
- **对账中心**：账单下载 / 导入与原件归档，银行到账拆分合并分配，差异案件与查单补偿，调整单审批（提交 / 执行 / 冲正）；支付事件订阅与重投

> 详见文档站：[支付中心](https://iwangbowen.github.io/zenith-admin/backend/payment/)。

### 会员体系（前台 / 后台双体系）

- **会员中心（后台）**：多维概览、资料等级、标签打标；积分原子记账、钱包充值退款、优惠券；签到（补签）；登录 / 充值审计、自助注销
- **会员门户（C 端）**：`member.html` 独立 SPA 与会话隔离，账号密码 / 手机验证码登录；等级、积分、钱包、券、签到与资料管理

### 公众号管理（微信生态）

- **公众号管理**：账号接入（`wxdemo` 沙箱，seed 默认停用）、粉丝标签、关注自动建会员与内容校验；消息 / 自动回复 / 模板 / 群发 / 多客服；菜单、素材、图文草稿；带参二维码、网页授权、数据统计

### 增长运营

- **增长运营**：短链管理（自定义短码、密码、UTM，多业务幂等生成）与访问统计；抽奖活动（权重库存、落地页自动生成分享短链）；按来源 / 媒介 / 活动聚合点击与转化归因

### 开放平台

- **开放平台**：OAuth 2.1 + PKCE 应用管理、双密钥轮换、IP 白名单、生产 / 沙箱环境、Scope 授权；限流套餐与用量、HMAC 签名网关、配额 Webhook 告警；Webhook 订阅、SDK 示例、API 调试台

### 物联网（IoT）

- **物联网**：产品 + 物模型（TSL 导入导出）、直连 / 网关 / 子设备、SN 动态注册；分组批量控制、遥测曲线、属性影子、运行日志、分级告警与维护窗口；OTA 灰度、场景联动、计划任务、数据流转；大盘、设备地图与网关拓扑

### CMS 内容管理

- **CMS 内容管理**：多站点层级继承、栏目、跨站分发；内容模型、素材、采集、页面搭建；敏感词、评论审核、SEO、全文检索、友情链接、标签、热词治理；五套主题 SSR 与三模静态化；广告、表单、问卷、订阅、统计与发布队列

### 知识中心（Wiki）

- **知识中心（Wiki）**：空间授权、文档树、富文本、收藏与 Markdown 导入、版本对比、回收站；发布审核、模板、评论、订阅、阅读确认；全文检索，文档可同步 AI 知识库（需开启同步）

### 全局搜索

- **全局搜索**：顶栏 `Ctrl+K` 直达菜单与 18 类业务数据（用户、会员、订单、流程、文件、设备告警、内容文档、日志任务等），按权限过滤、点击直达深链；历史与保存条件可分享

### 个人中心

- **个人中心**：资料改密、第三方绑定、TOTP 认证、我的设备、签名、API Token、已授权应用；事件 × 渠道订阅偏好、免打扰与定时摘要；个人登录 / 操作记录

### 界面与个性化

- **界面与个性化**：亮 / 暗主题、35 色 + 自定义、灰色 / 色弱模式、水印；两级偏好（时钟、定时深色、音效、动画、遮罩关闭、屏幕锁）可导出；多标签、菜单收藏、最近访问、菜单搜索；接入页面的 Tab / 选中项同步 URL；PWA

### 多租户（可选）

- **租户与隔离**：租户全生命周期与套餐席位配额；业务表按 `tenant_id` 自动隔离，超管可切换租户视角；默认关闭即单实例部署

> 通过 `MULTI_TENANT_MODE=true`（后端）+ `VITE_MULTI_TENANT_MODE=true`（前端）开启，详见[多租户指南](https://iwangbowen.github.io/zenith-admin/backend/multi-tenant)。

### License 授权（可选）

- **功能目录**：14 个可授权功能域统一定义，核心能力永不锁定
- **离线签名 License**：Ed25519 离线验签、粘贴激活、宽限期、到期巡检与审计，附签发 CLI
- **运行模式与席位**：`off` / `warn` / `required` 三级模式（登录与管理面永不拦截）；部署级 + 租户级双层席位配额

### 基础数据

- **基础数据**：省 / 市 / 县三级区划查询与级联选择；超管可见的仪表盘统计卡片与公告摘要

### 开发工具

- **开发工具**：Swagger UI 与 OpenAPI JSON；请假 / 支付 / 任务端到端示例；Demo 模式免后端预览绝大多数页面（终端等宿主机能力除外）；Electron 三端桌面应用

---

## 原生 AI 友好

Zenith Admin 专为 AI 辅助开发场景设计，让 GitHub Copilot、Claude、Cursor 等工具在生成代码时能精准理解项目约定。

| 文件 / 目录 | 用途 |
| --- | --- |
| [`AGENTS.md`](./AGENTS.md) | AI 工具的"项目说明书"，包含架构约定、常用命令与注意事项 |
| [`.agents/skills/zenith/`](.agents/skills/zenith) | Zenith 项目 Skill：CRUD、模块修改、异步任务、排错与发布工作流 |

在支持 Skills 的 AI 工具中描述需求，即可自动完成 **Schema → 迁移 → 类型 → 路由 → 前端页面 → Mock 数据** 的端到端生成。详见文档站：[AI 辅助开发](https://iwangbowen.github.io/zenith-admin/ai/)。

---

## 快速开始

**前置条件**：Node.js 24.x、PostgreSQL、Redis

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在 `packages/server/` 目录下创建 `.env` 文件（参考 `packages/server/.env.example`），最小配置如下：

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/zenith_admin
REDIS_URL=redis://127.0.0.1:6379
```

`JWT_SECRET` / `FIELD_ENCRYPTION_KEY` 本地开发（`npm run dev`）可以省略，会自动使用内置开发密钥；生产环境必填且无默认值，用 `npm run secret:generate` 生成。

前端默认请求 `http://localhost:3300`，如需修改，在 `packages/web/` 下创建 `.env` 并设置 `VITE_API_BASE_URL`。

### 3. 初始化数据库

```bash
npm run db:migrate   # 执行数据库迁移
npm run db:seed      # 填充初始数据（创建默认 admin 账号）
```

### 4. 启动开发服务器

```bash
npm run dev            # 同时启动前端 + 后端（推荐）

npm run dev:server     # 仅启动后端
npm run dev:web        # 仅启动前端
```

默认账号：`admin` / 密码：`123456`

### 5. 生产构建

```bash
npm run build          # 顺序构建：shared → server → web
```

构建产物：后端 `packages/server/dist/`，前端 `packages/web/dist/`。

> 完整部署说明（进程角色、Docker Compose、Nginx 反代等）参见文档站：[部署说明](https://iwangbowen.github.io/zenith-admin/guide/deployment) 与 [Docker 部署](https://iwangbowen.github.io/zenith-admin/guide/docker)。

---

## License

本项目采用 [MIT License](./LICENSE)。
