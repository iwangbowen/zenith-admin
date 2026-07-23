import { pgTable, serial, varchar, timestamp, pgEnum, integer, boolean, primaryKey, unique, text, jsonb, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { statusEnum } from './common';

export const menuTypeEnum = pgEnum('menu_type', ['directory', 'menu', 'button']);

export const dataScopeEnum = pgEnum('data_scope', ['all', 'custom', 'dept_only', 'dept', 'self']);

/**
 * 通用审计列：`created_by` / `updated_by` 指向 `users.id`（保留 set null）。
 * 用法：在 pgTable 列定义末尾展开 `...auditColumns()`。
 * 该字段由 db/index.ts 的 Proxy 在 insert/update 时根据审计上下文自动注入，
 * 业务代码无需手填。
 */
export const auditColumns = () => ({
  createdBy: integer('created_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  updatedBy: integer('updated_by').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
});

/** 版本化应用数据迁移记录；与 Drizzle DDL migration 同路径执行，生产无需额外 full seed。 */
export const appDataMigrations = pgTable('app_data_migrations', {
  key: varchar('key', { length: 128 }).primaryKey(),
  description: varchar('description', { length: 500 }).notNull(),
  appliedAt: timestamp('applied_at').defaultNow().notNull(),
});

// ─── 租户表 ───────────────────────────────────────────────────────────────────
export const tenants = pgTable('tenants', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  code: varchar('code', { length: 50 }).notNull().unique(),
  logo: varchar('logo', { length: 500 }),
  contactName: varchar('contact_name', { length: 50 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  status: statusEnum('status').notNull().default('enabled'),
  expireAt: timestamp('expire_at', { withTimezone: true }),
  maxUsers: integer('max_users'),
  /** 租户套餐（菜单白名单）；为空表示不限制。应用层禁止删除在用套餐，restrict 兜底防 fail-open */
  packageId: integer('package_id').references((): AnyPgColumn => tenantPackages.id, { onDelete: 'restrict' }),
  remark: text('remark'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type TenantRow = typeof tenants.$inferSelect;

export type NewTenant = typeof tenants.$inferInsert;

// ─── 租户套餐表 ───────────────────────────────────────────────────────────────
// 套餐 = 一组菜单白名单。租户绑定套餐即圈定其可用功能范围（SaaS 标配）。
export const tenantPackages = pgTable('tenant_packages', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull().unique(),
  status: statusEnum('status').notNull().default('enabled'),
  remark: text('remark'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type TenantPackageRow = typeof tenantPackages.$inferSelect;

export type NewTenantPackage = typeof tenantPackages.$inferInsert;

// ─── 租户套餐-菜单关联表 ──────────────────────────────────────────────────────
export const tenantPackageMenus = pgTable('tenant_package_menus', {
  packageId: integer('package_id').notNull().references(() => tenantPackages.id, { onDelete: 'cascade' }),
  menuId: integer('menu_id').notNull().references((): AnyPgColumn => menus.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.packageId, t.menuId] })]);

// ─── 部门表 ───────────────────────────────────────────────────────────────────
export const departments = pgTable('departments', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id').notNull().default(0),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  category: varchar('category', { length: 32 }).notNull().default('department'),
  leaderId: integer('leader_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  phone: varchar('phone', { length: 32 }),
  email: varchar('email', { length: 128 }),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('departments_tenant_code_unique').on(t.tenantId, t.code)]);

export type DepartmentRow = typeof departments.$inferSelect;

export type NewDepartment = typeof departments.$inferInsert;

// ─── 岗位表 ───────────────────────────────────────────────────────────────────
export const positions = pgTable('positions', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  remark: varchar('remark', { length: 256 }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('positions_tenant_code_unique').on(t.tenantId, t.code)]);

export type PositionRow = typeof positions.$inferSelect;

export type NewPosition = typeof positions.$inferInsert;

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 32 }).notNull(),
  nickname: varchar('nickname', { length: 32 }).notNull(),
  email: varchar('email', { length: 128 }),
  password: varchar('password', { length: 128 }).notNull(),
  avatar: varchar('avatar', { length: 256 }),
  phone: varchar('phone', { length: 20 }),
  departmentId: integer('department_id').references((): AnyPgColumn => departments.id, { onDelete: 'set null' }),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  gender: varchar('gender', { length: 20 }),
  status: statusEnum('status').notNull().default('enabled'),
  preferences: jsonb('preferences'),
  /** 用户收藏的菜单 ID 列表（有序） */
  favoriteMenus: jsonb('favorite_menus').$type<number[]>(),
  userDataScope: dataScopeEnum('user_data_scope'),
  passwordUpdatedAt: timestamp('password_updated_at').defaultNow().notNull(),
  lastLoginAt: timestamp('last_login_at'),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [
  unique('users_tenant_username_unique').on(t.tenantId, t.username),
  unique('users_tenant_email_unique').on(t.tenantId, t.email),
  unique('users_tenant_phone_unique').on(t.tenantId, t.phone),
]);

export type UserRow = typeof users.$inferSelect;

export type NewUser = typeof users.$inferInsert;

// ─── 菜单表 ───────────────────────────────────────────────────────────────────
export const menus = pgTable('menus', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id').notNull().default(0),
  title: varchar('title', { length: 64 }).notNull(),
  name: varchar('name', { length: 64 }),
  path: varchar('path', { length: 256 }),
  component: varchar('component', { length: 256 }),
  icon: varchar('icon', { length: 64 }),
  type: menuTypeEnum('type').notNull().default('menu'),
  permission: varchar('permission', { length: 128 }),
  query: varchar('query', { length: 512 }),
  isExternal: boolean('is_external').notNull().default(false),
  // 外链打开方式：false=新窗口，true=系统内 iframe 内嵌（仅 isExternal=true 时有意义）
  embed: boolean('embed').notNull().default(false),
  // 页面缓存：开启后该页面在多页签模式下切走保留状态（React Activity），关闭页签时释放
  keepAlive: boolean('keep_alive').notNull().default(false),
  sort: integer('sort').notNull().default(0),
  status: statusEnum('status').notNull().default('enabled'),
  visible: boolean('visible').notNull().default(true),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
});

export type MenuRow = typeof menus.$inferSelect;

export type NewMenu = typeof menus.$inferInsert;

// ─── 角色表 ───────────────────────────────────────────────────────────────────
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  description: varchar('description', { length: 256 }),
  status: statusEnum('status').notNull().default('enabled'),
  dataScope: dataScopeEnum('data_scope').notNull().default('all'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('roles_tenant_code_unique').on(t.tenantId, t.code)]);

export type RoleRow = typeof roles.$inferSelect;

export type NewRole = typeof roles.$inferInsert;

// ─── 用户-角色关联表 ──────────────────────────────────────────────────────────
export const userRoles = pgTable('user_roles', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.roleId] })]);

