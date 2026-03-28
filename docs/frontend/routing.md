# 前端路由与菜单

本页介绍 Zenith Admin 前端路由的注册机制、动态菜单工作原理及路由守卫逻辑。

---

## 整体路由策略

项目使用 `react-router-dom v7`，路由分为两类：

| 类型 | 注册方式 | 示例 |
|------|----------|------|
| **固定路由** | 硬编码在 `App.tsx` 中，始终可访问 | `/login`、`/profile`、`/notifications` |
| **动态路由** | 登录后从后端 `/api/menus/user` 接口获取菜单树，按角色权限动态注册 | `/system/users`、`/system/roles` 等 |

`react-router-dom` 的 `basename` 会自动适配 GitHub Pages 的部署路径（读取 `import.meta.env.BASE_URL`）。

---

## 动态菜单路由注册流程

```
用户登录成功，token 写入 localStorage
    ↓
App.tsx 渲染 AdminRouteLoader 组件
    ↓
请求 GET /api/menus/user（携带 Bearer token）
    ↓
后端返回当前用户有权访问的菜单树
    ↓
flattenMenus() 扁平化：只保留 type=menu 且有 path + component 的菜单项
    ↓
通过 import.meta.glob('./pages/**/*.tsx') 懒加载对应组件文件
    ↓
在 Routes 中动态注册所有 <Route>
    ↓
侧边栏渲染的菜单树也同步来自此数据，与路由保持一致
```

### 菜单 `component` 字段说明

菜单表中 `component` 字段存储**相对于 `src/pages/` 的文件路径**（不含 `.tsx` 后缀）。例如：

| 菜单路径 | component 字段值 |
|----------|-----------------|
| `/system/users` | `system/users/UsersPage` |
| `/system/roles` | `system/roles/RolesPage` |
| `/system/dicts` | `system/dicts/DictsPage` |

动态路由加载时会自动拼接成 `./pages/system/users/UsersPage.tsx` 并懒加载。

---

## 路由守卫

### 未登录保护

`App.tsx` 通过 `useAuth()` hook 检查 `localStorage` 中是否存在有效 token：

- **未登录**：所有路由重定向到 `/login`（除 `/oauth/callback/:provider` 外）
- **已登录**：进入 `AdminRouteLoader`，加载菜单后渲染后台布局

### 无权限保护

用户访问没有对应菜单注册的路由时，会命中 `*` 通配路由，渲染 404 页面。

按钮级权限通过 `PermissionContext` + `usePermission` hook 实现：

```tsx
import { usePermission } from '@/hooks/usePermission';

const { hasPermission } = usePermission();

// 只有拥有 'system:user:create' 权限的用户才能看到「新增」按钮
{hasPermission('system:user:create') && (
  <Button onClick={openCreate}>新增</Button>
)}
```

---

## 系统内置路由

以下路由为固定注册，与菜单数据库无关：

| 路径 | 说明 | 是否需要登录 |
|------|------|------------|
| `/login` | 登录页 | 否 |
| `/reset-password` | 重置密码页 | 否 |
| `/oauth/callback/:provider` | OAuth 第三方登录回调页 | 否 |
| `/` | 仪表盘（首页） | 是 |
| `/profile` | 个人中心 | 是 |
| `/notifications` | 通知中心 | 是 |
| `/forbidden` | 无权限提示页 | 是 |

`/profile` 和 `/notifications` 虽然对应系统菜单中的隐藏菜单项，但路由是硬编码的，不经过动态加载。

---

## 标签页（Tab）管理

后台布局中包含标签页（多 Tab）导航，用户访问过的页面会以 Tab 形式保留在顶部。

**右键上下文菜单**（从 v0.1.4 起）支持以下操作：

- 关闭当前标签
- 关闭其他标签
- 关闭左侧标签
- 关闭右侧标签
- 关闭全部标签

标签页状态保存在内存中（组件 state），刷新页面后重置为当前页。

---

## 路由加载性能

所有页面组件均使用 `React.lazy` + `<Suspense>` 懒加载（从 v0.1.5 起全面应用），加载时显示 `<Spin />` 占位，减少首屏加载体积。新增页面只需按上述 `component` 字段规则放置文件，无需手动注册路由。

---

## 新增页面的完整流程

1. 在 `packages/web/src/pages/<module>/<ComponentName>.tsx` 创建页面组件
2. 在数据库 `menus` 表中新增菜单记录，`component` 字段填写相对路径（如 `<module>/<ComponentName>`）
3. 运行 `npm run db:seed` 或在「菜单管理」后台页面中手动创建菜单并分配权限
4. 刷新页面，动态路由自动注册，侧边栏自动显示新菜单
