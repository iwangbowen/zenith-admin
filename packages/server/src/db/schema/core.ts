import { pgTable, varchar, timestamp, pgEnum, integer, boolean, primaryKey, unique, index, text, jsonb, type AnyPgColumn } from 'drizzle-orm/pg-core';
import type { TenantPackageQuotas } from '@zenith/shared/licensing';
import type { UserGroupMemberRule } from '@zenith/shared/identity';
import { statusEnum, timestampColumns } from './common';

export const menuTypeEnum = pgEnum('menu_type', ['directory', 'menu', 'button']);

export const dataScopeEnum = pgEnum('data_scope', ['all', 'custom', 'dept_only', 'dept', 'self']);

/**
 * 通用审计列：`created_by` / `updated_by` 指向 `users.id`（保留 set null）。
 * 用法：在 pgTable 列定义末尾展开 `...auditColumns()`。
 * 该字段由 db/index.ts 的 Proxy 在 insert/update 时根据审计上下文自动注入，
 * 业务代码无需手填。
 */
export const auditColumns = () => ({
  createdBy: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  updatedBy: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
});

// ─── 租户表 ───────────────────────────────────────────────────────────────────
export const tenants = pgTable('tenants', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull(),
  code: varchar({ length: 50 }).notNull().unique(),
  logo: varchar({ length: 500 }),
  contactName: varchar({ length: 50 }),
  contactPhone: varchar({ length: 20 }),
  status: statusEnum().notNull().default('enabled'),
  expireAt: timestamp({ withTimezone: true }),
  maxUsers: integer(),
  /** 租户套餐（菜单白名单）；为空表示不限制。应用层禁止删除在用套餐，restrict 兜底防 fail-open */
  packageId: integer().references((): AnyPgColumn => tenantPackages.id, { onDelete: 'restrict' }),
  remark: text(),
  ...auditColumns(),
  ...timestampColumns(),
});

export type TenantRow = typeof tenants.$inferSelect;

export type NewTenant = typeof tenants.$inferInsert;

// ─── 租户套餐表 ───────────────────────────────────────────────────────────────
// 套餐 = 一组可授权功能 + 配额。租户绑定套餐即圈定其可用功能范围（SaaS 标配）。
// 菜单可见性由 menus.featureKey 与套餐功能交集派生，不维护菜单 ID 白名单。
export const tenantPackages = pgTable('tenant_packages', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 100 }).notNull().unique(),
  status: statusEnum().notNull().default('enabled'),
  /** 套餐配额（席位等）；与 License / 租户级上限取最小值生效 */
  quotas: jsonb().$type<TenantPackageQuotas>(),
  remark: text(),
  ...auditColumns(),
  ...timestampColumns(),
});

export type TenantPackageRow = typeof tenantPackages.$inferSelect;

export type NewTenantPackage = typeof tenantPackages.$inferInsert;

// ─── 租户套餐-功能关联表（稀疏，只存已分配的功能）──────────────────────────────
export const tenantPackageFeatures = pgTable('tenant_package_features', {
  packageId: integer().notNull().references(() => tenantPackages.id, { onDelete: 'cascade' }),
  featureKey: varchar({ length: 50 }).notNull(),
}, (t) => [primaryKey({ columns: [t.packageId, t.featureKey] })]);

// ─── 部门表 ───────────────────────────────────────────────────────────────────
export const departments = pgTable('departments', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  parentId: integer().notNull().default(0),
  name: varchar({ length: 64 }).notNull(),
  code: varchar({ length: 64 }).notNull(),
  category: varchar({ length: 32 }).notNull().default('department'),
  leaderId: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  phone: varchar({ length: 32 }),
  email: varchar({ length: 128 }),
  sort: integer().notNull().default(0),
  status: statusEnum().notNull().default('enabled'),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('departments_tenant_code_unique').on(t.tenantId, t.code)]);

export type DepartmentRow = typeof departments.$inferSelect;

export type NewDepartment = typeof departments.$inferInsert;

