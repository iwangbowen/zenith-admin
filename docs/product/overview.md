# 产品概览

Zenith Admin 是面向企业后台、运营平台、SaaS 管理端与内部工具的全栈后台系统。当前实现基于 **Hono v4 + React 19 + Drizzle ORM**，采用 npm monorepo。

## 核心定位

Zenith Admin 不是空白管理台模板，而是一套带基础治理、业务中台能力、内容协作、智能助手、开放生态与运维工具的可扩展项目底座。

适合：

- 快速交付企业后台、运营管理端或 PoC 的团队
- 需要统一前后端契约、权限、审计、任务、通知与 Demo 能力的项目
- 需要把工作流、支付、会员、报表、CMS、开放平台、Wiki、AI 等能力组合进同一后台的场景

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 运行时 | Node.js 24 |
| 后端 | Hono v4、`@hono/zod-openapi`、Drizzle ORM、PostgreSQL、Redis、pg-boss |
| 前端 | React 19、Vite 8、React Router 7、TanStack Query v5、Semi Design v2、lucide-react |
| AI | Mastra（模型目录、Agent、Memory、RAG、评测、Studio） |
| 实时通信 | WebSocket、SSE、WebRTC |
| 图表 / 设计器 | VChart、React Flow（`@xyflow/react`）、Univer、Monaco Editor、wangEditor、xterm.js |
| 桌面端 | Electron 43、electron-builder、electron-updater |
| 文档站 | VitePress |
| 部署 | Docker Compose、Nginx、GitHub Actions |

## 应用形态

| 形态 | 说明 |
| --- | --- |
| 后台管理 | `index.html`，管理员完整后台 |
| 会员前台 | `member.html`，C 端会员独立 SPA，账号体系与后台隔离 |
| 移动审批 | `approval.html`，轻量审批入口 |
| CMS 前台 | 服务端 CMS SSR / 静态化输出 |
| Demo 站 | `VITE_DEMO_MODE=true`，MSW Mock，无后端运行 |
| PWA | 可选构建 Service Worker 与 Manifest，支持添加到主屏幕 |
| Electron | 桌面壳承载 Web 产物，支持 Web 热更新与壳全量更新 |

## 产品价值

### 基础治理完整

用户、角色、菜单、部门、岗位、用户组、租户、租户套餐、License、数据字典、地区、标签、运行时设置、账号安全、企业身份源、日志审计、在线会话、缓存管理与维护模式形成基础后台能力。

### 通知与协作集中

公告、站内信、邮件、短信、消息频道、客服工作台、通知策略、个人订阅偏好与 Chat 即时通讯统一在系统内，支持 WebSocket 实时推送与多渠道触达。

### 工作流与规则引擎联动

工作流提供流程定义、设计器、表单、审批中心、代理、自动化、定时发起、连接器、事件订阅、健康巡检和流程仿真。规则中心提供决策表、决策流、评分卡、名单库、灰度发布、批量仿真与统一执行留痕，可被工作流、支付、开放平台等业务消费。

### 业务中台能力丰富

支付中心覆盖渠道、订单、退款、回调、对账、台账、费率、结算、分账、转账、预授权、签约代扣、投诉与风控；会员中心覆盖等级、积分、钱包、优惠券、签到、充值与前台自助；报表中心覆盖数据源、数据集、仪表盘、大屏、打印、填报、指标、质量、治理、资产目录与智能问数。

### 内容与开放生态

CMS 覆盖多站点、栏目、内容模型、素材、页面搭建、发布、检索、SEO、评论、广告、表单、问卷、采集、访问统计、会员订阅和内容分发。知识中心提供 Wiki 空间、文档树、版本、审核、模板、标签、评论、回收站、统计、设置与内容治理。开放平台提供 OAuth2 应用、我的应用、API Scope、限流套餐、调用统计、签名验签、Webhook、SDK 示例与调试台。

### AI 与开发协作

AI 功能区内置服务商管理、流式对话、知识库、智能体、HTTP 工具、模型评测、竞技场、提示词、用量统计、审计与反馈；仓库提供 `AGENTS.md` 与 Zenith Skill，帮助 AI 编程工具按项目规范完成开发任务。

### 运维与交付闭环

系统内置监控告警、任务中心、导出中心、数据库备份 / 管理、Web 终端、SFTP、进程、端口、Docker、网络诊断、systemd、防火墙、Nginx、SSL 与日志查看器。应用版本管理与 Electron 更新打通桌面客户端发布；Docker、GitHub Pages、Release 工作流覆盖常见交付路径。

## 推荐阅读

- [功能模块](/product/features)
- [快速开始](/guide/getting-started)
- [项目结构](/guide/project-structure)
- [AI 辅助开发](/ai/)
