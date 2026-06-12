/**
 * 种子数据 — 唯一来源
 *
 * 此文件同时被：
 *  - packages/server/src/db/seed.ts  （数据库初始化）
 *  - packages/web/src/mocks/data/*   （MSW Demo 模式 mock）
 *
 * 修改数据时只需改这一处，两端自动同步。
 */

import type { Menu, Role, Department, Position, Dict, DictItem, SystemConfig, CronJob } from './types';

const SEED_DATE = '2024-01-01 00:00:00';

// ─── 菜单 ─────────────────────────────────────────────────────────────────────

export const SEED_MENUS: Menu[] = [
  { id: 1,  parentId: 0,  title: '首页',       name: 'Dashboard',           path: '/',                          component: 'dashboard/DashboardPage',                        icon: 'Home',              type: 'menu',      sort: 1,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2,  parentId: 0,  title: '系统管理',   name: 'System',              path: undefined,                    component: undefined,                                        icon: 'Settings',          type: 'directory', sort: 2,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3,  parentId: 2,  title: '用户管理',   name: 'SystemUsers',         path: '/system/users',              component: 'users/UsersPage',                                icon: 'UsersRound',        type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:user:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 10, parentId: 3,  title: '新增用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:user:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 11, parentId: 3,  title: '编辑用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:user:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 12, parentId: 3,  title: '删除用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:user:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 44, parentId: 3,  title: '导入用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:user:import',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 36, parentId: 2,  title: '部门管理',   name: 'SystemDepartments',   path: '/system/departments',        component: 'system/departments/DepartmentsPage',             icon: 'Building2',         type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:department:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 37, parentId: 36, title: '新增部门',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:department:create',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 38, parentId: 36, title: '编辑部门',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:department:update',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 39, parentId: 36, title: '删除部门',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:department:delete',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 40, parentId: 2,  title: '岗位管理',   name: 'SystemPositions',     path: '/system/positions',          component: 'system/positions/PositionsPage',                 icon: 'BriefcaseBusiness', type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'system:position:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 41, parentId: 40, title: '新增岗位',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:position:create',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 42, parentId: 40, title: '编辑岗位',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:position:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 43, parentId: 40, title: '删除岗位',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:position:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 240, parentId: 2,  title: '用户组',     name: 'SystemUserGroups',    path: '/system/user-groups',        component: 'system/user-groups/UserGroupsPage',              icon: 'Users',             type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'system:user-groups:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 241, parentId: 240, title: '新增用户组', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:user-groups:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 242, parentId: 240, title: '编辑用户组', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:user-groups:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 243, parentId: 240, title: '删除用户组', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:user-groups:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 244, parentId: 240, title: '分配成员',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:user-groups:assign',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4,  parentId: 2,  title: '菜单管理',   name: 'SystemMenus',         path: '/system/menus',              component: 'system/menus/MenusPage',                         icon: 'LayoutList',        type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'system:menu:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 13, parentId: 4,  title: '新增菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:menu:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 14, parentId: 4,  title: '编辑菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:menu:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 15, parentId: 4,  title: '删除菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:menu:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5,  parentId: 2,  title: '角色管理',   name: 'SystemRoles',         path: '/system/roles',              component: 'system/roles/RolesPage',                         icon: 'ShieldCheck',       type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'system:role:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 16, parentId: 5,  title: '新增角色',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:role:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 17, parentId: 5,  title: '编辑角色',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:role:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 18, parentId: 5,  title: '删除角色',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:role:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19, parentId: 5,  title: '分配菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:role:assign',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6,  parentId: 2,  title: '字典管理',   name: 'SystemDicts',         path: '/system/dicts',              component: 'system/dicts/DictsPage',                         icon: 'NotepadText',       type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'system:dict:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 20, parentId: 6,  title: '新增字典',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:dict:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 21, parentId: 6,  title: '编辑字典',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:dict:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 22, parentId: 6,  title: '删除字典',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:dict:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 23, parentId: 6,  title: '管理字典项', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:dict:item',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 210, parentId: 2,  title: '租户管理',   name: 'SystemTenants',       path: '/system/tenants',            component: 'system/tenants/TenantsPage',                     icon: 'Building',          type: 'menu',      sort: 7,  status: 'enabled', visible: true,  permission: 'system:tenant:list',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 211, parentId: 210, title: '新增租户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:tenant:create',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 212, parentId: 210, title: '编辑租户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:tenant:update',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 213, parentId: 210, title: '删除租户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:tenant:delete',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 100, parentId: 2, title: '地区管理',  name: 'SystemRegions',       path: '/system/regions',            component: 'system/regions/RegionsPage',                     icon: 'MapPin',            type: 'menu',      sort: 8,  status: 'enabled', visible: true,  permission: 'system:region:list',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 101, parentId: 100, title: '新增地区', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:region:create',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 102, parentId: 100, title: '编辑地区', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:region:update',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 103, parentId: 100, title: '删除地区', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:region:delete',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 104, parentId: 100, title: '导出地区', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:region:export',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 200, parentId: 0, title: '系统设置',   name: 'SystemSettings',      path: undefined,                    component: undefined,                                        icon: 'Settings2',         type: 'directory', sort: 3,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 50, parentId: 200, title: '系统配置',   name: 'SystemConfigs',       path: '/system/configs',            component: 'system/configs/SystemConfigsPage',               icon: 'SlidersHorizontal', type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:config:list',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 51, parentId: 50, title: '新增配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:config:create',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 52, parentId: 50, title: '编辑配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:config:update',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 53, parentId: 50, title: '删除配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:config:delete',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 115, parentId: 200, title: 'OAuth配置',   name: 'SystemOAuthConfig',  path: '/system/oauth-config',       component: 'system/oauth-config/OAuthConfigPage',            icon: 'KeyRound',          type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'system:oauth-config:view',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 116, parentId: 115, title: '保存配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:oauth-config:update',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8,  parentId: 200, title: '文件管理',   name: 'SystemFiles',         path: undefined,                    component: undefined,                                        icon: 'FolderOpen',        type: 'directory', sort: 4,  status: 'enabled', visible: true,  permission: 'system:file:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 24, parentId: 8,  title: '文件配置',   name: 'SystemFileConfigs',   path: '/system/file-configs',       component: 'system/file-configs/FileStorageConfigsPage',     icon: 'HardDriveUpload',   type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:file:config',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 25, parentId: 8,  title: '文件列表',   name: 'SystemFileList',      path: '/system/files',              component: 'system/files/FilesPage',                         icon: 'Files',             type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:file:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 26, parentId: 24, title: '新增配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:file:config:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 27, parentId: 24, title: '编辑配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:file:config:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 28, parentId: 24, title: '删除配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:file:config:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 29, parentId: 24, title: '设为默认',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:file:config:default',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 30, parentId: 25, title: '上传文件',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:file:upload',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 31, parentId: 25, title: '删除文件',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:file:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 9,  parentId: 200, title: '服务监控',   name: 'SystemMonitor',       path: '/system/monitor',            component: 'system/monitor/MonitorPage',                     icon: 'Activity',          type: 'menu',      sort: 5,  status: 'enabled', visible: true,  permission: 'system:monitor:view',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 54, parentId: 200, title: '在线用户',   name: 'SystemSessions',      path: '/system/sessions',           component: 'system/sessions/OnlineSessionsPage',             icon: 'MonitorSmartphone', type: 'menu',      sort: 6,  status: 'enabled', visible: true,  permission: 'system:session:list',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 55, parentId: 54, title: '强制下线',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:session:forceLogout',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 56, parentId: 200, title: '定时任务',   name: 'SystemCronJobs',      path: '/system/cron-jobs',          component: 'system/cron-jobs/CronJobsPage',                  icon: 'Clock',             type: 'menu',      sort: 7,  status: 'enabled', visible: true,  permission: 'system:cronjob:list',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 57, parentId: 56, title: '新增任务',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:cronjob:create',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 58, parentId: 56, title: '编辑任务',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:cronjob:update',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 59, parentId: 56, title: '删除任务',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:cronjob:delete',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 60, parentId: 56, title: '立即执行',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:cronjob:execute',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 120, parentId: 200, title: '数据库备份', name: 'SystemDbBackups',     path: '/system/db-backups',         component: 'system/db-backups/DbBackupsPage',                icon: 'DatabaseBackup',    type: 'menu',      sort: 8,  status: 'enabled', visible: true,  permission: 'system:db-backup:list',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 121, parentId: 120, title: '创建备份',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:db-backup:create',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 123, parentId: 120, title: '删除备份',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:db-backup:delete',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 129, parentId: 200, title: '数据库管理', name: 'SystemDbAdmin',       path: '/system/db-admin',           component: 'system/db-admin/DbAdminPage',                    icon: 'Database',          type: 'menu',      sort: 16, status: 'enabled', visible: true,  permission: 'system:db-admin:view',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 130, parentId: 129, title: '执行 SQL',  name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:db-admin:query',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 131, parentId: 129, title: '导出结果',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:db-admin:export',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 132, parentId: 129, title: '修改数据',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:db-admin:write',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 470, parentId: 200, title: '数据脱敏',   name: 'SystemDataMask',      path: '/system/data-mask',          component: 'system/data-mask/DataMaskPage',                  icon: 'EyeOff',            type: 'menu',      sort: 17, status: 'enabled', visible: true,  permission: 'system:data-mask:list',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 471, parentId: 470, title: '新增规则',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:data-mask:create',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 472, parentId: 470, title: '编辑规则',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:data-mask:update',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 473, parentId: 470, title: '删除规则',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:data-mask:delete',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 480, parentId: 200, title: 'OAuth2 应用', name: 'SystemOAuth2Apps',   path: '/system/oauth2-apps',        component: 'system/oauth2-apps/OAuth2AppsPage',              icon: 'KeyRound',          type: 'menu',      sort: 18, status: 'enabled', visible: true,  permission: 'system:oauth2-apps:view',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 481, parentId: 480, title: '管理应用',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:oauth2-apps:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 490, parentId: 200, title: '维护模式',   name: 'SystemMaintenance',   path: '/system/maintenance',        component: 'system/maintenance/MaintenancePage',             icon: 'Wrench',            type: 'menu',      sort: 19, status: 'enabled', visible: true,  permission: 'system:maintenance:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 491, parentId: 490, title: '开启/关闭',  name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:maintenance:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ── 系统运维 ──────────────────────────────────────────────────────────────────
  { id: 500, parentId: 200, title: '系统运维',   name: 'SystemOps',           path: undefined,                    component: undefined,                                        icon: 'Terminal',          type: 'directory', sort: 20, status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 501, parentId: 500, title: 'Web 终端',   name: 'SystemTerminal',      path: '/system/terminal',           component: 'system/terminal/TerminalPage',                   icon: 'TerminalSquare',    type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:terminal:execute',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 502, parentId: 501, title: '执行终端',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:terminal:execute',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 503, parentId: 500, title: '终端录屏',   name: 'TerminalRecordings',  path: '/system/terminal/recordings',component: 'system/terminal/TerminalRecordingsPage',         icon: 'Video',             type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:terminal:execute',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 504, parentId: 500, title: '文件管理器', name: 'SystemFileManager',   path: '/system/file-manager',       component: 'system/file-manager/FileManagerPage',            icon: 'HardDrive',         type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'system:terminal:execute',      createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 482, parentId: 480, title: '管理应用',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:oauth2-apps:manage',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 34, parentId: 200, title: '审计日志',   name: 'SystemAuditLogs',     path: undefined,                    component: undefined,                                        icon: 'ClipboardMinus',    type: 'directory', sort: 9,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 32, parentId: 34, title: '登录日志',   name: 'SystemLoginLogs',     path: '/system/login-logs',         component: 'system/login-logs/LoginLogsPage',                icon: 'List',              type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:log:login',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 33, parentId: 34, title: '操作日志',   name: 'SystemOperationLogs', path: '/system/operation-logs',     component: 'system/operation-logs/OperationLogsPage',        icon: 'ClipboardList',     type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:log:operation',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 303, parentId: 34, title: '日志文件',  name: 'SystemLogFiles',      path: '/system/log-files',          component: 'system/log-files/LogFilesPage',                  icon: 'FileText',          type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'system:log:files',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 304, parentId: 303, title: '查看日志', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:log:files',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 305, parentId: 303, title: '下载日志', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:log:files:download',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 306, parentId: 303, title: '删除日志', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:log:files:delete',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 35, parentId: 200, title: '公告管理',   name: 'SystemAnnouncements', path: '/system/announcements',      component: 'system/announcements/AnnouncementsPage',         icon: 'Megaphone',         type: 'menu',      sort: 10, status: 'enabled', visible: true,  permission: 'system:announcement:list',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 61, parentId: 35, title: '新增公告',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:announcement:create',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 62, parentId: 35, title: '编辑公告',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:announcement:update',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 63, parentId: 35, title: '删除公告',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:announcement:delete',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // ── 内置隐藏菜单（不显示在侧边栏，供面包屑/标签页标题使用）──────────────────────────────
  { id: 202, parentId: 0, title: '个人中心',   name: 'Profile',             path: '/profile',                   component: 'profile/ProfilePage',                            icon: 'UserRound',         type: 'menu',      sort: 99, status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 203, parentId: 0, title: '公告中心',   name: 'Announcements',       path: '/announcements',             component: 'announcements/AnnouncementsPage',                icon: 'Megaphone',         type: 'menu',      sort: 100, status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 204, parentId: 0, title: '我的消息',   name: 'Inbox',               path: '/inbox',                     component: 'inbox/InboxPage',                                icon: 'Inbox',             type: 'menu',      sort: 101, status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 125, parentId: 200, title: 'IP访问控制', name: 'SystemIpAccess',      path: '/system/ip-access',          component: 'system/ip-access/IpAccessPage',                  icon: 'ShieldBan',         type: 'menu',      sort: 11, status: 'enabled', visible: true,  permission: 'system:ip-access:view',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 126, parentId: 125, title: '保存配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:ip-access:update',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 133, parentId: 125, title: '查看拦截日志', name: undefined,           path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:ip-access:log',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 127, parentId: 200, title: '缓存管理',   name: 'SystemCache',         path: '/system/cache',              component: 'system/cache/CacheManagePage',                   icon: 'BrainCircuit',      type: 'menu',      sort: 12, status: 'enabled', visible: true,  permission: 'system:cache:list',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 128, parentId: 127, title: '删除缓存',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:cache:delete',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // ── 通知管理（邮件 / 短信 / 站内信）─────────────────────────────────────────
  { id: 400, parentId: 200, title: '通知管理',     name: 'SystemNotification',   path: undefined,                       component: undefined,                                                icon: 'BellRing',          type: 'directory', sort: 13, status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 邮件管理
  { id: 410, parentId: 400, title: '邮件管理',     name: 'NotificationEmail',    path: undefined,                       component: undefined,                                                icon: 'Mail',              type: 'directory', sort: 1,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 411, parentId: 410, title: '邮件配置',     name: 'NotificationEmailConfig', path: '/system/email-config',       component: 'system/email-config/EmailConfigPage',                    icon: 'MailCheck',         type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:email-config:view',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 412, parentId: 411, title: '保存配置',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:email-config:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 413, parentId: 411, title: '测试邮件',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:email-config:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 415, parentId: 410, title: '邮件模板',     name: 'NotificationEmailTemplates', path: '/system/email-templates', component: 'system/email-templates/EmailTemplatesPage',              icon: 'MailPlus',          type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:email-template:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 416, parentId: 415, title: '新增模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:email-template:create',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 417, parentId: 415, title: '编辑模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:email-template:update',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 418, parentId: 415, title: '删除模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:email-template:delete',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 420, parentId: 410, title: '邮件发送记录', name: 'NotificationEmailSendLogs', path: '/system/email-send-logs',  component: 'system/email-send-logs/EmailSendLogsPage',               icon: 'MailX',             type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'system:email-send-log:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 421, parentId: 420, title: '删除记录',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:email-send-log:delete',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 422, parentId: 420, title: '导出记录',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:email-send-log:export',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 短信管理
  { id: 430, parentId: 400, title: '短信管理',     name: 'NotificationSms',      path: undefined,                       component: undefined,                                                icon: 'MessageSquareText', type: 'directory', sort: 2,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 431, parentId: 430, title: '短信配置',     name: 'NotificationSmsConfigs', path: '/system/sms-configs',         component: 'system/sms-configs/SmsConfigsPage',                      icon: 'Smartphone',        type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:sms-config:list',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 432, parentId: 431, title: '新增配置',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:sms-config:create',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 433, parentId: 431, title: '编辑配置',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:sms-config:update',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 434, parentId: 431, title: '删除配置',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:sms-config:delete',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 435, parentId: 431, title: '设为默认',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'system:sms-config:default',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 437, parentId: 430, title: '短信模板',     name: 'NotificationSmsTemplates', path: '/system/sms-templates',     component: 'system/sms-templates/SmsTemplatesPage',                  icon: 'MessageSquarePlus', type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:sms-template:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 438, parentId: 437, title: '新增模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:sms-template:create',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 439, parentId: 437, title: '编辑模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:sms-template:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 440, parentId: 437, title: '删除模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:sms-template:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 442, parentId: 430, title: '短信发送记录', name: 'NotificationSmsSendLogs', path: '/system/sms-send-logs',     component: 'system/sms-send-logs/SmsSendLogsPage',                   icon: 'MessageSquareX',    type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'system:sms-send-log:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 443, parentId: 442, title: '测试发送',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:sms-send-log:test',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 444, parentId: 442, title: '删除记录',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:sms-send-log:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 445, parentId: 442, title: '导出记录',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:sms-send-log:export',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 站内信管理
  { id: 450, parentId: 400, title: '站内信管理',   name: 'NotificationInApp',    path: undefined,                       component: undefined,                                                icon: 'Inbox',             type: 'directory', sort: 3,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 451, parentId: 450, title: '站内信模板',   name: 'NotificationInAppTemplates', path: '/system/in-app-templates', component: 'system/in-app-templates/InAppTemplatesPage',           icon: 'Newspaper',         type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'system:in-app-template:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 452, parentId: 451, title: '新增模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:in-app-template:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 453, parentId: 451, title: '编辑模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:in-app-template:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 454, parentId: 451, title: '删除模板',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:in-app-template:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 456, parentId: 450, title: '收件记录',     name: 'NotificationInAppMessages', path: '/system/in-app-messages',  component: 'system/in-app-messages/InAppMessagesPage',               icon: 'MailOpen',          type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'system:in-app-message:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 457, parentId: 456, title: '标记已读',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:in-app-message:read',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 458, parentId: 456, title: '删除记录',     name: undefined,              path: undefined,                       component: undefined,                                                icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:in-app-message:delete',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 311, parentId: 200, title: '标签管理',   name: 'SystemTags',          path: '/system/tags',               component: 'system/tags/TagsPage',                           icon: 'Tags',              type: 'menu',      sort: 14, status: 'enabled', visible: true,  permission: 'system:tag:list',              createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 312, parentId: 311, title: '新增标签',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:tag:create',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 313, parentId: 311, title: '编辑标签',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:tag:update',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 314, parentId: 311, title: '删除标签',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'system:tag:delete',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 320, parentId: 200, title: '接口限流',   name: 'SystemRateLimit',     path: '/system/rate-limit',         component: 'system/rate-limit/RateLimitPage',                icon: 'Gauge',             type: 'menu',      sort: 15, status: 'enabled', visible: true,  permission: 'system:rate-limit:view',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 321, parentId: 320, title: '编辑规则',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'system:rate-limit:manage',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 322, parentId: 320, title: '解封/重置', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'system:rate-limit:manage',     createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ── 工作流引擎 ────────────────────────────────────────────────────────────────────────────────
  // ── 智能助手 ─────────────────────────────────────────────────────────────────────────────────
  { id: 300, parentId: 0,   title: '智能助手',    name: 'AiFeatures',              path: undefined,                    component: undefined,                                        icon: 'Sparkles',          type: 'directory', sort: 5,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 301, parentId: 300, title: '智能对话',    name: 'AiChat',                  path: '/ai/chat',                   component: 'ai/chat/AIChatPage',                             icon: 'MessageSquare',     type: 'menu',      sort: 1,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 302, parentId: 300, title: 'AI 服务商',  name: 'AiProviders',             path: '/ai/providers',              component: 'ai/providers/AIProvidersPage',                   icon: 'Cpu',               type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'ai:provider:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 492, parentId: 300, title: 'AI 反馈',    name: 'AiFeedback',              path: '/ai/feedback',               component: 'ai/feedback/AiFeedbackPage',                     icon: 'ThumbsUp',          type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'ai:feedback:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 463, parentId: 302, title: '新增',        name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'ai:provider:create',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 464, parentId: 302, title: '编辑',        name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'ai:provider:edit',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 465, parentId: 302, title: '删除',        name: undefined,                 path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'ai:provider:delete',  createdAt: SEED_DATE, updatedAt: SEED_DATE },

  { id: 230, parentId: 0,   title: '工作流引擎', name: 'Workflow',                path: undefined,                    component: undefined,                                        icon: 'GitFork',           type: 'directory', sort: 6,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 231, parentId: 230, title: '流程定义',   name: 'WorkflowDefinitions',    path: '/workflow/definitions',       component: 'workflow/definitions/WorkflowDefinitionsPage',   icon: 'Workflow',          type: 'menu',      sort: 1,  status: 'enabled', visible: true,  permission: 'workflow:definition:list',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 232, parentId: 231, title: '新建流程',   name: undefined,                path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'enabled', visible: true,  permission: 'workflow:definition:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 233, parentId: 231, title: '编辑流程',   name: undefined,                path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'enabled', visible: true,  permission: 'workflow:definition:edit',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 234, parentId: 231, title: '删除流程',   name: undefined,                path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'enabled', visible: true,  permission: 'workflow:definition:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 235, parentId: 231, title: '发布/禁用',  name: undefined,                path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'enabled', visible: true,  permission: 'workflow:definition:publish',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 238, parentId: 231, title: '流程设计',   name: 'WorkflowDesigner',       path: '/workflow/designer',          component: 'workflow/definitions/WorkflowDesignerPage',      icon: undefined,           type: 'menu',      sort: 5,  status: 'enabled', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 236, parentId: 230, title: '我的申请',   name: 'MyApplications',         path: '/workflow/applications',     component: 'workflow/instances/MyApplicationsPage',          icon: 'FilePlus2',         type: 'menu',      sort: 2,  status: 'enabled', visible: true,  permission: 'workflow:instance:create',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 237, parentId: 230, title: '待我审批',   name: 'PendingApprovals',       path: '/workflow/pending',          component: 'workflow/tasks/PendingApprovalsPage',            icon: 'ClipboardCheck',    type: 'menu',      sort: 3,  status: 'enabled', visible: true,  permission: 'workflow:task:handle',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 239, parentId: 230, title: '流程监控',   name: 'WorkflowMonitor',         path: '/workflow/monitor',           component: 'workflow/monitor/WorkflowMonitorPage',            icon: 'BarChart2',         type: 'menu',      sort: 4,  status: 'enabled', visible: true,  permission: 'workflow:instance:monitor',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 460, parentId: 230, title: '事件订阅',   name: 'WorkflowEventSubscriptions', path: '/workflow/event-subscriptions', component: 'workflow/event-subscriptions/WorkflowEventSubscriptionsPage', icon: 'Webhook', type: 'menu', sort: 6,  status: 'enabled', visible: true,  permission: 'workflow:event-subscription:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 461, parentId: 230, title: '触发器执行', name: 'WorkflowTriggerExecutions', path: '/workflow/trigger-executions', component: 'workflow/trigger-executions/WorkflowTriggerExecutionsPage', icon: 'Zap', type: 'menu', sort: 7,  status: 'enabled', visible: true,  permission: 'workflow:trigger-execution:view', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 462, parentId: 230, title: '流程自动化', name: 'WorkflowAutomations', path: '/workflow/automations', component: 'workflow/automations/WorkflowAutomationsPage', icon: 'Bot', type: 'menu', sort: 8,  status: 'enabled', visible: true,  permission: 'workflow:definition:list', createdAt: SEED_DATE, updatedAt: SEED_DATE },

  // ── 消息中心 ─────────────────────────────────────────────────────────────────
  { id: 310, parentId: 0,   title: '消息中心',   name: 'ChatCenter',              path: '/chat',                      component: 'chat/ChatPage',                                  icon: 'MessagesSquare',    type: 'menu',      sort: 7,  status: 'enabled', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 角色 ─────────────────────────────────────────────────────────────────────

export const SEED_ROLES: Role[] = [
  {
    id: 1,
    name: '超级管理员',
    code: 'super_admin',
    description: '拥有所有权限',
    dataScope: 'all',
    status: 'enabled',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
    menuIds: SEED_MENUS.map((m) => m.id),
  },
  {
    id: 2,
    name: '普通用户',
    code: 'user',
    description: '基础访问权限',
    dataScope: 'all',
    status: 'enabled',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
    menuIds: [1, 202, 203, 310],
  },
];

// ─── 部门 ─────────────────────────────────────────────────────────────────────

export const SEED_DEPARTMENTS: Department[] = [
  { id: 1, parentId: 0, name: '总部',  code: 'headquarters', category: 'company', leaderId: 1, phone: '13800000000', email: 'admin@zenith.dev', sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, parentId: 1, name: '技术部', code: 'technology',   category: 'department', leaderId: 1, phone: '13800000001', email: 'tech@zenith.dev',  sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 岗位 ─────────────────────────────────────────────────────────────────────

export const SEED_POSITIONS: Position[] = [
  { id: 1, name: '系统管理员', code: 'system_admin', sort: 1, status: 'enabled', remark: '默认管理员岗位', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '开发工程师', code: 'developer',    sort: 2, status: 'enabled', remark: '默认技术岗位',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 字典 ─────────────────────────────────────────────────────────────────────

export const SEED_DICTS: Dict[] = [
  { id: 1, name: '通用状态',     code: 'common_status',         description: '通用启用/禁用状态',  status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '菜单类型',     code: 'menu_type',             description: '菜单节点类型',       status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, name: '用户性别',     code: 'user_gender',           description: '用户性别',           status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, name: '显示状态',     code: 'menu_visible',          description: '菜单显示/隐藏状态',  status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6, name: '公告类型',     code: 'announcement_type',           description: '公告类型',       status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7, name: '公告发布状态', code: 'announcement_publish_status', description: '公告的发布状态', status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8, name: '公告优先级',   code: 'announcement_priority',       description: '公告优先级',     status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 9, name: '系统配置类型', code: 'system_config_type',    description: '系统配置项值类型',   status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 10, name: '部门类别',   code: 'department_category',   description: '部门类别',           status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 字典项 ───────────────────────────────────────────────────────────────────

export const SEED_DICT_ITEMS: DictItem[] = [
  // 通用状态 (dictId: 1)
  { id: 1,  dictId: 1, label: '启用',   value: 'enabled',      color: 'green',  sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2,  dictId: 1, label: '禁用',   value: 'disabled',     color: 'grey',   sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 菜单类型 (dictId: 3)
  { id: 3,  dictId: 3, label: '目录',   value: 'directory',    color: 'blue',   sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4,  dictId: 3, label: '菜单',   value: 'menu',         color: 'green',  sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5,  dictId: 3, label: '按钮',   value: 'button',       color: 'orange', sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 用户性别 (dictId: 4)
  { id: 6,  dictId: 4, label: '男',     value: 'male',         color: 'blue',   sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7,  dictId: 4, label: '女',     value: 'female',       color: 'pink',   sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8,  dictId: 4, label: '保密',   value: 'secret',       color: 'grey',   sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 显示状态 (dictId: 5)
  { id: 9,  dictId: 5, label: '显示',   value: 'show',         color: 'green',  sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 10, dictId: 5, label: '隐藏',   value: 'hidden',       color: 'grey',   sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 公告类型 (dictId: 6)
  { id: 11, dictId: 6, label: '通知',   value: 'notice',       color: 'blue',   sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 12, dictId: 6, label: '公告',   value: 'announcement', color: 'cyan',   sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 13, dictId: 6, label: '警告',   value: 'warning',      color: 'orange', sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 公告发布状态 (dictId: 7)
  { id: 14, dictId: 7, label: '草稿',   value: 'draft',        color: 'grey',   sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 15, dictId: 7, label: '已发布', value: 'published',    color: 'green',  sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 16, dictId: 7, label: '已撤回', value: 'recalled',     color: 'orange', sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 公告优先级 (dictId: 8)
  { id: 17, dictId: 8, label: '低',     value: 'low',          color: 'grey',   sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 18, dictId: 8, label: '中',     value: 'medium',       color: 'blue',   sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19, dictId: 8, label: '高',     value: 'high',         color: 'red',    sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 系统配置类型 (dictId: 9)
  { id: 20, dictId: 9, label: '字符串', value: 'string',       color: 'blue',   sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 21, dictId: 9, label: '数字',   value: 'number',       color: 'green',  sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 22, dictId: 9, label: '布尔值', value: 'boolean',      color: 'orange', sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 23, dictId: 9, label: 'JSON',   value: 'json',         color: 'cyan',   sort: 4, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 公告发布状态扩展 (dictId: 7)
  { id: 24, dictId: 7, label: '定时发布', value: 'scheduled',   color: 'blue',   sort: 4, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 部门类别 (dictId: 10)
  { id: 25, dictId: 10, label: '集团',   value: 'group',       color: 'purple', sort: 1, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 26, dictId: 10, label: '公司',   value: 'company',     color: 'blue',   sort: 2, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 27, dictId: 10, label: '部门',   value: 'department',  color: 'green',  sort: 3, status: 'enabled', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 系统配置 ─────────────────────────────────────────────────────────────────

export const SEED_SYSTEM_CONFIGS: SystemConfig[] = [
  { id: 1, configKey: 'captcha_enabled',            configValue: 'false',        configType: 'boolean', description: '是否开启登录验证码',                createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, configKey: 'site_name',                  configValue: 'Zenith Admin', configType: 'string',  description: '站点名称，显示在浏览器标签页',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, configKey: 'user_default_password',      configValue: '123456',       configType: 'string',  description: '新增用户时的默认密码',               createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, configKey: 'login_max_attempts',         configValue: '10',           configType: 'number',  description: '登录失败最大次数，超出后锁定账号',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, configKey: 'login_lock_duration_minutes',   configValue: '30',    configType: 'number',  description: '账号锁定时长（分钟）',               createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6, configKey: 'password_min_length',           configValue: '6',     configType: 'number',  description: '密码最小长度',                       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7, configKey: 'password_require_uppercase',    configValue: 'false', configType: 'boolean', description: '密码是否必须包含大写字母',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8, configKey: 'password_require_special_char', configValue: 'false', configType: 'boolean', description: '密码是否必须包含特殊字符',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 9, configKey: 'password_expiry_enabled',       configValue: 'false', configType: 'boolean', description: '是否开启密码过期强制重置',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 10, configKey: 'password_expiry_days',         configValue: '90',    configType: 'number',  description: '密码过期天数',                       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 11, configKey: 'allow_registration',           configValue: 'false', configType: 'boolean', description: '是否允许新用户注册',                 createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 12, configKey: 'forgot_password_enabled',       configValue: 'false', configType: 'boolean', description: '是否开启忘记密码/邮件重置功能',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 13, configKey: 'watermark_enabled',             configValue: 'false', configType: 'boolean', description: '是否开启页面水印（防截图泄漏）',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 14, configKey: 'watermark_content',             configValue: '',      configType: 'string',  description: '水印文本内容，留空则自动显示当前用户名', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 15, configKey: 'watermark_font_size',           configValue: '14',    configType: 'number',  description: '水印字体大小（px）',                 createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 16, configKey: 'watermark_opacity',             configValue: '15',    configType: 'number',  description: '水印透明度（1-100，实际值除以100）',  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 17, configKey: 'quick_chat_enabled',            configValue: 'false', configType: 'boolean', description: '是否显示快捷聊天按钮（全局开关，关闭后偏好设置中的相关选项也同步隐藏）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 18, configKey: 'ai_allow_user_custom_key',      configValue: 'false', configType: 'boolean', description: '是否允许用户配置自己的 AI API Key（关闭时所有用户均使用系统默认服务商）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19, configKey: 'file_upload_validate_type',     configValue: 'true',  configType: 'boolean', description: '上传文件时基于 magic bytes 校验真实文件类型（防止伪造 MIME type 绕过校验）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 20, configKey: 'file_upload_allowed_types',     configValue: 'image/*,video/*,audio/*,application/pdf,text/plain,application/zip,application/x-zip-compressed,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/vnd.ms-excel,application/msword,application/vnd.ms-powerpoint', configType: 'string', description: '允许上传的文件 MIME 类型，逗号分隔，支持通配符（如 image/*）；设为 */* 或 * 则允许所有类型', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 21, configKey: 'terminal_recording_enabled',  configValue: 'false', configType: 'boolean', description: '是否启用 Web 终端录屏（关闭后终端操作不再自动录制）',              createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 22, configKey: 'terminal_recording_retain_days', configValue: '30',  configType: 'number',  description: '终端录屏保留天数，超过此天数的录屏将在每日清理任务中删除（0 表示不按天数清理）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 23, configKey: 'terminal_recording_max_size_mb', configValue: '500', configType: 'number',  description: '终端录屏总容量上限（MB），超出上限后按时间从旧到新删除（0 表示不限制容量）',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 定时任务 ─────────────────────────────────────────────────────────────────

export const SEED_CRON_JOBS: CronJob[] = [
  {
    id: 1,
    name: '清理过期验证码',
    cronExpression: '0 */30 * * * *',
    handler: 'cleanExpiredCaptchas',
    params: null,
    status: 'enabled',
    description: '每30分钟清理过期的验证码',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: '2024-01-01 00:30:00',
    lastRunStatus: 'success',
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 2,
    name: '清理过期会话',
    cronExpression: '0 0 * * * *',
    handler: 'cleanExpiredSessions',
    params: null,
    status: 'enabled',
    description: '每小时清理超过8小时无活动的会话',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: '2024-01-01 01:00:00',
    lastRunStatus: 'success',
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 4,
    name: '定时公告自动发布',
    cronExpression: '*/5 * * * *',
    handler: 'publishScheduledAnnouncements',
    params: null,
    status: 'enabled',
    description: '每 5 分钟检查并自动发布到期的定时公告',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 3,
    name: '工作流审批超时处理',
    cronExpression: '*/5 * * * *',
    handler: 'processWorkflowTaskTimeouts',
    params: null,
    status: 'enabled',
    description: '每 5 分钟扫描已超时的审批任务，按节点配置执行提醒/自动通过/自动拒绝',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
  {
    id: 5,
    name: '清理过期终端录屏',
    cronExpression: '0 4 * * *',
    handler: 'cleanupTerminalRecordings',
    params: null,
    status: 'enabled',
    description: '每天凌晨 4 点根据系统配置（保留天数 / 容量上限）自动清理终端录屏',
    retryCount: 0,
    retryInterval: 0,
    retryBackoff: false,
    monitorTimeout: null,
    lastRunAt: null,
    lastRunStatus: null,
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];
