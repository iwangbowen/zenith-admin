# 前端路由与菜单

本页介绍 Zenith Admin 前端路由注册、动态菜单、路由守卫和标签页机制。后台入口的路由集中装配在 `packages/web/src/App.tsx`。

---

## 整体路由策略

项目使用 `react-router-dom v7`。后台入口根据运行环境选择 Router：浏览器环境使用 `BrowserRouter`，`basename` 来自 `import.meta.env.BASE_URL`；Electron 环境（`VITE_ELECTRON=true`）使用 `HashRouter`，避免 `file://` 协议限制。

后台路由分两类：

- **固定路由**：在 `App.tsx` 直接声明，例如登录、公开页、个人中心、工作流设计器、报表设计器、带路径参数且需要特殊权限判断的页面
- **动态路由**：登录后从 `GET /api/menus/user` 获取当前用户菜单树，根据菜单 `path` + `component` 注册页面路由

菜单侧边栏与动态路由使用同一棵用户菜单树，因此可见菜单与可访问页面保持一致。

## 登录态分流

`App.tsx` 通过 `useAuth()` 读取认证状态，按 `status` 分流：

| status | 渲染结果 |
| --- | --- |
| `checking` | `AppChrome` + `PageLoading`，用于本地有 token 且正在请求 `/api/auth/me` 的阶段 |
| `unavailable` | `AppChrome` + `FullPageRetry`，凭证保留，支持离线感知、重试与「重新登录」 |
| `anonymous` | 匿名路由表：登录、重置密码、OAuth 回调、企业身份源回调、OAuth2 授权页、公开支付链接、公开报表 |
| `authenticated` | `PreferencesProvider` + `ThemeProvider` + `AdminRouteLoader`，加载菜单并注册后台路由 |

`checking` 与 `unavailable` 在 Router 之前返回，但仍包裹 `ThemeProvider` 与 `ElectronTitleBar`，保证深色模式与 Electron 标题栏立即生效。

### 匿名可访问的路由

- `/login`
- `/reset-password`
- `/oauth/callback/:provider`
- `/enterprise/callback`
- `/oauth2/authorize`
- `/public/payment/link/:token`
- `/public/report/:token`
- 其他路径重定向到 `/login`，并以 `redirect` query 保留来源路径

`/public/ai-chat/:token` 在已登录路由表中作为独立页面注册；未登录访问会进入登录重定向。

### 已登录访问认证页

- `/login` 默认跳转到合法 `redirect` 目标；目标必须以 `/` 开头、非 `//`、非 `/login`，否则回首页
- `/login?add_account=1` 渲染登录页进入添加账号模式，保留当前登录态，成功后切换为新账号
- `/reset-password` 跳转首页

---

## 动态菜单路由注册流程

```text
存在 token（含刷新页面）
    ↓
prefetchAdminShell()（lib/shell-prefetch.ts）与 /api/auth/me 并行启动：
  预热 lucide 图标表 · import() AdminLayout / DashboardPage · prefetch GET /api/menus/user 与 /api/settings/me
    ↓
AuthProvider 拉取 /api/auth/me 成功 → App.tsx 渲染 AdminRouteLoader
    ↓
useCurrentUserMenuTree() → GET /api/menus/user   当前用户可见菜单树（hooks/queries/menus.ts，staleTime 5 分钟）
    ↓
首载 gate：仅此一个查询 isPending 时显示 PageLoading；后台 refetch 保留旧数据
    ↓
flattenMenus()：扁平化用户菜单树，只保留有 path 且有 component 的节点，
并跳过 FIXED_ROUTES 中的路径
    ↓
lazyPageComponent(m.component)（utils/page-registry.ts）解析懒加载组件
    ↓
在 <Routes> 中动态注册 <Route>；侧边栏继续使用同一用户菜单树
```

完整菜单树（`useMenuTree()` → `GET /api/menus`）不在启动链路上：只有命中 catch-all 的 `NotFoundOrForbidden` 才会请求它，用于 403 / 404 判别。

### 菜单数据的加载失败语义

- **用户菜单树失败**：渲染整页「导航菜单加载失败」重试页，并提供退出登录入口
- **完整菜单树失败**：只影响 catch-all 的 403 / 404 判别精度，不阻塞任何已注册页面

### 权限变更即时生效

角色授权、用户授权、用户组角色、租户套餐等 mutation 成功后调用 `invalidateCurrentUserAccess(qc)`（`hooks/queries/menus.ts`），统一失效 `['menus', 'user-tree']` 与 `['auth', 'me']`。当前登录者的侧边栏、动态路由和按钮级权限码随之刷新。

### 菜单 `component` 字段与页面注册表

