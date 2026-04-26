# Swagger / OpenAPI 文档

Zenith Admin 后端集成了 Swagger UI，开发时可直接在浏览器中浏览、调试所有 REST 接口，无需借助外部工具。

---

## 访问地址

| 路径                     | 说明                                              |
|--------------------------|---------------------------------------------------|
| `GET /api/docs`          | Swagger UI 交互式界面                             |
| `GET /api/openapi.json`  | OpenAPI 3.1 JSON Spec（可导入 Postman / Apifox）  |
| `GET /metrics`           | Prometheus 文本指标端点（非 OpenAPI 端点）        |

默认开发环境地址：

- **Swagger UI**：`http://localhost:3300/api/docs`
- **JSON Spec**：`http://localhost:3300/api/openapi.json`
- **Metrics**：`http://localhost:3300/metrics`

> `GET /api/docs`、`GET /api/openapi.json` 与 `GET /metrics` 均**无需认证**，可直接访问。

## 非 OpenAPI 运维端点

以下端点由服务端直接暴露，但不属于 Swagger / OpenAPI 文档：

| 路径 | 说明 |
| --- | --- |
| `GET /metrics` | Prometheus 文本格式指标，用于被 Prometheus Server 抓取 |

这类端点不返回 JSON schema，也不面向前端业务调试，因此不会出现在 `/api/openapi.json` 中。

---

## 鉴权方式

所有需要登录的接口均使用 **Bearer Token** 认证。在 Swagger UI 中调试前需先完成授权：

1. 调用 `POST /api/auth/login` 获取 `accessToken`
2. 点击 Swagger UI 右上角 **Authorize** 按钮
3. 在弹窗的 `BearerAuth` 输入框中填入 Token 值，格式：`Bearer <accessToken>`
4. 点击 **Authorize → Close**，后续所有请求将自动携带该 Token

---

## 导入 Postman / Apifox

1. 打开 Postman 或 Apifox
2. 选择 **Import → URL**
3. 填入 JSON Spec 地址：`http://localhost:3300/api/openapi.json`
4. 导入完成后即可看到所有接口分组

---

## Spec 维护

OpenAPI Spec **自动生成**，由 `@hono/zod-openapi` 在运行时从每个路由文件的 `createRoute(...)` 声明中汇总。**无需维护任何静态文件**。

### 新增接口时的更新步骤

1. 在路由文件中用 `createRoute(...)` 声明新接口（设好 `method`、`path`、`tags`、`request`、`responses`）
2. 确保路由已通过 `app.route(prefix, router)` 注册到 `src/index.ts`
3. 刷新 Swagger UI 即可看到新接口（无需改其他文件）

### 实现位置

- **Spec 生成**：`src/index.ts` 中的 `app.doc31('/api/openapi.json', { openapi: '3.1.0', ... })`（`doc31()` 才能生成真正的 OpenAPI 3.1 格式 schema）
- **路由定义**：`src/routes/*.ts` 中每个路由使用 `defineOpenAPIRoute({ route: createRoute({...}), handler })` 定义为命名常量，再通过 `xxxRouter.openapiRoutes([...] as const)` 统一注册（参考 `src/routes/api-tokens.ts`）
- **公共 Schema 辅助**：`src/lib/openapi-schemas.ts`（响应辅助函数 `ok(DTO, desc)` / `okPaginated(DTO, desc)` / `okMsg(desc)`；公共 schema `IdParam` / `PaginationQuery` / `BatchIdsBody`；底层工具 `jsonContent` / `validationHook` / `commonErrorResponses` / `ErrorResponse`）
- **实体 DTO 中心仓库**：按业务域拆分至 `src/lib/dtos/`（`iam` / `auth` / `dict` / `files` / `logs` / `notices` / `system` / `workflow` / `dashboard` / `region` / `messages`），`src/lib/openapi-dtos.ts` 为 re-export barrel —— 所有路由统一从 `'../lib/openapi-dtos'` 导入，保证 Swagger Components 单一来源，**禁止在路由文件内本地重复声明 `.openapi('EntityName')` 的实体 DTO**
- **认证方案**：`BearerAuth` 在 `src/index.ts` 中一次性注册到 `app.openAPIRegistry`
- **健康检查**：`src/routes/health.ts` 提供 `GET /api/health`，无需认证，可用于容器编排平台健康探针

---

## 接口分组

> 以下仅列出核心分组，完整 Tag 列表请以 `/api/doc` Swagger UI 为准。

| 标签 | 说明 |
| --- | --- |
| 认证 | 登录、登出、Token 刷新、验证码 |
| 用户管理 | 用户 CRUD 及登录锁定解除 |
| 角色管理 | 角色 CRUD 及菜单权限分配 |
| 菜单管理 | 菜单 / 按钮权限树管理 |
| 部门管理 | 组织架构 CRUD |
| 岗位管理 | 岗位 CRUD |
| 字典管理 | 数据字典及字典项 CRUD |
| 操作日志 | 系统操作日志查询（含变更 diff） |
| 登录日志 | 登录历史查询 |
| 系统配置 | 内置系统配置项的读写 |
| 定时任务 | 定时任务管理及执行历史 |
| 文件管理 | 文件上传、下载及存储配置 |
| 通知公告 | 通知发布与已读状态 |
| 会话管理 | 在线会话查询与强制下线 |
| 数据库备份 | 备份创建、下载及历史 |
| 消息模板 | 消息模板 CRUD 及预览 |
| 工作流 | 流程定义、实例及待办 |
| 租户管理 | 多租户 CRUD（开启多租户模式时可见）|
| 仪表盘 | 统计数据汇总接口 |
| 服务状态 | 健康检查，无需认证 |
