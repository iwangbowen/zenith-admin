# Zenith Admin

[![Version](https://img.shields.io/github/v/tag/iwangbowen/zenith-admin?label=version&color=blue)](https://github.com/iwangbowen/zenith-admin/releases)
[![Pages](https://github.com/iwangbowen/zenith-admin/actions/workflows/pages.yml/badge.svg)](https://github.com/iwangbowen/zenith-admin/actions/workflows/pages.yml)
[![Release](https://github.com/iwangbowen/zenith-admin/actions/workflows/release.yml/badge.svg)](https://github.com/iwangbowen/zenith-admin/actions/workflows/release.yml)
[![License](https://img.shields.io/github/license/iwangbowen/zenith-admin)](./LICENSE)

基于 **Hono v4 + React 19 + Semi Design v2 + Drizzle ORM** 的全栈后台管理系统。涵盖认证授权（OAuth / 企业 SSO）、组织架构（含通讯录同步）、权限控制、运行时设置、通知中心（事件驱动多渠道触达）、消息中心（IM / 音视频通话）、日志审计、告警中心、在线会话、定时任务、文件存储、缓存管理、低代码工作流、规则引擎、智能助手（Mastra 驱动的 AI 对话 / 智能体 / RAG 知识库）、数据分析、报表中心（BI）、支付中心、会员体系（含 C 端门户）、公众号管理、开放平台、CMS 内容管理、知识中心（Wiki）、服务器运维（Web 终端 / SSH / Docker）等完整业务场景，并内置可选的 **多租户（Multi-Tenant）** 与 **License 授权** 支持。

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
| 任务调度 | [pg-boss](https://github.com/timgit/pg-boss)（PostgreSQL 任务队列） |
| 前端路由 | [React Router](https://reactrouter.com/) v7 |
| 参数验证 | [Zod](https://zod.dev/)（前后端共享） |
| 认证方案 | JWT（Access + Refresh Token 自动续期）+ OAuth2 + 企业 SSO（OIDC / SAML / LDAP / AD） |
| AI 框架 | [Mastra](https://mastra.ai/)（模型目录 / Memory / RAG / 评测 / Studio） |
| 实时通信 | WebSocket + WebRTC（音视频通话） |
| 流程 / 终端 | [React Flow](https://reactflow.dev/)（@xyflow/react）+ [xterm.js](https://xtermjs.org/) |
| 图表 / 编辑器 | [VChart](https://www.visactor.io/vchart) + [Univer](https://univer.ai/)（打印报表）+ [Monaco Editor](https://microsoft.github.io/monaco-editor/)（SQL 控制台）+ [wangEditor](https://www.wangeditor.com/)（富文本） |
| 可观测性 | OpenTelemetry + Prometheus |
| 文件存储 | 本地 / 阿里云 OSS / 腾讯云 COS / 华为云 OBS / 七牛云 Kodo / 百度云 BOS / Azure Blob / S3 兼容 / SFTP |
| 桌面客户端 | [Electron](https://www.electronjs.org/)（Windows / macOS / Linux） |
| 包管理器 | npm（monorepo） |

---

## 功能模块

### 认证与账户安全

- **登录注册**：账号密码 + 图形验证码、注册开关、邮箱找回密码；JWT 双 Token 自动静默续期
- **OAuth 第三方登录**：GitHub、钉钉、企业微信、飞书一键登录与账号绑定
- **OAuth2 授权服务 / 企业 SSO**：内置 OAuth2 应用管理与 RFC 标准端点，可作第三方系统统一登录中心；OIDC / SAML / LDAP / AD 企业身份源接入，支持 JIT 自动建号
- **账户安全**：密码复杂度与过期策略、登录失败自动锁定、身份安全策略与登录风险事件
- **API Token**：个人 Token 自助管理，用于第三方接口调用鉴权

### 权限与组织架构

- **用户管理**：CRUD、启停用、批量操作、Excel 批量导入、用户级直接授权与有效权限预览
- **RBAC 权限**：角色菜单树形精确授权（父子不联动）；目录 / 菜单 / 按钮三级模型，显示与操作解耦，支持外链与 iframe 内嵌页面；动态菜单路由 + `usePermission` 按钮级权限
- **数据权限**：全部 / 自定义 / 本部门 / 本部门及以下 / 仅本人五种数据范围
- **组织架构**：部门树、岗位管理、用户组（组绑定角色自动继承，动态组按部门 / 岗位规则自动物化）
- **通讯录同步**：LDAP/AD、钉钉、企业微信、飞书组织与人员同步，字段映射与冲突裁决，平台事件回调准实时增量，内置 SCIM 2.0 Server 承接 Azure AD / Okta 推送

### 系统设置与安全

- **运行时设置**：验证码、密码策略、注册控制、登录锁定、水印、上传限制等按模块组织的类型化设置，schema 驱动的设置页，租户级覆盖与多实例即时生效
- **安全防护**：IP 黑白名单（CIDR）、接口限流、幂等防重复提交、字段级数据脱敏、维护模式
- **基础配置**：邮件 / 短信 / OAuth 服务商配置与发送测试
- **通用能力**：数据字典、统一标签体系、意见反馈闭环

### 通知与消息

- **通知公告**：富文本编辑、发布 / 草稿、已读记录，个人「我的消息」收件箱与公告中心
- **事件驱动通知中心**：统一事件目录 + `notify()` 唯一派发入口；站内信 / 邮件 / 短信 / Webhook / 聊天卡片五通道模板化触达，Outbox 可靠投递与归因日志，「事件 × 渠道」订阅偏好、免打扰与邮件摘要，平台 / 租户两级渠道策略与合规退订
- **消息频道**：系统号 / 运营号订阅体系，富文本图文群发（草稿 / 定时 / 撤回）、频道菜单与自动回复、客服工作台、频道数据看板
- **消息中心（IM）**：单聊 / 群聊、语音消息、音视频通话、投票、消息转发、@提及、表情回应、卡片消息、消息搜索与导出等；入站 Webhook 机器人
- **实时推送**：WebSocket 实时推送与未读徽标，断线自动重连

### 日志与审计

- **登录 / 操作日志**：IP 与地理位置、变更前后字段 Diff、全文检索与统计面板，支持全局与个人视图
- **日志文件**：服务端日志在线查看与下载、正则搜索、实时追踪、告警联动跳转
- **在线会话**：全部在线会话查看与强制下线

### 文件与存储

- **文件管理**：上传下载与统计，类资源管理器的可视化文件管理器（目录浏览 / 在线预览）
- **多存储后端**：本地、阿里云 OSS、腾讯云 COS、华为云 OBS、七牛云 Kodo、百度云 BOS、Azure Blob、S3 兼容、SFTP 九种，一键切换默认存储

### 任务与运行维护

- **定时任务**：Cron 任务管理、可视化表达式构建器、手动执行与历史日志
- **任务中心**：统一异步任务框架（导入导出、报表生成、静态化等），进度推送、断点续跑、自动重试与行级明细
- **调度与治理**：系统调度面板、导出中心、数据保留策略定时清理（支持试算预览）
- **数据库**：在线 SQL 控制台、表数据编辑、ER 关系图、运维面板、pg_dump 备份
- **缓存管理**：Redis 缓存可视化查看、模式搜索与批量删除
- **监控与探活**：服务器实时状态与历史趋势、`/api/health` 探活、Prometheus 指标与 OpenTelemetry 链路追踪

### 告警中心

- **告警规则**：覆盖基础设施 / 工作流 / 支付 / 开放平台四类 30 项指标，持续超阈触发、自动恢复、静默期防轰炸
- **多通道触达**：邮件 / Webhook / 站内信 / 群机器人，支持试发验证
- **告警事件**：筛选导出、认领与处理闭环、全局态势看板，日志类告警一键定位现场

### 服务器运维（DevOps）

- **Web 终端**：浏览器内多标签 / 分屏终端、录屏回放与会话管理
- **SSH / SFTP**：连接配置管理、远程文件浏览与权限修改
- **主机管理**：进程 / 端口 / systemd 服务、Docker 容器与镜像、防火墙 / Nginx 站点 / SSL 证书、网络诊断
- **日志查看器**：服务端日志实时跟踪

> 运维能力依赖宿主机环境（node-pty、ssh2、dockerode 等），建议在受控的服务器环境启用。

### 低代码工作流引擎

- **审批中心**：发起工作台、待我审批（通过 / 驳回 / 转办 / 委派 / 加签 / 退回 / 催办 / 手写签名）、我的申请 / 抄送 / 已办、审批代理（直接代批 / 建议制双模式），时间线预测剩余路径与会签进度徽标
- **流程定义**：分类与版本管理（差异对比）、导入导出、流程模板库
- **可视化设计器**：审批 / 办理 / 抄送 / 条件与路由分支 / 延迟器 / 触发器 / 子流程等节点编排，操作与表单权限配置、撤销重做
- **表单设计器**：拖拽式自定义表单，支持表单库 / 自定义业务表单 / 业务系统主导三种接入方式
- **自动化与集成**：条件自动化规则（执行留痕）、Cron 定时发起（表单预填）、事件订阅、连接器统一外呼、外部审批回调与 Saga 补偿编排
- **监控与巡检**：实例 / 任务双视角监控、流程轨迹与流转记录、逾期任务、离职交接，引擎健康巡检接入告警中心
- **移动审批**：独立移动端轻页（`approval.html`），不加载后台框架即可处理审批

> 详见文档站：[工作流引擎](https://iwangbowen.github.io/zenith-admin/workflow/)。

### 规则中心

- **决策表 / 决策流**：可视化规则编排与执行，命中策略、版本差异对比、测试用例、影子运行与执行记录追溯
- **名单库**：黑 / 白 / 灰名单集中管理，供风控与业务规则引用

### 智能助手（AI · Mastra 驱动）

- **模型接入**：Mastra 模型目录 178+ 服务商与私有 OpenAI 兼容网关、多级模型降级链、用户级个人 AI 配置
- **智能对话**：多会话流式对话，思维链与推理力度、图片消息、语音输入 / 朗读、模型竞技场、消息导出与公开分享、点赞反馈闭环
- **记忆与知识库**：Memory 上下文引擎与跨对话记忆画像；RAG 知识库（自动分块 + PgVector 检索、URL 抓取入库），对话可挂载引用回答
- **智能体 / AI 工具**：智能体创建即注册为一等 Mastra Agent，HTTP 工具供函数调用外部接口
- **评测与 Studio**：数据集 / 实验异步评测（ground-truth + LLM-as-judge 打分器）；Mastra Studio 全链路 traces 可观测
- **运营治理**：提示词模板、Token 用量统计、对话审计与用户反馈处理

### 数据分析

- **行为分析 / 数据管理 / 错误监控**：用户行为埋点分析、分析数据维护、前端错误上报与 SourceMap 堆栈还原

### 报表中心（BI）

- **数据源 / 数据集**：多数据源接入与数据集建模（可视化 SQL）
- **仪表盘 / 数据大屏**：拖拽式仪表盘（联动、钻取、条件格式）、订阅推送与嵌入分享；自由画布数据大屏自适应缩放
- **打印报表 / 填报**：打印模板设计与套打、数据填报模板与填报记录
- **数据治理**：指标中心、数据质量规则、数据预警、查询配额与 SLA、资源治理与资产目录
- **智能问数（ChatBI）**：自然语言查询数据

### 支付中心

- **渠道与订单**：微信支付、支付宝多支付方式（扫码 / JSAPI / H5 等）渠道配置，订单状态机与查询
- **资金操作**：退款 / 转账 / 预授权 / 签约代扣全流程状态跟踪
- **资金治理与风控**：对账、台账、费率、结算、分账、财务报表、风控中心、交易投诉、支付链接、Webhook 与回调验签
- **事件总线**：支付成功事件订阅，供会员充值等业务异步入账

> 详见文档站：[支付中心](https://iwangbowen.github.io/zenith-admin/backend/payment/)。

### 会员体系（前台 / 后台双体系）

后台管理（会员中心）：

- **会员看板 / 管理 / 等级**：多维图表概览、会员资料与等级体系维护
- **会员资产**：积分账户原子记账、钱包充值退款（对接支付中心）、优惠券发放与领取记录
- **会员签到**：签到规则、里程碑与签到记录（列表 / 日历双视图、补签）
- **会员安全**：登录日志与充值记录审计

前台会员门户（C 端独立 SPA）：

- 独立入口 `member.html`，移动优先，独立 JWT 会话隔离；手机号验证码 / 密码、邮箱、用户名多方式登录
- 会员中心：等级、积分、钱包充值、优惠券、签到、资料与密码管理

### 公众号管理（微信生态）

- **账号与粉丝**：公众号账号接入（内置 API 沙箱模式，演示账号免真实凭证）、粉丝管理、标签管理
- **消息能力**：消息管理、自动回复、模板消息、群发消息、多客服与会话工作台
- **菜单与素材**：自定义菜单、个性化菜单、素材管理、图文草稿
- **运营工具**：带参二维码、网页授权、数据统计

### 开放平台

- **应用与凭证**：开放应用管理（OAuth 2.1 授权码 + PKCE、双密钥宽限轮换、应用审核）、我的应用（生产 / 沙箱双环境）、API Scope 授权范围
- **调用治理**：限流套餐（QPS / 日 / 月配额与用量告警）、调用统计、签名验签（HMAC 签名网关）
- **集成能力**：Webhook 订阅、SDK 示例、API 调试台

### CMS 内容管理

- **多站点与站群**：站点父子层级继承、栏目管理、发布通道与跨站内容分发
- **内容生产**：内容编辑与自定义内容模型、素材中心、采集中心、页面搭建与可复用页面部件
- **内容治理**：敏感词 / 易错词库、评论审核、SEO 管理、全文检索
- **前台渲染**：五套内置 React 主题（企业门户 / 文档站 / 政府门户 / 资讯杂志 / 新闻门户，含变体模板）SSR 渲染，支持动态 / 混合 / 全静态三种静态化模式
- **运营与发布**：广告、表单、互动问卷、会员订阅、访问统计与数据看板；统一发布任务队列（失败重试、断点续跑）

### 知识中心（Wiki）

- **知识空间 / 文档中心**：空间级成员授权、文档树、富文本编辑、版本差异对比与回收站
- **协作与治理**：发布审核流、文档模板、评论、订阅通知、阅读确认、内容治理与知识统计
- **检索与联动**：全文检索；已发布文档自动同步 AI 知识库供对话引用

### 个人中心

- **资料与安全**：头像昵称等资料维护、修改密码、第三方账号绑定与解绑、API Token 自助管理
- **偏好与记录**：「事件 × 渠道」通知订阅偏好、免打扰与邮件摘要，个人登录 / 操作记录

### 界面与个性化

- **主题外观**：亮 / 暗 / 跟随系统、深色分区底色、35 种预设主题色 + 自定义、灰色与色弱模式、页面水印
- **导航个性化**：多标签页管理、菜单收藏（跨设备同步）、最近访问、菜单搜索、侧边栏悬浮与手风琴模式
- **页面状态深链**：页面 Tab 与选中项同步 URL，刷新 / 分享直达当前视图
- **PWA**：可选启用，支持添加到主屏幕与静态资源预缓存

### 多租户（可选）

- **租户管理与套餐**：租户全生命周期管理（状态 / 有效期 / 用户数上限），基于功能目录的套餐 + 席位配额圈定可用范围
- **数据隔离**：业务表自动按 `tenant_id` 隔离，删除级联清理；平台超管可一键切换租户视角排查
- **单租户兼容**：默认关闭，关闭时与普通单实例部署完全兼容

> 通过 `MULTI_TENANT_MODE=true`（后端）+ `VITE_MULTI_TENANT_MODE=true`（前端）开启，详见[多租户指南](https://iwangbowen.github.io/zenith-admin/backend/multi-tenant)。

### License 授权（可选）

- **功能目录**：13 个可授权功能域（工作流 / 报表 / CMS / AI / 支付等）统一定义，核心能力永不锁定
- **离线签名 License**：Ed25519 离线验签、粘贴激活、到期巡检提醒与审计日志，附签发 CLI
- **运行模式与席位**：`off` / `warn` / `required` 三级模式（登录与管理面永不拦截）；部署级 + 租户级双层席位配额

### 基础数据

- **行政区划**：国家 → 省 → 市 → 区 → 街道五级查询与级联懒加载选择组件
- **仪表盘**：用户 / 在线 / 登录操作统计卡片与公告摘要

### 开发工具

- **API 文档**：内置 Swagger UI（`/api/docs`，支持 Bearer Token 调试）与 OpenAPI JSON（可导入 Postman / Apifox）
- **业务示例**：请假管理 / 支付接入 / 异步任务三个端到端最小接入参考
- **Demo 模式**：`VITE_DEMO_MODE=true` 开启 MSW Mock，无需后端即可完整预览所有页面
- **桌面客户端**：基于 Electron 打包 Windows / macOS / Linux 桌面应用

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

> 完整部署说明（Docker、Nginx 反代等）参见文档站：[快速开始](https://iwangbowen.github.io/zenith-admin/guide/getting-started)。

---

## License

本项目采用 [MIT License](./LICENSE)。