菜单表中 `component` 字段存储**相对于 `packages/web/src/pages/` 的文件路径**，不含 `.tsx` 后缀，例如 `/system/users` 对应 `system/users/UsersPage`。

解析统一走 `src/utils/page-registry.ts`：

- `import.meta.glob` 只收**页面级**组件：`../pages/**/*Page.tsx`、`../pages/biz/**/*.tsx`、`../pages/**/*BusinessForm.tsx`、`../pages/**/*ApprovalView.tsx`（排除 `*Skeleton.tsx` 与 `*.test.tsx`）
- `resolvePageLoader(component)` 返回动态 import loader；`hasPageComponent(component)` 用于存在性判断
- `lazyPageComponent(component)` 返回缓存过的 `React.lazy` 组件；路径不存在返回 `null`，路由跳过注册并打印 warning
- 工作流自定义业务表单（`components/workflow/BusinessFormHost.tsx`）复用同一注册表

::: warning 命名即注册
glob 命中的每个文件都是独立的动态入口：页面内部的子组件、Tab、弹窗、面板**不得**以 `*Page.tsx` 命名，否则会从所属页面 chunk 中被拆出、多一次请求，并在注册表里多带一份预载依赖表。反过来，能被菜单 `component` 或工作流 `customForm` 引用的组件必须符合上述命名，否则 `hasPageComponent` 返回 `false`。`src/utils/page-registry.test.ts` 校验所有种子菜单与种子自定义表单都能解析。
:::

### 外链内嵌菜单

`isExternal + embed` 的菜单注册为内部路由 `/embed/{菜单 id}`，由 `EmbedPage` 使用 iframe 嵌入 `m.path`。

---

## 路由守卫

### 无权限保护（403 / 404 判别）

访问未注册路由时命中 `NotFoundOrForbidden`。它用完整菜单树构建的 `path → component` 映射做前缀匹配（如 `/system/users/123` 匹配 `/system/users`）：

- 路径对应菜单页面存在、但当前用户菜单未注册 → 403
- 路径不存在 → 404
- 固定路由与 `/` 不参与 403 判别

::: warning 页面级权限只能由动态菜单承载
不要为菜单页面在 `App.tsx` 里另写无守卫的硬编码 `<Route>`。同一路径的硬编码路由会遮蔽动态菜单过滤，造成未授权访问。`src/App.routes.test.tsx` 覆盖该策略。
:::

### 带权限判断的固定路由

少数固定路由无法由菜单承载，在 `App.tsx` 中直接用权限码判断：

| 路由 | 要求权限（或 `*`） |
| --- | --- |
| `/report/fill/:code` | `report:fill:record:create` 或 `report:fill:record:update` |
| `/system/firewall` | `system:firewall:view` |
| `/system/nginx-sites` | `system:nginx:view` |
| `/system/oauth2-apps/:id` | `system:oauth2-apps:view` |

### 按钮级权限

按钮级权限通过 `PermissionContext` + `usePermission` 实现。权限码来自 `/api/auth/me` 响应。

```tsx
import { usePermission } from '@/hooks/usePermission';

const { hasPermission, hasAnyPermission } = usePermission();

{hasPermission('system:user:create') && (
  <CreateButton onClick={openCreate} />
)}
```

`hasPermission` / `hasAnyPermission` 引用稳定，可安全作为 `useMemo` / `useCallback` 依赖。

---

## 系统内置路由

以下为后台固定注册路由（需登录，除非在匿名路由表中列出）：

- `/`：首页入口 `HomeEntry`，登录落地时按默认首页偏好跳转，日常手动访问进入仪表盘
- `/profile`：个人中心
- `/announcements`：公告中心
- `/inbox`：我的消息
- `/workflow/designer/:id`：工作流设计器
- `/workflow/launch/:definitionId`：工作流发起页
- `/workflow/instance/:id`：流程实例详情页
- `/report/dashboards/:id/design`：看板设计器
- `/report/dashboards/:id/view`：看板查看页
- `/report/print/:id/design`：打印模板设计器
- `/report/fill/:code`：填报入口（带权限判断）
- `/system/firewall`、`/system/nginx-sites`、`/system/oauth2-apps/:id`：带权限判断
- `/public/ai-chat/:token`：公开 AI 对话分享页（在已登录路由表中注册）
- `/oauth2/authorize`、`/enterprise/callback`、`/public/payment/link/:token`、`/public/report/:token`：独立页面，不在后台布局内
- `/users`：重定向到 `/system/users`
- `/forbidden`：无权限提示页

`FIXED_ROUTES` 当前包含 `/profile`、`/announcements`、`/inbox`、`/system/firewall`、`/system/nginx-sites`，`flattenMenus` 会跳过这些路径，避免重复注册。

