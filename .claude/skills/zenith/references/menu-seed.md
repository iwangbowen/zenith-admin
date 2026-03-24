# 菜单与种子数据配置参考

本文档说明如何在 `seed-data.ts` 中添加新模块的菜单条目，以及在 `seed.ts` 中添加初始数据。

---

## 现有菜单 ID 速查

了解现有 ID 有助于确定新菜单的父节点：

| ID | 类型 | 标题 | 路径 |
|----|------|------|------|
| 0 | — | 根节点（虚拟） | — |
| 1 | menu | 首页 | `/` |
| 2 | directory | 系统管理 | — |
| 3 | menu | 用户管理 | `/system/users` |
| 4 | menu | 菜单管理 | `/system/menus` |
| 5 | menu | 角色管理 | `/system/roles` |
| 6 | menu | 字典管理 | `/system/dicts` |
| 8 | directory | 文件管理 | — |
| 36 | menu | 部门管理 | `/system/departments` |
| 40 | menu | 岗位管理 | `/system/positions` |
| 50 | menu | 系统配置 | `/system/configs` |

> **当前最大 ID 约为 53**，新菜单从 **100** 起步（跳跃编号，便于维护）。

---

## Step 8：`packages/shared/src/seed-data.ts`

### 新增目录（一级菜单 / 二级目录，若需要）

```ts
// 在 SEED_MENUS 数组末尾追加：
{ id: 100, parentId: 0,   title: 'XXX模块',  name: 'XxxModule',  path: undefined,  component: undefined,  icon: 'Layers',  type: 'directory', sort: 99, status: 'active', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
```

### 新增菜单页面条目

```ts
// type: 'menu' — 可导航的页面
{ id: 101, parentId: 2,   title: 'XXX管理',  name: 'SystemXxx',
  path: '/system/xxxs',
  component: 'xxxs/XxxPage',         // ← 必须精确匹配 src/pages/ 下的文件路径，无扩展名
  icon: 'CircleDot',                  // ← lucide-react 图标名
  type: 'menu', sort: 10,
  status: 'active', visible: true,
  permission: 'system:xxx:list',      // ← 列表权限码
  createdAt: SEED_DATE, updatedAt: SEED_DATE },
```

> **`component` 字段规则**：
> - 值 = 相对 `packages/web/src/pages/` 的路径，**无 `.tsx` 扩展名**
> - 前端 `App.tsx` 用 `React.lazy(() => import(`../../pages/${m.component}`))` 动态加载
> - 例：`component: 'users/UsersPage'` → `src/pages/users/UsersPage.tsx`

### 新增按钮权限条目

```ts
// type: 'button' — 不可导航，只挂权限码；path/component/icon 均为 undefined
{ id: 102, parentId: 101, title: '新增XXX',  name: undefined, path: undefined, component: undefined, icon: undefined,
  type: 'button', sort: 1, status: 'active', visible: true,
  permission: 'system:xxx:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
{ id: 103, parentId: 101, title: '编辑XXX',  name: undefined, path: undefined, component: undefined, icon: undefined,
  type: 'button', sort: 2, status: 'active', visible: true,
  permission: 'system:xxx:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
{ id: 104, parentId: 101, title: '删除XXX',  name: undefined, path: undefined, component: undefined, icon: undefined,
  type: 'button', sort: 3, status: 'active', visible: true,
  permission: 'system:xxx:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
```

### `name` 字段命名规范

| 场景 | name 示例 |
|------|----------|
| 一级目录 | `XxxModule` |
| 系统管理下的菜单 | `SystemXxx` |
| 独立模块菜单 | `XxxManagement` |
| 按钮 | `undefined` |

### `icon` 字段

统一使用 **lucide-react** 图标名（大驼峰），如 `CircleDot`、`LayoutList`、`BookOpen`。  
可在 [https://lucide.dev/icons/](https://lucide.dev/icons/) 搜索。

---

## Step 9：`packages/server/src/db/seed.ts`

在现有 seed 函数末尾追加初始数据（使用 `onConflictDoNothing` 确保幂等执行）：

```ts
// ─── 初始 XXX 数据（可根据需要删除，仅供演示）──────────────────────────
await db.insert(xxxs).values([
  { name: '示例XXX-1', description: '初始演示数据', status: 'active' },
  { name: '示例XXX-2', description: '初始演示数据', status: 'active' },
]).onConflictDoNothing({ target: xxxs.name });

// ─── 重置序列（插入固定 ID 数据后必须执行）───────────────────────────────
// 如果你插入了带固定 id 的数据，必须重置序列，否则自增会冲突：
// await db.execute(sql`SELECT setval('xxxs_id_seq', GREATEST((SELECT MAX(id) FROM xxxs), 1))`);
```

> **注意**：如果没有固定 id 的种子数据（只有动态插入），则不需要 `setval`。

### 菜单种子更新方式

菜单使用 `onConflictDoUpdate`，确保重跑 seed 时可以更新已有菜单：

```ts
for (const menu of SEED_MENUS) {
  await db.insert(menus).values(menu).onConflictDoUpdate({
    target: menus.id,
    set: { title: menu.title, path: menu.path, component: menu.component, /* 其他需要更新的字段 */ }
  });
}
```

---

## 完整示例（以「部门管理」为参考）

```ts
// seed-data.ts 中的实际写法
{ id: 36, parentId: 2,  title: '部门管理', name: 'SystemDepartments',
  path: '/system/departments',
  component: 'system/departments/DepartmentsPage',
  icon: 'Building2', type: 'menu', sort: 2,
  status: 'active', visible: true,
  permission: 'system:department:list',
  createdAt: SEED_DATE, updatedAt: SEED_DATE },
{ id: 37, parentId: 36, title: '新增部门', name: undefined, path: undefined, component: undefined, icon: undefined,
  type: 'button', sort: 1, status: 'active', visible: true,
  permission: 'system:department:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
{ id: 38, parentId: 36, title: '编辑部门', name: undefined, path: undefined, component: undefined, icon: undefined,
  type: 'button', sort: 2, status: 'active', visible: true,
  permission: 'system:department:update', createdAt: SEED_DATE, updatedAt: SEED_DATE },
{ id: 39, parentId: 36, title: '删除部门', name: undefined, path: undefined, component: undefined, icon: undefined,
  type: 'button', sort: 3, status: 'active', visible: true,
  permission: 'system:department:delete', createdAt: SEED_DATE, updatedAt: SEED_DATE },
```
