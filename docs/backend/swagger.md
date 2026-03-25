# Swagger / OpenAPI 文档

Zenith Admin 后端集成了 Swagger UI，开发时可直接在浏览器中浏览、调试所有 REST 接口，无需借助外部工具。

---

## 访问地址

| 路径 | 说明 |
|------|------|
| `GET /api/docs` | Swagger UI 交互式界面 |
| `GET /api/openapi.json` | OpenAPI 3.0 JSON Spec（可导入 Postman / Apifox） |

默认开发环境地址：

- **Swagger UI**：`http://localhost:3300/api/docs`
- **JSON Spec**：`http://localhost:3300/api/openapi.json`

> 两个端点均**无需认证**，可直接访问。

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

OpenAPI Spec 以**静态对象**的形式维护，文件位于：

```
packages/server/src/openapi.ts
```

### 新增接口时的更新步骤

1. 在 `openapi.ts` 的 `paths` 中添加对应路径定义
2. 如有新实体类型，在 `components.schemas` 中补充 Schema
3. 无需重启服务，刷新 Swagger UI 即可看到更新

### 结构说明

```ts
export const openapiSpec = {
  openapi: '3.0.3',
  info: { ... },          // 基本信息（标题、版本、描述）
  servers: [...],         // 服务器地址
  components: {
    securitySchemes: {}, // 认证方式（BearerAuth）
    schemas: {},         // 可复用的数据模型（User、Role 等）
    parameters: {},      // 可复用的查询参数（PageParam 等）
  },
  security: [...],        // 全局认证要求
  paths: { ... },        // 各接口路径定义
  tags: [...],           // 接口分组标签
};
```

---

## 接口分组

| 标签 | 说明 |
|------|------|
| 认证 | 登录、登出、Token 刷新、验证码 |
| 用户管理 | 用户 CRUD 及登录锁定解除 |
| 角色管理 | 角色 CRUD 及菜单权限分配 |
| 菜单管理 | 菜单 / 按钮权限树管理 |
| 部门管理 | 组织架构 CRUD |
| 字典管理 | 数据字典及字典项 CRUD |
| 操作日志 | 系统操作日志查询（含变更 diff） |
| 系统配置 | 内置系统配置项的读写 |
| 定时任务 | 定时任务管理及执行历史 |
| 服务状态 | 健康检查，无需认证 |
