import type { Menu } from '../../identity/contracts';
import { SEED_DATE } from '../_base';

/** 系统管理（1000 段） */
export const SEED_MENUS_SYSTEM: Menu[] = [
  { id: 1000, parentId: 0, title: '系统管理', name: 'System', icon: 'Settings', type: 'directory', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1010, parentId: 1000, title: '用户管理', name: 'SystemUsers', path: '/system/users', component: 'users/UsersPage', icon: 'UsersRound', type: 'menu', sort: 1, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1020, parentId: 1000, title: '部门管理', name: 'SystemDepartments', path: '/system/departments', component: 'system/departments/DepartmentsPage', icon: 'Building2', type: 'menu', sort: 2, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1030, parentId: 1000, title: '岗位管理', name: 'SystemPositions', path: '/system/positions', component: 'system/positions/PositionsPage', icon: 'BriefcaseBusiness', type: 'menu', sort: 3, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1040, parentId: 1000, title: '菜单管理', name: 'SystemMenus', path: '/system/menus', component: 'system/menus/MenusPage', icon: 'LayoutList', type: 'menu', sort: 4, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1050, parentId: 1000, title: '用户组', name: 'SystemUserGroups', path: '/system/user-groups', component: 'system/user-groups/UserGroupsPage', icon: 'Users', type: 'menu', sort: 4, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1060, parentId: 1000, title: '角色管理', name: 'SystemRoles', path: '/system/roles', component: 'system/roles/RolesPage', icon: 'ShieldCheck', type: 'menu', sort: 5, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1130, parentId: 1000, title: '权限治理', name: 'SystemAccessGovernance', path: '/system/access-governance', component: 'system/access-governance/AccessGovernancePage', icon: 'ShieldCheck', type: 'menu', sort: 5, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 接口权限矩阵：契约 access 派生的只读视图（接口 ↔ 权限码 ↔ 角色 / 用户），无独立数据表
  { id: 1110, parentId: 1000, title: '接口与权限', name: 'SystemAccessCatalog', path: '/system/access-catalog', component: 'system/api-catalog/AccessCatalogPage', icon: 'ListTree', type: 'menu', sort: 5, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1070, parentId: 1000, title: '字典管理', name: 'SystemDicts', path: '/system/dicts', component: 'system/dicts/DictsPage', icon: 'NotepadText', type: 'menu', sort: 6, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1080, parentId: 1000, title: '租户管理', name: 'SystemTenants', path: '/system/tenants', component: 'system/tenants/TenantsPage', icon: 'Building', type: 'menu', sort: 7, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1090, parentId: 1000, title: '租户套餐', name: 'SystemTenantPackages', path: '/system/tenant-packages', component: 'system/tenant-packages/TenantPackagesPage', icon: 'Package', type: 'menu', sort: 7, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // License 授权（与租户套餐同属授权治理；菜单本身是核心能力，受限模式下也必须可达）
  { id: 2660, parentId: 1000, title: 'License 授权', name: 'SystemLicense', path: '/system/license', component: 'system/license/LicensePage', icon: 'KeyRound', type: 'menu', sort: 7, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 1100, parentId: 1000, title: '地区管理', name: 'SystemRegions', path: '/system/regions', component: 'system/regions/RegionsPage', icon: 'MapPin', type: 'menu', sort: 8, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ─── 系统设置（2000 段）
  { id: 1120, parentId: 1000, title: '编号规则', name: 'SystemNumberingRules', path: '/system/numbering-rules', component: 'system/numbering-rules/NumberingRulesPage', icon: 'Hash', type: 'menu', sort: 9, status: 'enabled', visible: true, createdAt: SEED_DATE, updatedAt: SEED_DATE },
];