// ─── 岗位表 ───────────────────────────────────────────────────────────────────
export const positions = pgTable('positions', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  code: varchar({ length: 64 }).notNull(),
  sort: integer().notNull().default(0),
  status: statusEnum().notNull().default('enabled'),
  remark: varchar({ length: 256 }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('positions_tenant_code_unique').on(t.tenantId, t.code)]);

export type PositionRow = typeof positions.$inferSelect;

export type NewPosition = typeof positions.$inferInsert;

export const users = pgTable('users', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  username: varchar({ length: 32 }).notNull(),
  nickname: varchar({ length: 32 }).notNull(),
  email: varchar({ length: 128 }),
  password: varchar({ length: 128 }).notNull(),
  avatar: varchar({ length: 256 }),
  phone: varchar({ length: 20 }),
  departmentId: integer().references((): AnyPgColumn => departments.id, { onDelete: 'set null' }),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  gender: varchar({ length: 20 }),
  status: statusEnum().notNull().default('enabled'),
  preferences: jsonb(),
  /** 用户收藏的菜单 ID 列表（有序） */
  favoriteMenus: jsonb().$type<number[]>(),
  userDataScope: dataScopeEnum(),
  passwordUpdatedAt: timestamp().defaultNow().notNull(),
  lastLoginAt: timestamp(),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [
  unique('users_tenant_username_unique').on(t.tenantId, t.username),
  unique('users_tenant_email_unique').on(t.tenantId, t.email),
  unique('users_tenant_phone_unique').on(t.tenantId, t.phone),
  // tenantId 不单独建索引：上面三个 UNIQUE 约束以 tenant_id 为前导列，已覆盖租户过滤。
  // departmentId 无覆盖：工作流按部门解析审批人、公告按部门圈选、部门删除的 set null 级联都扫这一列。
  index('users_department_idx').on(t.departmentId),
]);

export type UserRow = typeof users.$inferSelect;

export type NewUser = typeof users.$inferInsert;

// ─── 菜单表 ───────────────────────────────────────────────────────────────────
export const menus = pgTable('menus', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  parentId: integer().notNull().default(0),
  title: varchar({ length: 64 }).notNull(),
  name: varchar({ length: 64 }),
  path: varchar({ length: 256 }),
  component: varchar({ length: 256 }),
  icon: varchar({ length: 64 }),
  type: menuTypeEnum().notNull().default('menu'),
  permission: varchar({ length: 128 }),
  query: varchar({ length: 512 }),
  isExternal: boolean().notNull().default(false),
  // 外链打开方式：false=新窗口，true=系统内 iframe 内嵌（仅 isExternal=true 时有意义）
  embed: boolean().notNull().default(false),
  // 页面缓存：开启后该页面在多页签模式下切走保留状态（React Activity），关闭页签时释放
  keepAlive: boolean().notNull().default(false),
  sort: integer().notNull().default(0),
  status: statusEnum().notNull().default('enabled'),
  visible: boolean().notNull().default(true),
  /** 所属可授权功能（null = 核心能力）；由功能目录经种子派生，权限解析按套餐/License 功能交集过滤 */
  featureKey: varchar({ length: 50 }),
  ...auditColumns(),
  ...timestampColumns(),
});

export type MenuRow = typeof menus.$inferSelect;

export type NewMenu = typeof menus.$inferInsert;

// ─── 角色表 ───────────────────────────────────────────────────────────────────
export const roles = pgTable('roles', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  code: varchar({ length: 64 }).notNull(),
  description: varchar({ length: 256 }),
  status: statusEnum().notNull().default('enabled'),
  dataScope: dataScopeEnum().notNull().default('all'),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('roles_tenant_code_unique').on(t.tenantId, t.code)]);

export type RoleRow = typeof roles.$inferSelect;

export type NewRole = typeof roles.$inferInsert;

// ─── 用户-角色关联表 ──────────────────────────────────────────────────────────
// 关联表统一补「反向索引」：联合主键只覆盖左前缀（user_id），按右列（role_id）等值查询
// 与父表 ON DELETE CASCADE 触发的子表扫描都无索引可用，行数上来后是顺序扫描。
export const userRoles = pgTable('user_roles', {
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer().notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.roleId] }),
  index('user_roles_role_idx').on(t.roleId),
]);