// ─── 用户-岗位关联表 ──────────────────────────────────────────────────────────
export const userPositions = pgTable('user_positions', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  positionId: integer('position_id').notNull().references(() => positions.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.positionId] })]);

// ─── 用户组表 ─────────────────────────────────────────────────────────────────
export const userGroups = pgTable('user_groups', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  code: varchar('code', { length: 64 }).notNull(),
  description: varchar('description', { length: 256 }),
  ownerId: integer('owner_id').references((): AnyPgColumn => users.id, { onDelete: 'set null' }),
  departmentId: integer('department_id').references((): AnyPgColumn => departments.id, { onDelete: 'set null' }),
  status: statusEnum('status').notNull().default('enabled'),
  tenantId: integer('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  ...auditColumns(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, (t) => [unique('user_groups_tenant_code_unique').on(t.tenantId, t.code)]);

export type UserGroupRow = typeof userGroups.$inferSelect;

export type NewUserGroup = typeof userGroups.$inferInsert;

// ─── 用户-用户组关联表 ────────────────────────────────────────────────────────
export const userGroupMembers = pgTable('user_group_members', {
  groupId: integer('group_id').notNull().references(() => userGroups.id, { onDelete: 'cascade' }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.groupId, t.userId] })]);

// ─── 用户组-角色关联表 ────────────────────────────────────────────────────────
// 用户组绑定角色后，组内成员自动继承这些角色的菜单/数据权限（与直接分配角色并集）。
export const userGroupRoles = pgTable('user_group_roles', {
  groupId: integer('group_id').notNull().references(() => userGroups.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.groupId, t.roleId] })]);

// ─── 角色-菜单关联表 ──────────────────────────────────────────────────────────
export const roleMenus = pgTable('role_menus', {
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  menuId: integer('menu_id').notNull().references(() => menus.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.roleId, t.menuId] })]);

// ─── 角色管理范围（部门）关联表 ───────────────────────────────────────────────
// 用于工作流"角色作为审批人"时，按提交人所在部门 ∩ 角色管理范围过滤实际成员。
// 若一个角色无任何 role_dept_scopes 记录，视为"全员"（向后兼容）。
export const roleDeptScopes = pgTable('role_dept_scopes', {
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  deptId: integer('dept_id').notNull().references((): AnyPgColumn => departments.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.roleId, t.deptId] })]);

// ─── 用户-菜单直接授权关联表 ──────────────────────────────────────────────────
export const userMenus = pgTable('user_menus', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  menuId: integer('menu_id').notNull().references(() => menus.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.menuId] })]);

// ─── 用户数据权限范围（部门）关联表 ───────────────────────────────────────────
export const userDeptScopes = pgTable('user_dept_scopes', {
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deptId: integer('dept_id').notNull().references((): AnyPgColumn => departments.id, { onDelete: 'cascade' }),
}, (t) => [primaryKey({ columns: [t.userId, t.deptId] })]);
