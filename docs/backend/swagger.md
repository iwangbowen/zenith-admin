# Swagger / OpenAPI 文档

Zenith Admin 后端通过 `@hono/zod-openapi` 在运行时生成 OpenAPI 3.1 文档，并提供 Swagger UI。路由 schema 是唯一维护入口，不需要手写静态 OpenAPI 文件。

---

## 访问地址

| 路径 | 说明 |
| --- | --- |
| `GET /api/docs` | Swagger UI 交互式界面 |
| `GET /api/openapi.json` | OpenAPI 3.1 JSON Spec，可导入 Postman / Apifox |
| `GET /metrics` | Prometheus 文本指标端点，非 OpenAPI 端点 |

默认开发环境地址：

- Swagger UI：`http://localhost:3300/api/docs`
- JSON Spec：`http://localhost:3300/api/openapi.json`
- Metrics：`http://localhost:3300/metrics`

`/api/docs`、`/api/openapi.json` 与 `/metrics` 无需认证。

## 非 OpenAPI 运维端点

`GET /metrics` 由 `@hono/prometheus` 与 `prom-client` 暴露，返回 Prometheus 文本格式，不返回 JSON schema，也不进入 `/api/openapi.json`。

---

## 鉴权方式

OpenAPI 全局声明 `BearerAuth`：

```http
Authorization: Bearer <accessToken>
```

Swagger UI 调试步骤：

1. 调用 `POST /api/auth/login` 获取 `accessToken`。
2. 点击 Swagger UI 右上角 **Authorize**。
3. 在 `BearerAuth` 中填入 `Bearer <accessToken>` 或直接填入 token 值（Swagger UI 会按 http bearer 方案处理）。
4. 授权后调试带 `security: [{ BearerAuth: [] }]` 的接口。

公开接口在路由定义中显式写 `security: []`，例如登录、验证码、刷新令牌、公开升级接口、开放回调类端点。

---

## 导入 Postman / Apifox

1. 打开 Postman 或 Apifox。
2. 选择 **Import → URL**。
3. 填入 `http://localhost:3300/api/openapi.json`。
4. 导入后按 tags 查看接口分组。

---

## Spec 维护

OpenAPI Spec 由 `@zenith/shared/{域}/contracts/` 中的契约操作汇总生成：路径、参数、请求体、响应 schema、tags、
`security` 与通用错误响应全部来自契约。维护规则：

1. 路由文件创建 `new OpenAPIHono({ defaultHook: validationHook })`。
2. 每个端点用 `defineContractRoute(xxxContract.op, { middleware, handler })` 声明；handler 只从 `c.req.valid()` 取已校验值。
3. 实体 schema 用 `.meta({ id: 'Xxx' })` 命名 OpenAPI 组件，字段说明与示例用 `.meta({ description, example })`。
4. 文件类响应在契约上标 `kind: 'excel' | 'csv' | 'file'`，SSE 用 `kind: 'sse'`；上传请求体用 `multipart(...)`。
5. 契约之外的额外响应（如 409 冲突）经 `defineContractRoute` 的 `responses` 选项追加。
6. 子路由通过 `router.openapiRoutes([... ] as const)` 注册；业务域在 `routes/{domain}/index.ts` 的 `defineRouteDomain` 挂载。
7. 新增业务域时加入 `routes/index.ts` 的 `ROUTE_DOMAINS`。
8. 路由表快照由 `packages/server/src/app.contract.test.ts` 维护，OpenAPI 文档可用性由 `packages/server/src/lib/openapi-doc.test.ts` 覆盖。
9. `PUT` / `PATCH` 请求体 schema 由 `partialForUpdate()` 派生，生成的文档中属性不带 `default`；契约测试会拒绝携带 `default` 的部分更新请求体，整体替换 / upsert 端点需在其例外清单登记。

递归 Zod schema 使用项目封装的稳定引用写法，避免 `/api/openapi.json` 展开递归结构时栈溢出。普通 `Hono` 子路由不会自动合并 OpenAPI registry；需要出现在文档中的端点应使用 `OpenAPIHono`。

---

## 接口分组

业务域装配顺序由 `packages/server/src/routes/index.ts` 的 `ROUTE_DOMAINS` 控制：

```text
ops → identity → member → platform → files → tasks → analytics → report → messaging → payment → open-platform → workflow → chat → mp → biz-demo → ai → cms → wiki
```

OpenAPI tags 由各路由文件声明。代码中同时存在英文标签（如 `Auth`、`Users`、`AsyncTasks`、`ExportJobs`、`WorkflowDefinitions`）和少量中文领域标签。完整列表以 Swagger UI 为准，核心分组包括：

| 标签/领域 | 说明 |
| --- | --- |
| `Auth` / `MemberAuth` | 管理员与会员认证、刷新令牌、会话、个人资料 |
| `Users` / `Roles` / `Menus` / `Departments` / `Positions` / `UserGroups` | 身份、组织、角色、菜单权限与用户组 |
| `Tenants` / `TenantPackages` / `Licensing` | 租户、套餐与授权 |
| `Settings` / `CronJobs` / `SystemScheduler` / `Retention` / `Cache` | 运行时设置、业务定时任务、系统调度、数据保留与缓存 |
| `AsyncTasks` / `TaskDemo` | 通用异步任务、任务类型策略、任务明细与演示任务 |
| `ExportJobs` | 导出实体、导出任务、下载与下载日志 |
| `Files` / `Business Files` | 文件上传、托管文件、业务附件 |
| `DbAdmin` / `DbBackups` | 数据库管理、查询、备份 |
| `OperationLogs` / `LoginLogs` / `IpAccessLogs` | 审计、登录与 IP 访问日志 |
| `Notifications` / `Announcements` / `Channels` / `Email*` / `Sms*` / `InApp*` | 通知公告、频道、邮件、短信与站内信 |
| `Workflow*` | 流程定义、实例、任务、自动化、事件订阅、引擎运维 |
| `Payment*` | 支付应用、订单、退款、对账、分账、结算、风控与回调 |
| `Member*` | 会员、等级、标签、积分、钱包、优惠券、签到、充值 |
| `Report*` | 数据源、数据集、仪表盘、订阅、投递、打印、数据质量 |
| `CMS-*` / `MemberCms` / `公开API-CMS` | CMS 站点、栏目、内容、素材、发布、采集、前台与开放 API |
| `Mp*` | 微信公众号账号、粉丝、菜单、素材、群发、模板消息、客服 |
| `Open*` / `ApiScopes` / `DeveloperApps` / `AppWebhooks` | 开放平台、OAuth2、API Scope、签名与调用统计 |
| `AI` | AI 配置、对话、智能体、知识库、评测、Mastra Studio 代理 API |
| `Chat*` | 聊天会话、消息、机器人、Webhook、定时消息 |
| `Rules*` | 决策表、决策流、名单库与执行记录 |
| `Ops` 相关标签 | 进程、端口、Docker、网络诊断、systemd、Nginx、SSL、终端与日志 |
| `Wiki*` | 知识空间、文档、模板、标签、评论与治理 |
| `服务状态` | `GET /api/health` 健康检查 |