// ─── 用户-岗位关联表 ──────────────────────────────────────────────────────────
export const userPositions = pgTable('user_positions', {
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  positionId: integer().notNull().references(() => positions.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.positionId] }),
  index('user_positions_position_idx').on(t.positionId),
]);

// ─── 用户组表 ─────────────────────────────────────────────────────────────────
// memberMode 决定成员维护方式：static = 手工维护；dynamic = 按 memberRule 自动
// 物化到 user_group_members（消费方无感知）。动态组的成员接口只读。
export const userGroups = pgTable('user_groups', {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  name: varchar({ length: 64 }).notNull(),
  code: varchar({ length: 64 }).notNull(),
  description: varchar({ length: 256 }),
  ownerId: integer().references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  memberMode: varchar({ length: 10 }).notNull().default('static'),
  /** 动态组成员规则（static 组为 null）；语义见 shared/identity UserGroupMemberRule */
  memberRule: jsonb().$type<UserGroupMemberRule>(),
  /** 动态组最近一次成员同步时间 */
  ruleSyncedAt: timestamp(),
  status: statusEnum().notNull().default('enabled'),
  tenantId: integer().references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  ...timestampColumns(),
}, (t) => [unique('user_groups_tenant_code_unique').on(t.tenantId, t.code)]);

export type UserGroupRow = typeof userGroups.$inferSelect;

export type NewUserGroup = typeof userGroups.$inferInsert;

// ─── 用户-用户组关联表 ────────────────────────────────────────────────────────
export const userGroupMembers = pgTable('user_group_members', {
  groupId: integer().notNull().references(() => userGroups.id, { onDelete: 'cascade' }),
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp().defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.groupId, t.userId] }),
  // 权限解析（lib/permissions.ts）与数据权限（lib/data-scope.ts）都按 user_id 反查用户组，
  // 是全站最热的一条反向查询——主键前导列是 group_id，此处必须单独建索引。
  index('user_group_members_user_idx').on(t.userId),
]);

// ─── 用户组-角色关联表 ────────────────────────────────────────────────────────
// 用户组绑定角色后，组内成员自动继承这些角色的菜单/数据权限（与直接分配角色并集）。
export const userGroupRoles = pgTable('user_group_roles', {
  groupId: integer().notNull().references(() => userGroups.id, { onDelete: 'cascade' }),
  roleId: integer().notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.groupId, t.roleId] }),
  index('user_group_roles_role_idx').on(t.roleId),
]);

// ─── 角色-菜单关联表 ──────────────────────────────────────────────────────────
export const roleMenus = pgTable('role_menus', {
  roleId: integer().notNull().references(() => roles.id, { onDelete: 'cascade' }),
  menuId: integer().notNull().references(() => menus.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.roleId, t.menuId] }),
  index('role_menus_menu_idx').on(t.menuId),
]);

// ─── 角色管理范围（部门）关联表 ───────────────────────────────────────────────
// 用于工作流"角色作为审批人"时，按提交人所在部门 ∩ 角色管理范围过滤实际成员。
// 若一个角色无任何 role_dept_scopes 记录，视为"全员"（向后兼容）。
export const roleDeptScopes = pgTable('role_dept_scopes', {
  roleId: integer().notNull().references(() => roles.id, { onDelete: 'cascade' }),
  deptId: integer().notNull().references((): AnyPgColumn => departments.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.roleId, t.deptId] }),
  index('role_dept_scopes_dept_idx').on(t.deptId),
]);

// ─── 用户-菜单直接授权关联表 ──────────────────────────────────────────────────
export const userMenus = pgTable('user_menus', {
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  menuId: integer().notNull().references(() => menus.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.menuId] }),
  index('user_menus_menu_idx').on(t.menuId),
]);

// ─── 用户数据权限范围（部门）关联表 ───────────────────────────────────────────
export const userDeptScopes = pgTable('user_dept_scopes', {
  userId: integer().notNull().references(() => users.id, { onDelete: 'cascade' }),
  deptId: integer().notNull().references((): AnyPgColumn => departments.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.deptId] }),
  index('user_dept_scopes_dept_idx').on(t.deptId),
]);
