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

const SEED_DATE = '2024-01-01T00:00:00.000Z';

// ─── 菜单 ─────────────────────────────────────────────────────────────────────

export const SEED_MENUS: Menu[] = [
  { id: 1,  parentId: 0,  title: '首页',       name: 'Dashboard',           path: '/',                          component: 'dashboard/DashboardPage',                        icon: 'Home',              type: 'menu',      sort: 1,  status: 'active', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2,  parentId: 0,  title: '系统管理',   name: 'System',              path: undefined,                    component: undefined,                                        icon: 'Settings',          type: 'directory', sort: 2,  status: 'active', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3,  parentId: 2,  title: '用户管理',   name: 'SystemUsers',         path: '/system/users',              component: 'users/UsersPage',                                icon: 'UsersRound',        type: 'menu',      sort: 1,  status: 'active', visible: true,  permission: 'system:user:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 10, parentId: 3,  title: '新增用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:user:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 11, parentId: 3,  title: '编辑用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:user:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 12, parentId: 3,  title: '删除用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'active', visible: true,  permission: 'system:user:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 44, parentId: 3,  title: '导入用户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'active', visible: true,  permission: 'system:user:import',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 36, parentId: 2,  title: '部门管理',   name: 'SystemDepartments',   path: '/system/departments',        component: 'system/departments/DepartmentsPage',             icon: 'Building2',         type: 'menu',      sort: 2,  status: 'active', visible: true,  permission: 'system:department:list',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 37, parentId: 36, title: '新增部门',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:department:create',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 38, parentId: 36, title: '编辑部门',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:department:update',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 39, parentId: 36, title: '删除部门',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'active', visible: true,  permission: 'system:department:delete',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 40, parentId: 2,  title: '岗位管理',   name: 'SystemPositions',     path: '/system/positions',          component: 'system/positions/PositionsPage',                 icon: 'BriefcaseBusiness', type: 'menu',      sort: 3,  status: 'active', visible: true,  permission: 'system:position:list',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 41, parentId: 40, title: '新增岗位',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:position:create',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 42, parentId: 40, title: '编辑岗位',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:position:update',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 43, parentId: 40, title: '删除岗位',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'active', visible: true,  permission: 'system:position:delete',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4,  parentId: 2,  title: '菜单管理',   name: 'SystemMenus',         path: '/system/menus',              component: 'system/menus/MenusPage',                         icon: 'LayoutList',        type: 'menu',      sort: 4,  status: 'active', visible: true,  permission: 'system:menu:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 13, parentId: 4,  title: '新增菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:menu:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 14, parentId: 4,  title: '编辑菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:menu:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 15, parentId: 4,  title: '删除菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'active', visible: true,  permission: 'system:menu:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5,  parentId: 2,  title: '角色管理',   name: 'SystemRoles',         path: '/system/roles',              component: 'system/roles/RolesPage',                         icon: 'ShieldCheck',       type: 'menu',      sort: 5,  status: 'active', visible: true,  permission: 'system:role:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 16, parentId: 5,  title: '新增角色',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:role:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 17, parentId: 5,  title: '编辑角色',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:role:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 18, parentId: 5,  title: '删除角色',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'active', visible: true,  permission: 'system:role:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19, parentId: 5,  title: '分配菜单',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'active', visible: true,  permission: 'system:role:assign',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6,  parentId: 2,  title: '字典管理',   name: 'SystemDicts',         path: '/system/dicts',              component: 'system/dicts/DictsPage',                         icon: 'NotepadText',       type: 'menu',      sort: 6,  status: 'active', visible: true,  permission: 'system:dict:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 20, parentId: 6,  title: '新增字典',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:dict:create',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 21, parentId: 6,  title: '编辑字典',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:dict:update',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 22, parentId: 6,  title: '删除字典',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'active', visible: true,  permission: 'system:dict:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 23, parentId: 6,  title: '管理字典项', name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'active', visible: true,  permission: 'system:dict:item',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 210, parentId: 2,  title: '租户管理',   name: 'SystemTenants',       path: '/system/tenants',            component: 'system/tenants/TenantsPage',                     icon: 'Building',          type: 'menu',      sort: 7,  status: 'active', visible: true,  permission: 'system:tenant:list',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 211, parentId: 210, title: '新增租户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:tenant:create',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 212, parentId: 210, title: '编辑租户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:tenant:update',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 213, parentId: 210, title: '删除租户',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'active', visible: true,  permission: 'system:tenant:delete',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 100, parentId: 2, title: '地区管理',  name: 'SystemRegions',       path: '/system/regions',            component: 'system/regions/RegionsPage',                     icon: 'MapPin',            type: 'menu',      sort: 8,  status: 'active', visible: true,  permission: 'system:region:list',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 101, parentId: 100, title: '新增地区', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:region:create',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 102, parentId: 100, title: '编辑地区', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:region:update',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 103, parentId: 100, title: '删除地区', name: undefined,            path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'active', visible: true,  permission: 'system:region:delete',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 200, parentId: 0, title: '系统设置',   name: 'SystemSettings',      path: undefined,                    component: undefined,                                        icon: 'Settings2',         type: 'directory', sort: 3,  status: 'active', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 50, parentId: 200, title: '系统配置',   name: 'SystemConfigs',       path: '/system/configs',            component: 'system/configs/SystemConfigsPage',               icon: 'SlidersHorizontal', type: 'menu',      sort: 1,  status: 'active', visible: true,  permission: 'system:config:list',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 51, parentId: 50, title: '新增配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:config:create',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 52, parentId: 50, title: '编辑配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:config:update',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 53, parentId: 50, title: '删除配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'active', visible: true,  permission: 'system:config:delete',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 110, parentId: 200, title: '邮件配置',   name: 'SystemEmailConfig',   path: '/system/email-config',       component: 'system/email-config/EmailConfigPage',            icon: 'Mail',              type: 'menu',      sort: 2,  status: 'active', visible: true,  permission: 'system:email-config:view',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 111, parentId: 110, title: '保存配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:email-config:update',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 112, parentId: 110, title: '测试邮件',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:email-config:update',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 115, parentId: 200, title: 'OAuth配置',   name: 'SystemOAuthConfig',  path: '/system/oauth-config',       component: 'system/oauth-config/OAuthConfigPage',            icon: 'KeyRound',          type: 'menu',      sort: 3,  status: 'active', visible: true,  permission: 'system:oauth-config:view',     createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 116, parentId: 115, title: '保存配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:oauth-config:update',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8,  parentId: 200, title: '文件管理',   name: 'SystemFiles',         path: undefined,                    component: undefined,                                        icon: 'FolderOpen',        type: 'directory', sort: 4,  status: 'active', visible: true,  permission: 'system:file:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 24, parentId: 8,  title: '文件配置',   name: 'SystemFileConfigs',   path: '/system/file-configs',       component: 'system/file-configs/FileStorageConfigsPage',     icon: 'HardDriveUpload',   type: 'menu',      sort: 1,  status: 'active', visible: true,  permission: 'system:file:config',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 25, parentId: 8,  title: '文件列表',   name: 'SystemFileList',      path: '/system/files',              component: 'system/files/FilesPage',                         icon: 'Files',             type: 'menu',      sort: 2,  status: 'active', visible: true,  permission: 'system:file:list',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 26, parentId: 24, title: '新增配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:file:config:create',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 27, parentId: 24, title: '编辑配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:file:config:update',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 28, parentId: 24, title: '删除配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'active', visible: true,  permission: 'system:file:config:delete',    createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 29, parentId: 24, title: '设为默认',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'active', visible: true,  permission: 'system:file:config:default',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 30, parentId: 25, title: '上传文件',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:file:upload',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 31, parentId: 25, title: '删除文件',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:file:delete',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 9,  parentId: 200, title: '服务监控',   name: 'SystemMonitor',       path: '/system/monitor',            component: 'system/monitor/MonitorPage',                     icon: 'Activity',          type: 'menu',      sort: 5,  status: 'active', visible: true,  permission: 'system:monitor:view',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 54, parentId: 200, title: '在线用户',   name: 'SystemSessions',      path: '/system/sessions',           component: 'system/sessions/OnlineSessionsPage',             icon: 'MonitorSmartphone', type: 'menu',      sort: 6,  status: 'active', visible: true,  permission: 'system:session:list',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 55, parentId: 54, title: '强制下线',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:session:forceLogout',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 56, parentId: 200, title: '定时任务',   name: 'SystemCronJobs',      path: '/system/cron-jobs',          component: 'system/cron-jobs/CronJobsPage',                  icon: 'Clock',             type: 'menu',      sort: 7,  status: 'active', visible: true,  permission: 'system:cronjob:list',          createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 57, parentId: 56, title: '新增任务',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:cronjob:create',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 58, parentId: 56, title: '编辑任务',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:cronjob:update',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 59, parentId: 56, title: '删除任务',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'active', visible: true,  permission: 'system:cronjob:delete',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 60, parentId: 56, title: '立即执行',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 4,  status: 'active', visible: true,  permission: 'system:cronjob:execute',       createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 120, parentId: 200, title: '数据库备份', name: 'SystemDbBackups',     path: '/system/db-backups',         component: 'system/db-backups/DbBackupsPage',                icon: 'DatabaseBackup',    type: 'menu',      sort: 8,  status: 'active', visible: true,  permission: 'system:db-backup:list',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 121, parentId: 120, title: '创建备份',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:db-backup:create',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 123, parentId: 120, title: '删除备份',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:db-backup:delete',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 34, parentId: 200, title: '审计日志',   name: 'SystemAuditLogs',     path: undefined,                    component: undefined,                                        icon: 'ClipboardMinus',    type: 'directory', sort: 9,  status: 'active', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 32, parentId: 34, title: '登录日志',   name: 'SystemLoginLogs',     path: '/system/login-logs',         component: 'system/login-logs/LoginLogsPage',                icon: 'List',              type: 'menu',      sort: 1,  status: 'active', visible: true,  permission: 'system:log:login',             createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 33, parentId: 34, title: '操作日志',   name: 'SystemOperationLogs', path: '/system/operation-logs',     component: 'system/operation-logs/OperationLogsPage',        icon: 'ClipboardList',     type: 'menu',      sort: 2,  status: 'active', visible: true,  permission: 'system:log:operation',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 35, parentId: 200, title: '通知公告',   name: 'SystemNotices',       path: '/system/notices',            component: 'system/notices/NoticesPage',                     icon: 'BellRing',          type: 'menu',      sort: 10, status: 'active', visible: true,  permission: 'system:notice:list',           createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 61, parentId: 35, title: '新增公告',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:notice:create',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 62, parentId: 35, title: '编辑公告',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 2,  status: 'active', visible: true,  permission: 'system:notice:update',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 63, parentId: 35, title: '删除公告',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 3,  status: 'active', visible: true,  permission: 'system:notice:delete',         createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7,  parentId: 2,  title: '组件示例',   name: 'Components',          path: '/components',                component: 'components/ComponentsPage',                      icon: 'Component',         type: 'menu',      sort: 8,  status: 'active', visible: true,  createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // ── 内置隐藏菜单（不显示在侧边栏，供面包屑/标签页标题使用）──────────────────────────────
  { id: 202, parentId: 0, title: '个人中心',   name: 'Profile',             path: '/profile',                   component: 'profile/ProfilePage',                            icon: 'UserRound',         type: 'menu',      sort: 99, status: 'active', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 203, parentId: 0, title: '通知中心',   name: 'Notifications',       path: '/notifications',             component: 'notifications/NotificationsPage',                icon: 'Bell',              type: 'menu',      sort: 100, status: 'active', visible: false, createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 125, parentId: 200, title: 'IP访问控制', name: 'SystemIpAccess',      path: '/system/ip-access',          component: 'system/ip-access/IpAccessPage',                  icon: 'ShieldBan',         type: 'menu',      sort: 11, status: 'active', visible: true,  permission: 'system:ip-access:view',        createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 126, parentId: 125, title: '保存配置',   name: undefined,             path: undefined,                    component: undefined,                                        icon: undefined,           type: 'button',    sort: 1,  status: 'active', visible: true,  permission: 'system:ip-access:update',      createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 角色 ─────────────────────────────────────────────────────────────────────

export const SEED_ROLES: Role[] = [
  {
    id: 1,
    name: '超级管理员',
    code: 'super_admin',
    description: '拥有所有权限',
    dataScope: 'all',
    status: 'active',
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
    status: 'active',
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
    menuIds: [1],
  },
];

// ─── 部门 ─────────────────────────────────────────────────────────────────────

export const SEED_DEPARTMENTS: Department[] = [
  { id: 1, parentId: 0, name: '总部',  code: 'headquarters', leader: '管理员', phone: '13800000000', email: 'admin@zenith.dev', sort: 1, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, parentId: 1, name: '技术部', code: 'technology',   leader: '管理员', phone: '13800000001', email: 'tech@zenith.dev',  sort: 1, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 岗位 ─────────────────────────────────────────────────────────────────────

export const SEED_POSITIONS: Position[] = [
  { id: 1, name: '系统管理员', code: 'system_admin', sort: 1, status: 'active', remark: '默认管理员岗位', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2, name: '开发工程师', code: 'developer',    sort: 2, status: 'active', remark: '默认技术岗位',   createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 字典 ─────────────────────────────────────────────────────────────────────

export const SEED_DICTS: Dict[] = [
  { id: 1, name: '通用状态',     code: 'common_status',         description: '通用启用/禁用状态',  status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 3, name: '菜单类型',     code: 'menu_type',             description: '菜单节点类型',       status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4, name: '用户性别',     code: 'user_gender',           description: '用户性别',           status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5, name: '显示状态',     code: 'menu_visible',          description: '菜单显示/隐藏状态',  status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 6, name: '通知类型',     code: 'notice_type',           description: '通知公告类型',       status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7, name: '通知发布状态', code: 'notice_publish_status', description: '通知公告的发布状态', status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8, name: '通知优先级',   code: 'notice_priority',       description: '通知公告优先级',     status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 9, name: '系统配置类型', code: 'system_config_type',    description: '系统配置项值类型',   status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 字典项 ───────────────────────────────────────────────────────────────────

export const SEED_DICT_ITEMS: DictItem[] = [
  // 通用状态 (dictId: 1)
  { id: 1,  dictId: 1, label: '启用',   value: 'active',       color: 'green',  sort: 1, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 2,  dictId: 1, label: '禁用',   value: 'disabled',     color: 'grey',   sort: 2, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 菜单类型 (dictId: 3)
  { id: 3,  dictId: 3, label: '目录',   value: 'directory',    color: 'blue',   sort: 1, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 4,  dictId: 3, label: '菜单',   value: 'menu',         color: 'green',  sort: 2, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 5,  dictId: 3, label: '按钮',   value: 'button',       color: 'orange', sort: 3, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 用户性别 (dictId: 4)
  { id: 6,  dictId: 4, label: '男',     value: 'male',         color: 'blue',   sort: 1, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 7,  dictId: 4, label: '女',     value: 'female',       color: 'pink',   sort: 2, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 8,  dictId: 4, label: '保密',   value: 'secret',       color: 'grey',   sort: 3, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 显示状态 (dictId: 5)
  { id: 9,  dictId: 5, label: '显示',   value: 'show',         color: 'green',  sort: 1, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 10, dictId: 5, label: '隐藏',   value: 'hidden',       color: 'grey',   sort: 2, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 通知类型 (dictId: 6)
  { id: 11, dictId: 6, label: '通知',   value: 'notice',       color: 'blue',   sort: 1, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 12, dictId: 6, label: '公告',   value: 'announcement', color: 'cyan',   sort: 2, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 13, dictId: 6, label: '警告',   value: 'warning',      color: 'orange', sort: 3, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 通知发布状态 (dictId: 7)
  { id: 14, dictId: 7, label: '草稿',   value: 'draft',        color: 'grey',   sort: 1, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 15, dictId: 7, label: '已发布', value: 'published',    color: 'green',  sort: 2, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 16, dictId: 7, label: '已撤回', value: 'recalled',     color: 'orange', sort: 3, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 通知优先级 (dictId: 8)
  { id: 17, dictId: 8, label: '低',     value: 'low',          color: 'grey',   sort: 1, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 18, dictId: 8, label: '中',     value: 'medium',       color: 'blue',   sort: 2, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 19, dictId: 8, label: '高',     value: 'high',         color: 'red',    sort: 3, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  // 系统配置类型 (dictId: 9)
  { id: 20, dictId: 9, label: '字符串', value: 'string',       color: 'blue',   sort: 1, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 21, dictId: 9, label: '数字',   value: 'number',       color: 'green',  sort: 2, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 22, dictId: 9, label: '布尔值', value: 'boolean',      color: 'orange', sort: 3, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 23, dictId: 9, label: 'JSON',   value: 'json',         color: 'cyan',   sort: 4, status: 'active', createdAt: SEED_DATE, updatedAt: SEED_DATE },
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
  { id: 13, configKey: 'ip_whitelist_enabled',          configValue: 'false', configType: 'boolean', description: '是否开启IP白名单访问控制',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 14, configKey: 'ip_whitelist',                  configValue: '[]',    configType: 'json',    description: 'IP白名单列表（支持CIDR，JSON数组）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 15, configKey: 'ip_blacklist_enabled',          configValue: 'false', configType: 'boolean', description: '是否开启IP黑名单访问控制',            createdAt: SEED_DATE, updatedAt: SEED_DATE },
  { id: 16, configKey: 'ip_blacklist',                  configValue: '[]',    configType: 'json',    description: 'IP黑名单列表（支持CIDR，JSON数组）', createdAt: SEED_DATE, updatedAt: SEED_DATE },
];

// ─── 定时任务 ─────────────────────────────────────────────────────────────────

export const SEED_CRON_JOBS: CronJob[] = [
  {
    id: 1,
    name: '清理过期验证码',
    cronExpression: '0 */30 * * * *',
    handler: 'cleanExpiredCaptchas',
    params: null,
    status: 'active',
    description: '每30分钟清理过期的验证码',
    lastRunAt: '2024-01-01T00:30:00.000Z',
    nextRunAt: '2024-01-01T01:00:00.000Z',
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
    status: 'active',
    description: '每小时清理超过8小时无活动的会话',
    lastRunAt: '2024-01-01T01:00:00.000Z',
    nextRunAt: '2024-01-01T02:00:00.000Z',
    lastRunStatus: 'success',
    lastRunMessage: null,
    createdAt: SEED_DATE,
    updatedAt: SEED_DATE,
  },
];
