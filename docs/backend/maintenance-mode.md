# 维护模式

维护模式允许超级管理员在系统升级、数据库迁移或紧急修复期间临时暂停普通用户的 API 访问，整个过程无需重启服务。

---

## 功能概览

| 能力 | 说明 |
|------|------|
| **一键开关** | 后台管理页面即可开启/关闭，变更在 5 秒内生效（内存缓存 TTL） |
| **超管旁路** | 拥有 `super_admin` 角色的用户不受限制，可正常访问所有接口 |
| **前端感知** | 普通用户收到 503 后自动显示全屏维护遮罩，每 30 秒自动检查是否恢复 |
| **管理员横幅** | 超管登录后顶部出现橙色横幅，可直接点击关闭维护 |
| **二次确认** | 开启时弹出 `Modal.confirm`，防止误操作 |
| **自定义消息** | 支持配置展示给用户的维护提示语和预计结束时间 |
| **WebSocket 旁路** | `/api/ws` 始终不受维护中间件影响 |

---

## 菜单入口

**系统设置 → 维护模式**（路由：`/system/maintenance`，权限：`system:maintenance:manage`）

---

## 工作机制

```
所有 /api/* 请求
  │
  ├── 旁路路径（直接放行）：
  │   /api/health、/api/auth/*、/api/maintenance/status
  │   /api/ws、/metrics
  │
  ├── 读取维护状态（内存缓存 5s）
  │     enabled = false → 正常放行
  │     enabled = true  → 继续检查
  │
  └── 检查 JWT 角色
        roles 包含 super_admin → 正常放行
        其他 / 无 token        → 返回 503 JSON
```

### 503 响应格式

```json
{
  "code": 503,
  "message": "系统维护中，请稍后重试",
  "data": null
}
```

---

## 前后端联动

### 前端（普通用户）

1. `request.ts` 拦截 HTTP 503 响应，解析响应体并派发 `maintenance:enabled` CustomEvent
2. `App.tsx` 监听该事件；若当前用户不是超管，则显示全屏 `MaintenanceOverlay`
3. `MaintenanceOverlay` 每 30 秒轮询 `/api/maintenance/status`，恢复后自动关闭遮罩
4. 应用首次加载时（auth 完成后）也会主动检查一次 `/api/maintenance/status`

### 前端（超级管理员）

1. `AdminLayout` 挂载时拉取 `/api/maintenance/status`，若开启则显示顶部橙色横幅
2. 横幅提供「关闭维护模式」按钮，点击调用 `PUT /api/maintenance { enabled: false }`
3. 操作成功后派发 `maintenance:statusChanged` 事件，`MaintenancePage` 同步刷新状态
4. `MaintenancePage` 开启/关闭后也派发 `maintenance:statusChanged` 事件，横幅即时联动

### 事件总线

| 事件名 | 触发方 | 监听方 | 携带数据 |
|--------|--------|--------|----------|
| `maintenance:enabled` | `request.ts`（503 拦截） | `App.tsx`、`AdminLayout` | 503 响应体中的 `data`；维护中间件返回 `null` 时为空对象 |
| `maintenance:statusChanged` | `MaintenancePage`、`AdminLayout` | 对方 | 更新后的状态对象或空 |

---

## API 接口

### `GET /api/maintenance/status`

> **公开接口，无需认证**

返回当前维护模式状态，供前端初始检查使用。

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "enabled": false,
    "message": "系统维护中，请稍后重试",
    "estimatedEndAt": null,
    "startedAt": null,
    "startedByName": null,
    "updatedAt": "2026-06-07 18:00:00"
  }
}
```

### `GET /api/maintenance`

> 需要 `system:maintenance:manage` 权限

同 `/status`，但经过认证保护，用于管理页面拉取详情。

### `PUT /api/maintenance`

> 需要 `system:maintenance:manage` 权限

开启或关闭维护模式。

**请求体：**

```json
{
  "enabled": true,
  "message": "系统升级中，预计 30 分钟后恢复",
  "estimatedEndAt": "2026-06-07 20:00:00"
}
```

**响应：** 返回更新后的维护状态（与 `/status` 格式相同）。

---

## 数据库结构

维护状态持久化在 PostgreSQL 的 `maintenance_mode` 表（ID 固定为 1 的单行记录）：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | `integer` | 固定为 1 |
| `enabled` | `boolean` | 是否开启 |
| `message` | `varchar(512)` | 维护提示语 |
| `estimated_end_at` | `timestamp` | 预计结束时间（可选） |
| `started_at` | `timestamp` | 最近一次开启时间 |
| `started_by_name` | `varchar` | 开启人用户名（快照） |
| `updated_at` | `timestamp` | 最后更新时间 |

后端使用 **5 秒内存缓存**（TTL）避免每次请求都查数据库，同时在写入后自动失效缓存（`invalidateMaintenanceCache()`）。

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `packages/server/src/db/schema/system.ts` | `maintenanceMode` 表定义 |
| `packages/server/src/services/maintenance.service.ts` | 业务逻辑 + 缓存管理 |
| `packages/server/src/middleware/maintenance.ts` | 请求拦截中间件 |
| `packages/server/src/routes/maintenance.ts` | API 路由定义 |
| `packages/web/src/pages/system/maintenance/MaintenancePage.tsx` | 管理页面 |
| `packages/web/src/components/MaintenanceOverlay.tsx` | 全屏维护遮罩组件 |
| `packages/web/src/utils/request.ts` | 503 拦截逻辑 |
| `packages/web/src/App.tsx` | 全局维护状态管理 |
| `packages/web/src/layouts/AdminLayout.tsx` | 超管维护横幅 |
| `packages/web/src/mocks/handlers/maintenance.ts` | MSW Mock Handler |
