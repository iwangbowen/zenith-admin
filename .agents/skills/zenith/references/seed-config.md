# 菜单与种子数据配置参考（Step 9-10）

如何在 `packages/shared/src/seed/` 中添加新模块的菜单条目与初始数据。
菜单 ID 分段、显示与操作解耦、种子更新策略等约束条目见
[constraints.md → 菜单与权限配置](./constraints.md#菜单与权限配置step-9-10)，本文件只讲怎么写。

---

## 菜单 ID 分配

菜单按一级目录段拆成 `seed/menus/*.ts` 分片文件（平台级独立页在 `menus/common.ts`），由 `seed/menus.ts` 聚合；
新增条目只改对应分片，不要往聚合器里堆。

分配前先读 `seed/menus.ts`（段顺序与分片清单）与目标分片确认当前占用，再按分段规则取值：

- 新增**一级目录**：取当前最大段基数 + 1000，新建分片
- 新增**页面**：在目标段内找到最后一个节点，从其后最近的 10 倍数槽位开始
- 新增**按钮**：父菜单 ID 顺延 +1；按钮超过 9 个时自然占用后续 10 槽，下一个页面从其后最近的 10 倍数开始

## 授权语义

显示与操作解耦（`directory` / `menu` 不带权限码、权限码全部挂 `button`、首个按钮为「查询」）由此产生的授权行为：

- 勾选按钮**不会**带出所属页面（后端 `listUserMenuTree` 祖先补全只从目录 / 页面节点出发）；
  授权面板勾选页面时自动带上其「查询」按钮
- 只授予「查询」按钮 = 仅 API 可用（跨页面下拉等），页面不可见

---

## Step 9：菜单条目（`shared/src/seed/menus/{段}.ts`）

> **新增一级目录**时：在 `seed/menus/` 下新建分片，在 `seed/menus.ts` 中 import 并按顺序加入
> `SEED_MENUS` 展开列表；分片内 `SEED_DATE` 从 `../_base` 导入（**不要**从 `../menus` 导入，
> 会与聚合器形成 ESM 值环，分片先于 `SEED_DATE` 初始化而读到 `undefined`）。

```ts
// 一级目录 = 新 1000 段的基数，纯显示资源，不带 permission
{ id: <段基数>, parentId: 0, title: 'XXX模块', name: 'XxxModule', icon: 'Layers',
  type: 'directory', sort: 99, status: 'enabled', visible: true,
  createdAt: SEED_DATE, updatedAt: SEED_DATE },

// 可导航页面（纯显示资源，列表权限码放在「查询」按钮上）
{ id: <10的倍数槽位>, parentId: <父目录ID>, title: 'XXX管理', name: 'SystemXxx',
  path: '/system/xxxs',
  component: 'xxxs/XxxPage',        // ← 相对 packages/web/src/pages/ 的路径，无扩展名
  icon: 'CircleDot',                 // ← lucide-react 图标名（大驼峰）
  type: 'menu', sort: 10, status: 'enabled', visible: true,
  createdAt: SEED_DATE, updatedAt: SEED_DATE },

// 按钮：不可导航，只挂权限码；ID 从父菜单顺延 +1，第一个固定为「查询」（sort: 0）
{ id: <菜单ID+1>, parentId: <菜单ID>, title: '查询', type: 'button', sort: 0,
  status: 'enabled', visible: true, permission: 'system:xxx:list',
  createdAt: SEED_DATE, updatedAt: SEED_DATE },
{ id: <菜单ID+2>, parentId: <菜单ID>, title: '新增XXX', type: 'button', sort: 1,
  status: 'enabled', visible: true, permission: 'system:xxx:create',
  createdAt: SEED_DATE, updatedAt: SEED_DATE },
{ id: <菜单ID+3>, parentId: <菜单ID>, title: '编辑XXX', type: 'button', sort: 2,
  status: 'enabled', visible: true, permission: 'system:xxx:update',
  createdAt: SEED_DATE, updatedAt: SEED_DATE },
{ id: <菜单ID+4>, parentId: <菜单ID>, title: '删除XXX', type: 'button', sort: 3,
  status: 'enabled', visible: true, permission: 'system:xxx:delete',
  createdAt: SEED_DATE, updatedAt: SEED_DATE },
```

字段规则：

| 字段 | 规则 |
| --- | --- |
| `component` | 相对 `packages/web/src/pages/` 的路径，**无 `.tsx` 扩展名**；前端用 `React.lazy` + 动态 import 按该路径加载。例：`'users/UsersPage'` → `pages/users/UsersPage.tsx` |
| `name` | 一级目录 `XxxModule`；系统管理下的菜单 `SystemXxx`；独立模块菜单 `XxxManagement`；按钮 `undefined` |
| `icon` | lucide-react 图标名（大驼峰），如 `CircleDot`、`LayoutList`、`BookOpen`，可在 <https://lucide.dev/icons/> 搜索 |

实际写法参考（系统管理 = 1000 段，具体 ID 以源文件为准）：

```ts
{ id: 1020, parentId: 1000, title: '部门管理', name: 'SystemDepartments',
  path: '/system/departments', component: 'system/departments/DepartmentsPage',
  icon: 'Building2', type: 'menu', sort: 2, status: 'enabled', visible: true,
  createdAt: SEED_DATE, updatedAt: SEED_DATE },
{ id: 1021, parentId: 1020, title: '查询', type: 'button', sort: 0, status: 'enabled',
  visible: true, permission: 'system:department:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
{ id: 1022, parentId: 1020, title: '新增部门', type: 'button', sort: 1, status: 'enabled',
  visible: true, permission: 'system:department:create', createdAt: SEED_DATE, updatedAt: SEED_DATE },
```

---

## Step 10：种子数据

> **审计字段无需手填**：seed 脚本整体由 `runAsUser(adminId, ...)`（[`lib/audit-context.ts`](../../../../packages/server/src/lib/audit-context.ts)）
> 包裹，所有写入会被 db Proxy 自动注入 `createdBy = updatedBy = adminId`。

### 10a：先在 `shared/src/seed/{业务域}.ts` 声明常量

初始数据**必须**先放到 shared，使 DB seed 和 MSW mock 共用同一份数据源：

```ts
import type { Xxx } from '../{业务域}/types';
import { SEED_DATE } from './_base';            // 统一基准时间（勿从 './menus' 导入，会成环）

export const SEED_XXXS: Xxx[] = [
  { id: 1, name: '示例XXX-1', description: '初始演示数据', status: 'enabled',
    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '示例XXX-2', description: '初始演示数据', status: 'enabled',
    createdAt: SEED_DATE, updatedAt: SEED_DATE },
];
```

**新增 seed 分片时**在 `shared/src/seed/index.ts` 补 `export * from './{业务域}';`，
否则 `@zenith/shared/seed` 拿不到新常量。

### 10b：在 `server/src/db/seed.ts` 中导入并插入

```ts
import { ..., SEED_XXXS } from '@zenith/shared/seed';

// seedRest() 函数末尾追加：显式插入 id 的表必须加 .overridingSystemValue()
// （主键是 GENERATED ALWAYS AS IDENTITY，未声明覆盖时 PG 会拒绝显式 id）
await db.insert(xxxs).overridingSystemValue().values(
  SEED_XXXS.map(({ id, name, description, status }) => ({ id, name, description, status })),
).onConflictDoNothing({ target: xxxs.id });
await db.execute(sql`SELECT setval('xxxs_id_seq', GREATEST((SELECT MAX(id) FROM xxxs), 1))`);
logger.info('  ✔ Xxxs seeded (onConflictDoNothing)');
```

- **不需要 `setval` 与 `overridingSystemValue`** 的情况：不插入显式 `id`（完全使用 DB 自增）
- **不需要 shared 常量**的情况：seed 数据与 mock 无关（管理员密码、china-division 地区数据等），
  可直接写在 seed.ts

### 菜单种子的更新方式

只新增不更新、结构字段改动须配数据迁移、手工 ID 区间等规则见
[constraints.md → 菜单与权限配置](./constraints.md#菜单与权限配置step-9-10)。操作上：

- 新增菜单：维护 `SEED_MENUS` 后重跑 `npm run db:seed`（或重启 dev）即可插入，无需改 seed.ts
- 修改 / 删除既有内置菜单：`npx drizzle-kit generate --custom` 建独立迁移写 `UPDATE menus ...` / `DELETE`
  （删除前先清理 `role_menus` / `user_menus` 引用）
- 角色绑定：超管角色每次 seed 对当前全部菜单补齐绑定（`onConflictDoNothing`）；其他角色按 `SEED_ROLES.menuIds` 绑定，
  菜单 ID 用 `collectMenuSubtreeIds(rootId)` 等推导（定义在 `shared/src/seed/menus.ts`）