---

## 标签页（Tab）与页面缓存

后台布局包含多标签页导航（`hooks/useTabsStore.ts`、`layouts/AdminLayout.tsx`、`layouts/admin/TabBarItem.tsx`）。用户访问过的后台页面会作为 Tab 保留在顶部。

- 右键上下文菜单支持固定/取消固定、刷新、关闭当前、关闭其他、关闭左侧、关闭右侧、关闭全部
- 排序规则为首页、固定标签、普通标签；支持拖拽排序，固定区与普通区不混排
- 达到偏好 `tabsMaxCount` 时按 `tabEvictPolicy`（`fifo` / `lru`）淘汰可关闭标签，并显示一次提示
- `openTabBehavior` 控制新标签追加到末尾或插入到当前标签后
- 开启「保持标签页」时，标签状态持久化到 `zenith_tabs`
- 页面缓存由偏好 `enablePageCache` 与菜单 `keepAlive` 白名单共同决定，`KeepAliveOutlet` 只缓存菜单声明允许缓存的路径
- 路由切换动画（偏好 `routeAnimation`：无 / 淡入 / 上滑 / 左滑）基于 React 19.3 `<ViewTransition>`：`layouts/RouteViewTransition.tsx`
  把偏好映射为 enter / exit class（`AdminLayout.css` 的 `::view-transition-*(.route-vt-*)`），包裹 `KeepAliveOutlet` 与非缓存
  `Outlet` 的页面容器；react-router 导航、`<Activity>` 显隐与 `startTransition` 包裹的页签刷新都会触发，缓存页签切换同样有过渡。
  生效值统一取 `useRouteAnimation()`（减弱动态效果时为 `none`）；浏览器不支持 View Transitions 时自动跳过动画
- 「左滑」带方向感：页签栏发起的导航（点击页签、关闭页签落到邻位、关闭其他 / 左侧 / 右侧 / 全部）统一经
  `AdminLayout` 的 `navigateToTab` → `layouts/route-transition-types.ts#navigateWithDirection`，目标页签位于当前页签左侧时
  `addTransitionType('route-back')`，`RouteViewTransition` 按类型选择反向 class（`.route-vt-slide-right-*`）；
  侧边菜单等其他入口不带类型，走默认前进方向

---

## 路由加载性能

- 登录页静态打包进入口关键路径（匿名用户首屏只有 5 个请求）；`AdminLayout`、仪表盘与其他页面懒加载
- 存在 token 时 `prefetchAdminShell()` 与 `/api/auth/me` 并行预热壳层 chunk、图标表、用户菜单树与个人设置，认证完成后无需再等待网络
- 固定页面与动态页面均使用 `React.lazy` + `Suspense`；仪表盘使用 `DashboardSkeleton`，其余页面使用 `PageLoading inline`。
  后台布局内统一经 `layouts/RouteSuspense.tsx` 挂载：fallback 与页面内容各自包在 `RouteViewTransition` 中，
  chunk 就绪时「占位 → 页面」的揭示走交叉淡化而非硬切（揭示是原地替换，不跟随 slide 方向；动画关闭时同样关闭）
- 后台布局内置 `NProgress` 顶部路由切换进度条，可由偏好 `showProgressBar` 关闭
- `PageErrorBoundary` / `RouteErrorBoundary` 识别动态模块加载失败，提示页面资源加载失败并通过整页刷新恢复
- chunk 分层、体积预算与度量脚本见 [打包与首屏性能](./bundle-performance.md)

---

## pages 目录结构

`packages/web/src/pages/` 下的一级目录包括：

```text
ai            alerts        analytics     announcements  biz
chat          cms           dashboard     embed          forbidden
inbox         login         member        mp             not-found
oauth         oauth2        open-platform payment        profile
public-ai-chat report       reset-password rules         system
users         wiki          workflow
```

---

## 新增页面的完整流程

1. 在 `packages/web/src/pages/<module>/<Name>Page.tsx` 创建页面组件（必须以 `Page.tsx` 结尾才会进入页面注册表；页面私有的子组件不要用该后缀）
2. 在菜单数据中新增记录，`component` 填写相对路径（如 `system/users/UsersPage`），并配置权限
3. 让角色、用户、用户组或租户套餐获得对应权限；相关 mutation 需刷新当前用户访问范围
4. 刷新页面，动态路由注册，侧边栏展示该菜单

完整 CRUD 开发流程见 [`.agents/skills/zenith/SKILL.md`](https://github.com/iwangbowen/zenith-admin/blob/master/.agents/skills/zenith/SKILL.md)。
